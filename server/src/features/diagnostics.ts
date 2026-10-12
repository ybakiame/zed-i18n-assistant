import type {
  I18nDiagnostic,
  I18nKeyItem,
  Locale,
  LocaleMap,
  ParamCodeAction,
  ParamConsistencyEntry,
  Range,
} from '../types.js';
import { extractI18nKeys } from '../keys/extract.js';
import { makeRange } from '../text/positions.js';
import { localeKeyRange, lookupKeyForLocaleFile } from '../locale/lookup.js';
import { parseJsonStructure } from '../locale/json.js';

export function getDiagnostics(text: string, locales: LocaleMap): I18nDiagnostic[] {
  const localeEntries = Object.entries(locales);
  if (localeEntries.length === 0) return [];

  return extractI18nKeys(text).flatMap((item) => {
    const missingLocales = localeEntries
      .filter(([, locale]) => !Object.prototype.hasOwnProperty.call(locale.flat, item.key))
      .map(([name]) => name)
      .sort();

    const diagnostics: I18nDiagnostic[] = [];
    if (missingLocales.length > 0) {
      const missingInAllLocales = missingLocales.length === localeEntries.length;
      diagnostics.push({
        severity: missingInAllLocales ? 1 : 2,
        range: item.range,
        message: missingInAllLocales
          ? 'Missing i18n key: ' + item.key
          : 'Missing i18n key "' + item.key + '" in locales: ' + missingLocales.join(', '),
        source: 'i18n-assistant',
        data: { key: item.key, missingLocales, missingInAllLocales },
      });
    }
    if (missingLocales.length !== localeEntries.length) {
      diagnostics.push(...getParamDiagnostics(item, localeEntries));
      const consistency = getLocaleParamConsistency(item.key, locales);
      if (!consistency.consistent) diagnostics.push(paramInconsistencyDiagnostic(item.key, item.range, consistency.perLocale));
    }
    return diagnostics;
  });
}

function getParamDiagnostics(item: I18nKeyItem, localeEntries: [string, Locale][]): I18nDiagnostic[] {
  if (!Array.isArray(item.providedParams)) return [];
  const required = collectRequiredParams(item.key, localeEntries);
  const provided = new Set(item.providedParams);
  const missing = required.filter((n) => !provided.has(n));
  const unused = item.providedParams.filter((n) => !required.includes(n));
  const diagnostics: I18nDiagnostic[] = [];
  if (missing.length > 0)
    diagnostics.push({ severity: 2, range: item.range, message: 'Missing i18n params for "' + item.key + '": ' + missing.join(', '), source: 'i18n-assistant', data: { key: item.key, missingParams: missing } });
  if (unused.length > 0)
    diagnostics.push({ severity: 2, range: item.range, message: 'Unused i18n params for "' + item.key + '": ' + unused.join(', '), source: 'i18n-assistant', data: { key: item.key, unusedParams: unused } });
  return diagnostics;
}

function collectRequiredParams(key: string, localeEntries: [string, Locale][]): string[] {
  const params = new Set<string>();
  for (const [, locale] of localeEntries) {
    const value = locale.flat[key];
    if (value === undefined) continue;
    for (const name of extractPlaceholders(value)) params.add(name);
  }
  return [...params].sort();
}

// Compare the interpolation placeholders a key uses across every locale that
// defines it. `consistent` is false when two locales that both define the key
// carry different param sets (a translation forgot or renamed a placeholder).
// Locales that do not define the key are ignored — that is a missing-key concern.
export function getLocaleParamConsistency(
  key: string,
  locales: LocaleMap | undefined,
): { consistent: boolean; perLocale: ParamConsistencyEntry[]; union: string[] } {
  const perLocale: ParamConsistencyEntry[] = [];
  for (const [name, locale] of Object.entries(locales || {})) {
    const value = locale.flat?.[key];
    if (value === undefined) continue;
    perLocale.push({ name, params: extractPlaceholders(value) });
  }
  const union = [...new Set(perLocale.flatMap((entry) => entry.params))].sort();
  const consistent = perLocale.length < 2
    || perLocale.every((entry) => entry.params.length === union.length && union.every((param) => entry.params.includes(param)));
  return { consistent, perLocale, union };
}

