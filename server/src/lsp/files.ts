import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isPathInside, normalizeFsPath } from '../config.js';
import { findCodeKeyRanges, keyAtPosition } from '../keys/extract.js';
import { localeKeyAtPosition } from '../locale/lookup.js';
import type { Locale, LocaleMap, Position, ProjectContext, Range } from '../types.js';
import { getAllConfiguredContexts } from './contexts.js';
import { openDocumentText, readFileSafe } from './fs.js';
import { loadLocalesForContext, LOCALE_FILE_RE } from './locale-manager.js';
import { documents } from './runtime.js';

export function isSourceFile(uri: string): boolean {
  return /\.(vue|tsx?|jsx?)$/i.test(uri);
}

// Is this file inside a localeDir of ANY configured context? Locale files are
// identified before source files: a TS locale module must never get source
// diagnostics, completions or inlay hints.
export function localeDirOfFile(filePath: string): { context: ProjectContext; dir: string; relative: string } | undefined {
  const normalized = normalizeFsPath(path.resolve(filePath));
  for (const context of getAllConfiguredContexts()) {
    const contextRoot = normalizeFsPath(context.root);
    for (const dir of context.config.localeDirs || []) {
      const absDir = normalizeFsPath(path.resolve(contextRoot, dir));
      if (!isPathInside(normalized, absDir) || normalized === absDir) continue;
      const relative = normalized.slice(absDir.length + 1);
      const depth = relative.split('/').length - 1;
      // Only files directly under the localeDir or one level deep (the locale
      // directory itself) are locale files, matching the loaders.
      if (depth <= 1) return { context, dir: absDir, relative };
    }
  }
  return undefined;
}

export function isLocaleFileUri(uri: string): boolean {
  let filePath: string;
  try { filePath = fileURLToPath(uri); } catch { return false; }
  const info = localeDirOfFile(filePath);
  return !!info && LOCALE_FILE_RE.test(filePath);
}

export function isLocaleDocument(document: { uri: string }): boolean {
  try { return isLocaleFileUri(document.uri); } catch { return false; }
}

export function findLocaleForFile(locales: LocaleMap, filePath: string): Locale | undefined {
  const target = path.resolve(filePath);
  for (const locale of Object.values(locales)) {
    const files = locale.files?.length ? locale.files : (locale.path ? [locale.path] : []);
    if (files.some((file) => path.resolve(file) === target)) return locale;
  }
  return undefined;
}

const IGNORED_SCAN_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', '.output', '.next', '.nuxt', '.cache']);
const MAX_SCAN_FILES = 5000;

export function collectSourceFiles(root: string, excludedRoots: string[] = []): string[] {
  const files: string[] = [];
  const stack = [root];
  const excluded = excludedRoots.map((entry) => normalizeFsPath(entry));
  const localeDirs = getAllConfiguredContexts()
    .flatMap((context) => (context.config.localeDirs || [])
      .map((dir) => normalizeFsPath(path.resolve(context.root, dir))));
  while (stack.length && files.length < MAX_SCAN_FILES) {
    const dir = stack.pop()!;
    const normalizedDir = normalizeFsPath(dir);
    if (excluded.some((entry) => isPathInside(normalizedDir, entry))) continue;
    if (localeDirs.some((entry) => normalizedDir === entry || normalizedDir.startsWith(entry + '/'))) continue;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || IGNORED_SCAN_DIRS.has(entry.name)) continue;
        stack.push(full);
      } else if (isSourceFile(entry.name)) {
        files.push(full);
      }
    }
  }
  return files;
}

// Resolve the i18n key under `position`, whether the caret sits on a t()/keypath
// usage in source code or on a key inside a locale JSON/TS file.
export function resolveKeyAtPosition(uri: string, position: Position, context: ProjectContext): string | undefined {
  const filePath = fileURLToPath(uri);
  const text = documents.get(uri)?.getText() ?? readFileSafe(filePath);
  if (!text) return undefined;
  const { locales } = loadLocalesForContext(context);
  const locale = findLocaleForFile(locales, filePath);
  // Locale membership wins over the .ts source check: a caret on a key inside
  // en.ts / zh/index.ts must resolve to the flattened key, never to source
  // call sites (which would also spuriously match object literals).
  if (locale) return localeKeyAtPosition(locale, filePath, text, position);
  if (isSourceFile(uri) && !isLocaleFileUri(uri)) return keyAtPosition(text, position)?.key;
  return undefined;
}

// Every source-code usage of `key` inside this context only: files under the
// context root, excluding roots of other configured packages and locale
// directories, plus open (possibly unsaved) source documents belonging to the
// context that do not exist on disk yet. Open text wins over disk text.
export function collectCodeReferences(context: ProjectContext, key: string): { uri: string; range: Range }[] {
  const contextRoot = normalizeFsPath(context.root);
  const nestedRoots = getAllConfiguredContexts()
    .map((candidate) => normalizeFsPath(candidate.root))
    .filter((root) => root !== contextRoot && isPathInside(root, contextRoot));

  const locations: { uri: string; range: Range }[] = [];
  const scanned = new Set<string>();
  const scan = (filePath: string, text: string | undefined, uri?: string): void => {
    const resolved = normalizeFsPath(path.resolve(filePath));
    if (scanned.has(resolved)) return;
    scanned.add(resolved);
    if (text === undefined) return;
    for (const range of findCodeKeyRanges(text, key)) {
      locations.push({ uri: uri ?? pathToFileURL(filePath).toString(), range });
    }
  };

  for (const filePath of collectSourceFiles(context.root, nestedRoots)) {
    scan(filePath, openDocumentText(filePath) ?? readFileSafe(filePath));
  }

  for (const doc of documents.all()) {
    let filePath: string;
    try { filePath = fileURLToPath(doc.uri); } catch { continue; }
    if (!isSourceFile(filePath)) continue;
    const resolved = normalizeFsPath(path.resolve(filePath));
    if (!isPathInside(resolved, contextRoot)) continue;
    if (nestedRoots.some((root) => isPathInside(resolved, root))) continue;
    if (isLocaleFileUri(doc.uri)) continue;
    scan(filePath, doc.getText(), doc.uri);
  }
  return locations;
}
