import fs from 'node:fs';
import {
  CONFIG_RELATIVE_PATH,
  mergeI18nAssistantConfig,
  normalizeI18nAssistantConfig,
  parseJsonc,
  resolveConfigPath,
  unknownConfigKeys,
} from '../config.js';
import { connection, invalidateLocaleCaches, state } from './runtime.js';

export function loadConfigIfChanged(): void {
  const configPath = resolveConfigPath(state.workspaceRoot);
  const nextMtimeMs = fs.existsSync(configPath) ? fs.statSync(configPath).mtimeMs : 0;
  if (state.configMtimeMs === nextMtimeMs) return;
  loadConfig();
  invalidateLocaleCaches();
}

export function loadConfig(): void {
  const configPath = resolveConfigPath(state.workspaceRoot);
  const settingsConfig = state.zedSettingsConfig;
  state.configMtimeMs = fs.existsSync(configPath) ? fs.statSync(configPath).mtimeMs : 0;
  if (!state.configMtimeMs) {
    state.config = normalizeI18nAssistantConfig(settingsConfig);
    logLoadedConfig('settings/defaults (no project config file)', configPath, false);
    return;
  }
  try {
    const fileConfig = parseJsonc(fs.readFileSync(configPath, 'utf8'));
    const unknown = unknownConfigKeys(fileConfig);
    if (unknown.length) {
      connection.console.warn(
        'i18n-assistant: ignoring unknown key(s) in ' + CONFIG_RELATIVE_PATH + ': ' + unknown.join(', ')
        + '. Config keys belong at the top level of the file — there is no "settings" wrapper in the project file '
        + '(that wrapper is only for lsp.i18n-assistant.settings in settings.json).',
      );
    }
    state.config = normalizeI18nAssistantConfig(mergeI18nAssistantConfig(settingsConfig, fileConfig as Record<string, unknown>));
    logLoadedConfig('project config file', configPath, true);
  } catch (error) {
    connection.console.warn('i18n-assistant: failed to load ' + CONFIG_RELATIVE_PATH + ': ' + (error as Error).message);
    state.config = normalizeI18nAssistantConfig(settingsConfig);
    logLoadedConfig('settings/defaults (' + CONFIG_RELATIVE_PATH + ' failed to parse)', configPath, false);
  }
}

// One greppable line per (re)load so "which config path / workspace root / dirs
// did the server actually use" is visible in the language server logs.
function logLoadedConfig(source: string, configPath: string, fromFile: boolean): void {
  const { defaultLocale, localeDirs, packages } = state.config;
  connection.console.info(
    'i18n-assistant: config loaded from ' + source
    + ' | workspaceRoot=' + state.workspaceRoot
    + ' | file=' + (fromFile ? configPath : '(none)')
    + ' | defaultLocale=' + defaultLocale
    + ' | localeDirs=[' + localeDirs.join(', ') + ']'
    + ' | packages=' + packages.length,
  );
}

// Zed passes the language-server settings either wrapped in an `i18n-assistant`
// namespace or bare, depending on the client; accept both shapes.
export function normalizeIncomingSettings(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  const namespaced = record['i18n-assistant'];
  return namespaced && typeof namespaced === 'object'
    ? namespaced as Record<string, unknown>
    : record;
}
