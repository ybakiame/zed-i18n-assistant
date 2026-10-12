import type { CompletionItemLike, LocaleMap } from '../types.js';
import { resolvePreferredLocale } from '../locale/select.js';

export function getCompletions(prefix: string, locales: LocaleMap, defaultLocale: string | undefined): CompletionItemLike[] {
  const keys = new Set<string>();
  for (const locale of Object.values(locales)) for (const key of Object.keys(locale.flat)) keys.add(key);
  const preferred = resolvePreferredLocale(locales, defaultLocale);
  return [...keys]
    .filter((key) => key.startsWith(prefix))
    .sort()
    .map((key) => ({ label: key, kind: 12 as const, detail: preferred?.flat[key] || undefined, insertText: key }));
}
