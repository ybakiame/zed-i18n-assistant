import fs from 'node:fs';
import path from 'node:path';
import { flattenLocale } from '../locale/model.js';
import { parseTsLocaleModule } from '../locale/ts-module.js';
import type { LoadedLocales, Locale, LocaleMap, ProjectContext } from '../types.js';
import { localeText } from './fs.js';
import { connection, state } from './runtime.js';

export const LOCALE_FILE_RE = /\.(json|[cm]?[tj]s)$/i;

export function loadLocalesForContext(context: ProjectContext): LoadedLocales {
  const cacheKey = context.root + '\0' + JSON.stringify({
    defaultLocale: context.config.defaultLocale,
    localeDirs: context.config.localeDirs,
    inlayHints: context.config.inlayHints,
  });
  const cached = state.localeCacheByContext.get(cacheKey);
  if (cached) return cached;

  const locales: LocaleMap = {};
  const localeTexts: Record<string, string> = {};
  for (const dir of context.config.localeDirs) {
    // path.resolve (not join) so an already-absolute dir — e.g. a workspace-level
    // shared locale dir merged into a package context — is used as-is.
    const fullDir = path.resolve(context.root, dir);
    if (!fs.existsSync(fullDir)) continue;
    loadLocaleFiles(fullDir, locales, localeTexts);
    for (const entry of fs.readdirSync(fullDir, { withFileTypes: true })) {
      if (entry.isDirectory()) loadLocaleDirectory(path.join(fullDir, entry.name), entry.name, locales, localeTexts);
    }
  }
  const loaded: LoadedLocales = { locales, localeTexts };
  state.localeCacheByContext.set(cacheKey, loaded);
  return loaded;
}

function loadLocaleDirectory(localeDir: string, localeName: string, next: LocaleMap, localeTexts: Record<string, string>): void {
  const locale: Locale = next[localeName] ?? (next[localeName] = { path: localeDir, flat: {}, files: [] });
  const files = locale.files ?? (locale.files = []);
  const directories = locale.directories ?? (locale.directories = []);
  if (!directories.includes(localeDir)) directories.push(localeDir);
  for (const file of fs.readdirSync(localeDir).sort()) {
    const fullPath = path.join(localeDir, file);
    if (fs.statSync(fullPath).isDirectory()) continue;
    if (!LOCALE_FILE_RE.test(file)) continue;
    if (!files.includes(fullPath)) files.push(fullPath);
    try {
      const text = localeText(fullPath);
      if (text === undefined) continue;
      localeTexts[fullPath] = text;
      if (file.endsWith('.json')) Object.assign(locale.flat, prefixByFile(file, flattenLocale(JSON.parse(text))));
      else if (/\.[cm]?[tj]s$/i.test(file)) Object.assign(locale.flat, parseTsLocaleModule(text, file));
      else continue;
    } catch (error) { connection.console.warn('Failed to load locale file ' + fullPath + ': ' + (error as Error).message); }
  }
}

// Top-level locale files named after the locale itself (en.json, en.ts, …).
// Keys are stored verbatim — unlike directory locales no file-stem prefix is
// applied, so parseTsLocaleModule runs as an 'index' module. When both a .json
// and a .ts/.js file share the locale name, their keys merge (sorted read
// order keeps this deterministic); writing stays a JSON-only feature.
function loadLocaleFiles(fullDir: string, next: LocaleMap, localeTexts: Record<string, string>): void {
  const files = fs.readdirSync(fullDir).sort((a, b) => {
    const aJson = a.endsWith('.json') ? 0 : 1;
    const bJson = b.endsWith('.json') ? 0 : 1;
    return aJson - bJson || a.localeCompare(b);
  });
  for (const file of files) {
    const fullPath = path.join(fullDir, file);
    if (fs.statSync(fullPath).isDirectory()) continue;
    try {
      const isJson = file.endsWith('.json');
      const isModule = /\.[cm]?[tj]s$/i.test(file);
      if (!isJson && !isModule) continue;
      const name = file.replace(/\.(json|[cm]?[tj]s)$/i, '');
      const locale: Locale = next[name] ?? (next[name] = { path: fullPath, flat: {}, files: [], topLevelFiles: [] });
      const files = locale.files ?? (locale.files = []);
      const topLevelFiles = locale.topLevelFiles ?? (locale.topLevelFiles = []);
      if (!files.includes(fullPath)) files.push(fullPath);
      if (!topLevelFiles.includes(fullPath)) topLevelFiles.push(fullPath);
      const text = localeText(fullPath);
      if (text === undefined) continue;
      localeTexts[fullPath] = text;
      const flat = isJson ? flattenLocale(JSON.parse(text)) : parseTsLocaleModule(text, 'index.ts');
      Object.assign(locale.flat, flat);
    } catch (error) { connection.console.warn('Failed to load locale file ' + fullPath + ': ' + (error as Error).message); }
  }
}

function prefixByFile(file: string, flat: Record<string, string>): Record<string, string> {
  const stem = path.basename(file, path.extname(file));
  if (stem === 'index') return flat;
  return Object.fromEntries(Object.entries(flat).map(([key, value]) => [stem + '.' + key, value]));
}
