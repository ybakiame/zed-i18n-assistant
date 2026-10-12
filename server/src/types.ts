// Shared structural types for the language server core.
//
// `Position`/`Range` intentionally mirror the LSP shapes structurally so the
// pure core layer stays independent of `vscode-languageserver` while remaining
// assignable to the protocol types where it is handed back to the connection.

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

/** Plain UTF-16 offset span used by the lexer and extraction helpers. */
export interface OffsetRange {
  start: number;
  end: number;
}

/**
 * A locale can be a single flat file (`en.json` / `en.ts`) or a directory of
 * files (`en/common.json`). `files` holds every backing file; `directories`
 * and `topLevelFiles` are only present for the corresponding layouts.
 */
export interface Locale {
  path: string;
  flat: Record<string, string>;
  /** Backing files; optional — consumers fall back to `path` when absent. */
  files?: string[];
  /** Present for directory locales: the locale directory/directories. */
  directories?: string[];
  /** Present for top-level locale files (en.json, en.ts, ...). */
  topLevelFiles?: string[];
}

export type LocaleMap = Record<string, Locale>;

export interface LoadedLocales {
  locales: LocaleMap;
  localeTexts: Record<string, string>;
}

export interface ParamsEdit {
  insertOffset: number;
  prefix: string;
  suffix?: string;
}

export interface ParamsObjectProp {
  name: string | undefined;
  text: string;
}

export interface ParamsObject {
  start: number;
  end: number;
  props: ParamsObjectProp[];
}

export interface I18nKeyItem {
  key: string;
  range: Range;
  startOffset: number;
  endOffset: number;
  providedParams?: string[];
  paramsEdit?: ParamsEdit;
  paramsObject?: ParamsObject;
}

export interface InlayHintsConfig {
  enabled: boolean;
  maxLength: number;
}

export interface ProjectConfig {
  defaultLocale: string;
  localeDirs: string[];
  inlayHints: InlayHintsConfig;
  rawTextDiagnostics: boolean;
}

export type LocaleDirsMode = 'append' | 'override';

export interface PackageConfig extends ProjectConfig {
  root: string;
  /**
   * How this package's `localeDirs` combine with the workspace-level ones:
   * - `append` (default): workspace-level dirs (resolved from the workspace root)
   *   plus the package's own dirs (resolved from the package root); a key defined
   *   in both is overridden by the package's own file.
   * - `override`: only the package's own dirs (workspace-level dirs excluded);
   *   falls back to the workspace-level dirs when none are declared.
   */
  localeDirsMode: LocaleDirsMode;
}

export interface I18nAssistantConfig extends ProjectConfig {
  packages: PackageConfig[];
}

export interface ProjectContext {
  root: string;
  config: ProjectConfig;
}

export type DiagnosticSeverity = 1 | 2 | 3 | 4;

export interface ParamConsistencyEntry {
  name: string;
  params: string[];
}

export interface DiagnosticData {
  key?: string;
  missingLocales?: string[];
  missingInAllLocales?: boolean;
  missingParams?: string[];
  unusedParams?: string[];
  paramInconsistency?: ParamConsistencyEntry[];
  [key: string]: unknown;
}

export interface I18nDiagnostic {
  severity: DiagnosticSeverity;
  range: Range;
  message: string;
  source?: string;
  code?: string;
  data?: DiagnosticData;
}

export interface LocaleKeyTarget {
  filePath: string;
  position?: Position;
  range?: Range;
}

export interface CompletionItemLike {
  label: string;
  kind: 12;
  detail: string | undefined;
  insertText: string;
}

export interface InlayHintLike {
  position: Position;
  label: string;
  paddingLeft: boolean;
  tooltip: string;
}

export interface ParamCodeAction {
  title: string;
  diagnostic: I18nDiagnostic;
  edit: { range: Range; newText: string };
}
