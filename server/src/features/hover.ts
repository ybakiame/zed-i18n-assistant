import type { LocaleMap } from '../types.js';

export function buildHoverMarkdown(key: string, locales: LocaleMap): string {
  const names = Object.keys(locales).sort();
  if (names.length === 0) return '**' + key + '**\n\nNo locale JSON files found.';
  const lines = ['**' + key + '**', '', '| Locale | Text |', '|---|---|'];
  for (const name of names) {
    const value = locales[name]?.flat[key];
    lines.push('| ' + escapeMd(name) + ' | ' + escapeMd(value ?? 'Missing') + ' |');
  }
  return lines.join('\n');
}

function escapeMd(value: unknown): string {
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}
