import type { Locale, LocaleMap } from '../types.js';

export function resolvePreferredLocale(locales: LocaleMap | undefined, defaultLocale: string | undefined): Locale | undefined {
  if (!locales || Object.keys(locales).length === 0) return undefined;
  if (defaultLocale && locales[defaultLocale]) return locales[defaultLocale];

  const requested = normalizeLocaleName(defaultLocale);
  const entries = Object.entries(locales);
  const exactNormalized = entries.find(([name]) => normalizeLocaleName(name) === requested);
  if (exactNormalized) return exactNormalized[1];

  const requestedLanguage = requested.split('-')[0];
  const languageMatch = entries.find(([name]) => {
    const candidate = normalizeLocaleName(name);
    const candidateLanguage = candidate.split('-')[0];
    return candidateLanguage && requestedLanguage && candidateLanguage === requestedLanguage;
  });
  return languageMatch?.[1] || entries[0]?.[1];
}

function normalizeLocaleName(name: string | undefined): string {
  return String(name || '').trim().replace(/_/g, '-').toLowerCase();
}

export function getDefinitionLocaleOrder(locales: LocaleMap, defaultLocale: string | undefined): Locale[] {
  const localeList = Object.values(locales || {});
  const preferred = resolvePreferredLocale(locales, defaultLocale);
  if (!preferred) return localeList;
  return [preferred, ...localeList.filter((locale) => locale !== preferred)];
}
