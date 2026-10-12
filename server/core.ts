// Compatibility barrel for the pure, I/O-free core.
//
// The implementation now lives in `server/src/**` (split by domain); this file
// keeps the historical `server/core.js` entry point stable so the existing test
// suite and any external consumers can keep importing the same public API.
// New behavior should live in the `src/` modules, not here.

export {
  DEFAULT_CONFIG,
  CONFIG_RELATIVE_PATH,
  resolveConfigPath,
  normalizeI18nAssistantConfig,
  mergeI18nAssistantConfig,
  resolveProjectContext,
  didWatchedFileChange,
  parseJsonc,
  unknownConfigKeys,
} from './src/config.js';

export { flattenLocale, getValueByKey } from './src/locale/model.js';
export { parseTsLocaleModule } from './src/locale/ts-module.js';
export {
  findLocaleKeyTarget,
  collectLocaleKeyTargets,
  localeKeyAtPosition,
  collectLocaleWatchPaths,
  findJsonKeyLocation,
  findLocaleKeyLocation,
} from './src/locale/lookup.js';
export { insertNestedJsonKey } from './src/locale/json.js';
export { resolvePreferredLocale, getDefinitionLocaleOrder } from './src/locale/select.js';
export { extractI18nKeys, keyAtPosition, findCodeKeyRanges, getCompletionPrefix } from './src/keys/extract.js';
export { positionToOffset } from './src/text/positions.js';
export {
  getDiagnostics,
  getLocaleParamConsistency,
  getLocaleParamDiagnostics,
  getParamCodeActions,
  extractPlaceholders,
} from './src/features/diagnostics.js';
export { getCompletions } from './src/features/completions.js';
export { buildHoverMarkdown } from './src/features/hover.js';
export { getInlayHints } from './src/features/inlay.js';
export { isLikelyUserFacingText, getRawTextDiagnostics } from './src/raw-text.js';
