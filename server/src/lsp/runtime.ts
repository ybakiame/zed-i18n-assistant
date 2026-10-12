import { createConnection, ProposedFeatures, TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { normalizeI18nAssistantConfig } from '../config.js';
import type { I18nAssistantConfig, LoadedLocales } from '../types.js';

// Single owner of the connection, the open-document store and the mutable
// server state. Other `lsp/*` modules import from here and never the reverse,
// which keeps the dependency graph acyclic.
export const connection = createConnection(ProposedFeatures.all);
export const documents = new TextDocuments(TextDocument);

export interface ServerState {
  workspaceRoot: string;
  zedSettingsConfig: Record<string, unknown>;
  config: I18nAssistantConfig;
  watchedConfigPath: string | undefined;
  watchedLocalePaths: Set<string>;
  reloadTimer: ReturnType<typeof setTimeout> | undefined;
  configMtimeMs: number;
  clientSupportsDocumentChanges: boolean;
  clientSupportsCreateFile: boolean;
  localeCacheByContext: Map<string, LoadedLocales>;
}

export const state: ServerState = {
  workspaceRoot: process.cwd(),
  zedSettingsConfig: {},
  config: normalizeI18nAssistantConfig(),
  watchedConfigPath: undefined,
  watchedLocalePaths: new Set(),
  reloadTimer: undefined,
  configMtimeMs: 0,
  clientSupportsDocumentChanges: false,
  clientSupportsCreateFile: false,
  localeCacheByContext: new Map(),
};

export const configWatchIntervalMs = 1000;
export const localeWatchIntervalMs = 1000;
export const reloadDebounceMs = 100;

export function invalidateLocaleCaches(): void {
  state.localeCacheByContext = new Map();
}
