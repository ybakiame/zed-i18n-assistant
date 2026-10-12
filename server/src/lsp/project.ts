import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import {
  didWatchedFileChange,
  resolveConfigPath,
  resolveProjectContext,
} from '../config.js';
import { collectLocaleWatchPaths } from '../locale/lookup.js';
import { getDiagnostics, getLocaleParamDiagnostics } from '../features/diagnostics.js';
import { getRawTextDiagnostics } from '../raw-text.js';
import type { ProjectContext } from '../types.js';
import { loadConfig, loadConfigIfChanged } from './config-manager.js';
import { getAllConfiguredContexts } from './contexts.js';
import { findLocaleForFile, isLocaleFileUri, isSourceFile } from './files.js';
import { loadLocalesForContext } from './locale-manager.js';
import {
  configWatchIntervalMs,
  connection,
  documents,
  invalidateLocaleCaches,
  localeWatchIntervalMs,
  reloadDebounceMs,
  state,
} from './runtime.js';

export function getProjectContext(uri: string): ProjectContext {
  loadConfigIfChanged();
  const filePath = uri ? fileURLToPath(uri) : state.workspaceRoot;
  return resolveProjectContext(filePath, state.workspaceRoot, state.config);
}

export function watchConfigFile(): void {
  const configPath = resolveConfigPath(state.workspaceRoot);
  if (state.watchedConfigPath === configPath) return;
  if (state.watchedConfigPath) fs.unwatchFile(state.watchedConfigPath);
  state.watchedConfigPath = configPath;
  fs.watchFile(configPath, { interval: configWatchIntervalMs }, (current, previous) => {
    if (didWatchedFileChange(previous, current)) scheduleProjectReload();
  });
}

export function watchLocalePaths(): void {
  const nextPaths = new Set<string>();
  const contexts = getAllConfiguredContexts();
  for (const context of contexts) {
    const configuredDirs = context.config.localeDirs
      .map((dir) => path.resolve(context.root, dir))
      .filter((dir) => fs.existsSync(dir));
    const loaded = loadLocalesForContext(context);
    for (const watchPath of collectLocaleWatchPaths(loaded.locales, configuredDirs)) nextPaths.add(watchPath);
  }

  for (const watchedPath of state.watchedLocalePaths) {
    if (nextPaths.has(watchedPath)) continue;
    fs.unwatchFile(watchedPath);
    state.watchedLocalePaths.delete(watchedPath);
  }

  for (const watchedPath of nextPaths) {
    if (state.watchedLocalePaths.has(watchedPath)) continue;
    state.watchedLocalePaths.add(watchedPath);
    fs.watchFile(watchedPath, { interval: localeWatchIntervalMs }, (current, previous) => {
      if (didWatchedFileChange(previous, current)) scheduleProjectReload();
    });
  }
}

export function scheduleProjectReload(): void {
  clearTimeout(state.reloadTimer);
  state.reloadTimer = setTimeout(() => {
    loadConfig();
    invalidateLocaleCaches();
    watchLocalePaths();
    refreshOpenDocuments();
    refreshInlayHints();
  }, reloadDebounceMs);
}

export function refreshOpenDocuments(): void {
  for (const doc of documents.all()) validate(doc);
}

export function refreshInlayHints(): void {
  try {
    connection.languages.inlayHint.refresh?.();
  } catch (error) {
    connection.console.warn('Failed to refresh inlay hints: ' + (error as Error).message);
  }
}

export function validate(document: TextDocument): void {
  const context = getProjectContext(document.uri);
  const { locales } = loadLocalesForContext(context);
  const templateLanguage = /\.vue$/i.test(document.uri) ? 'vue'
    : /\.html?$/i.test(document.uri) || document.languageId === 'html' ? 'html' : undefined;
  if ((isSourceFile(document.uri) || templateLanguage) && !isLocaleFileUri(document.uri)) {
    const text = document.getText();
    const diagnostics = [
      ...getDiagnostics(text, locales),
      ...getRawTextDiagnostics(text, templateLanguage, context.config.rawTextDiagnostics),
    ];
    connection.sendDiagnostics({ uri: document.uri, diagnostics });
    return;
  }
  const filePath = fileURLToPath(document.uri);
  const locale = findLocaleForFile(locales, filePath);
  if (!locale) return;
  connection.sendDiagnostics({ uri: document.uri, diagnostics: getLocaleParamDiagnostics(locale, filePath, document.getText(), locales) });
}
