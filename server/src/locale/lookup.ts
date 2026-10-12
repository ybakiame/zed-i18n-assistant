import type { Locale, LocaleKeyTarget, LocaleMap, Position, Range } from '../types.js';
import { comparePosition, makeRange, offsetToPosition, positionToOffset } from '../text/positions.js';
import { normalizeFsPath } from '../config.js';
import { findJsonProperty, parseJsonStructure, type JsonNode } from './json.js';
import { getDefinitionLocaleOrder } from './select.js';

export function localeKeyRange(
  text: string,
  key: string,
  isJson: boolean,
  jsonRoot: JsonNode | null | undefined = isJson ? parseJsonStructure(text) : undefined,
): Range | undefined {
  if (isJson) {
    const property = findJsonProperty(jsonRoot ?? undefined, key.split('.'));
    return property ? makeRange(text, property.start, property.end) : undefined;
  }
  const start = findLocaleKeyLocation(text, key);
  if (!start) return undefined;
  const offset = positionToOffset(text, start);
  const token = text.slice(offset).match(/^(?:'[^']*'|"[^"]*"|[\w$-]+)/);
  return token ? makeRange(text, offset, offset + token[0]!.length) : undefined;
}

export function findJsonKeyLocation(jsonText: string, key: string): Position | undefined {
  return localeKeyRange(jsonText, key, true)?.start;
}

export function findLocaleKeyLocation(text: string, key: string): Position | undefined {
  const parts = key.split('.');
  const last = parts[parts.length - 1]!;
  const re = new RegExp('(?:["\\\']' + escapeRegExp(last) + '["\\\']|' + escapeRegExp(last) + ')\\s*:', 'g');
  const match = re.exec(text);
  return match ? offsetToPosition(text, match.index) : undefined;
}

export function findLocaleKeyTarget(locale: Locale | undefined, key: string, localeTexts: Record<string, string> = {}): LocaleKeyTarget | undefined {
  if (!locale || !Object.prototype.hasOwnProperty.call(locale.flat || {}, key)) return undefined;
  const files = Array.isArray(locale.files) && locale.files.length
    ? locale.files
    : (locale.path ? [locale.path] : []);
  const candidates = files
    .map((filePath) => ({ filePath, lookupKey: lookupKeyForLocaleFile(locale, filePath, key) }))
    .sort((a, b) => Number(a.lookupKey === key) - Number(b.lookupKey === key));

  for (const candidate of candidates) {
    const text = localeTexts[candidate.filePath];
    if (!text) continue;
    const range = localeKeyRange(text, candidate.lookupKey, /\.json$/i.test(candidate.filePath));
    if (range) return { filePath: candidate.filePath, position: range.start, range };
  }

  const fallback = candidates[0];
  return fallback ? { filePath: fallback.filePath } : undefined;
}

export function lookupKeyForLocaleFile(locale: Locale, filePath: string, key: string): string {
  const isNestedLocaleFile = !locale.topLevelFiles?.includes(filePath) && normalizeFsPath(locale.path) !== normalizeFsPath(filePath);
  const stem = fileStem(filePath);
  if (isNestedLocaleFile && stem && stem !== 'index' && key.startsWith(stem + '.')) return key.slice(stem.length + 1);
  return key;
}

function fileStem(filePath: string): string {
  const fileName = String(filePath || '').replace(/\\/g, '/').split('/').at(-1) || '';
  return fileName.replace(/\.[^.]+$/, '');
}

// Every locale that defines the key, with the default locale first, so
// Go to Definition can return one LSP Location per language file.
export function collectLocaleKeyTargets(locales: LocaleMap, key: string, localeTexts: Record<string, string> = {}, defaultLocale?: string): (LocaleKeyTarget & { position: Position; range: Range })[] {
  return getDefinitionLocaleOrder(locales, defaultLocale)
    .map((locale) => findLocaleKeyTarget(locale, key, localeTexts))
    .filter((target): target is LocaleKeyTarget & { position: Position; range: Range } => target?.position !== undefined && target.range !== undefined);
}

// Inverse of findLocaleKeyTarget: given a caret position inside a locale file,
// return the full flattened key it points at (so Find References can jump back
// to the code). Reuses the same key->location logic as Go to Definition to stay
// consistent; precise for JSON, best-effort (line-based) for TS/JS locale modules.
export function localeKeyAtPosition(locale: Locale | undefined, filePath: string, text: string, position: Position): string | undefined {
  if (!locale || !locale.flat || !text || !position) return undefined;
  const isJson = /\.json$/i.test(filePath);
  const jsonRoot = isJson ? parseJsonStructure(text) || null : undefined;
  let lineFallback: string | undefined;
  let lineFallbackCount = 0;
  for (const fullKey of Object.keys(locale.flat)) {
    const lookupKey = lookupKeyForLocaleFile(locale, filePath, fullKey);
    const range = localeKeyRange(text, lookupKey, isJson, jsonRoot);
    if (!range || range.start.line !== position.line) continue;
    if (comparePosition(position, range.start) >= 0 && comparePosition(position, range.end) < 0) return fullKey;
    lineFallback = fullKey;
    lineFallbackCount++;
  }
  return !isJson && lineFallbackCount === 1 ? lineFallback : undefined;
}

export function collectLocaleWatchPaths(localeCache: LocaleMap | undefined, localeDirs: readonly string[] = []): string[] {
  const paths = new Set<string>(localeDirs.filter(Boolean));
  for (const locale of Object.values(localeCache || {})) {
    if (locale.path) paths.add(locale.path);
    for (const file of locale.files || []) paths.add(file);
  }
  return [...paths].sort();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^()|[\]\{}]/g, '\\$&');
}