// Warnings for keys defined in `locale`'s file whose params disagree with the
// same key in other locales, anchored at each key's position in the file text.
export function getLocaleParamDiagnostics(locale: Locale | undefined, filePath: string, text: string, locales: LocaleMap): I18nDiagnostic[] {
  if (!locale?.flat) return [];
  const isJson = /\.json$/i.test(filePath);
  const jsonRoot = isJson ? parseJsonStructure(text) || null : undefined;
  const diagnostics: I18nDiagnostic[] = [];
  for (const key of Object.keys(locale.flat)) {
    const consistency = getLocaleParamConsistency(key, locales);
    if (consistency.consistent) continue;
    const lookupKey = lookupKeyForLocaleFile(locale, filePath, key);
    const range = localeKeyRange(text, lookupKey, isJson, jsonRoot);
    if (range) diagnostics.push(paramInconsistencyDiagnostic(key, range, consistency.perLocale));
  }
  return diagnostics;
}

function paramInconsistencyDiagnostic(key: string, range: Range, perLocale: ParamConsistencyEntry[]): I18nDiagnostic {
  return {
    severity: 2,
    range,
    message: 'i18n params for "' + key + '" differ across locales — ' + formatPerLocaleParams(perLocale),
    source: 'i18n-assistant',
    data: { key, paramInconsistency: perLocale },
  };
}

function formatPerLocaleParams(perLocale: ParamConsistencyEntry[]): string {
  return perLocale
    .map((entry) => entry.name + ': ' + (entry.params.length ? entry.params.map((p) => '{' + p + '}').join(', ') : '(none)'))
    .join('; ');
}

export function getParamCodeActions(text: string, diagnostics: readonly I18nDiagnostic[] = []): ParamCodeAction[] {
  const items = extractI18nKeys(text);
  return diagnostics.flatMap((diagnostic) => {
    const item = items.find((candidate) => candidate.key === diagnostic.data?.key && sameRange(candidate.range, diagnostic.range));

    const missingParams = diagnostic.data?.missingParams;
    if (Array.isArray(missingParams) && missingParams.length > 0) {
      if (!item?.paramsEdit) return [];
      const newText = item.paramsEdit.prefix + missingParams.join(', ') + (item.paramsEdit.suffix || '');
      return [{
        title: 'Add missing i18n params: ' + missingParams.join(', '),
        diagnostic,
        edit: { range: makeRange(text, item.paramsEdit.insertOffset, item.paramsEdit.insertOffset), newText },
      }];
    }

    const unusedParams = diagnostic.data?.unusedParams;
    if (Array.isArray(unusedParams) && unusedParams.length > 0) {
      if (!item?.paramsObject) return [];
      const kept = item.paramsObject.props.filter((prop) => prop.name === undefined || !unusedParams.includes(prop.name));
      const rebuilt = kept.length ? '{ ' + kept.map((prop) => prop.text).join(', ') + ' }' : '{}';
      return [{
        title: 'Remove unused i18n params: ' + unusedParams.join(', '),
        diagnostic,
        edit: { range: makeRange(text, item.paramsObject.start, item.paramsObject.end), newText: rebuilt },
      }];
    }

    return [];
  });
}

function sameRange(a?: Range, b?: Range): boolean {
  return a?.start?.line === b?.start?.line
    && a?.start?.character === b?.start?.character
    && a?.end?.line === b?.end?.line
    && a?.end?.character === b?.end?.character;
}

export function extractPlaceholders(value: unknown): string[] {
  const params = new Set<string>();
  // ICU-style: {name, plural, ...} — extract top-level name, skip nested content
  let text = String(value);
  let cursor = 0;
  while (cursor < text.length) {
    const open = text.indexOf('{', cursor);
    if (open === -1) break;
    const head = text.slice(open).match(/^\{\s*([A-Za-z_$][\w$]*)\s*,/);
    if (head) {
      params.add(head[1]!);
      let depth = 0, i = open;
      while (i < text.length) {
        if (text[i] === '{') depth++;
        else if (text[i] === '}') { depth--; if (depth === 0) break; }
        i++;
      }
      text = text.slice(0, open) + ' '.repeat(i - open + 1) + text.slice(i + 1);
      cursor = open;
      continue;
    }
    cursor = open + 1;
  }
  const re = /\{\s*([A-Za-z_$][\w$]*)\s*\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) params.add(m[1]!);
  return [...params].sort();
}
