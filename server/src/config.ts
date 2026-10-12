import type {
  I18nAssistantConfig,
  InlayHintsConfig,
  LocaleDirsMode,
  PackageConfig,
  ProjectConfig,
  ProjectContext,
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface ConfigDefaults {
  readonly defaultLocale: string;
  readonly localeDirs: readonly string[];
  readonly inlayHints: InlayHintsConfig;
  readonly rawTextDiagnostics: boolean;
}

export const DEFAULT_CONFIG: ConfigDefaults & { readonly packages: readonly PackageConfig[] } = Object.freeze({
  defaultLocale: 'zh-CN',
  localeDirs: Object.freeze(['src/locales', 'src/i18n', 'locales', 'i18n']),
  inlayHints: Object.freeze({ enabled: true, maxLength: 24 }),
  rawTextDiagnostics: false,
  packages: Object.freeze([]) as readonly PackageConfig[],
});

export const CONFIG_RELATIVE_PATH = '.zed/i18n-assistant.json';

export function resolveConfigPath(workspaceRoot: string): string {
  return joinFsPath(normalizeFsPath(workspaceRoot), CONFIG_RELATIVE_PATH);
}

export function normalizeI18nAssistantConfig(raw: unknown = {}): I18nAssistantConfig {
  const base = normalizeProjectConfig(raw, DEFAULT_CONFIG);
  const source = isRecord(raw) ? raw : {};
  const packages = Array.isArray(source.packages)
    ? source.packages
      .map((pkg) => normalizePackageConfig(pkg, base))
      .filter((pkg): pkg is PackageConfig => pkg !== undefined)
    : [];

  return { ...base, packages };
}

export function mergeI18nAssistantConfig(
  base: Record<string, unknown> = {},
  override: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...base,
    ...override,
    inlayHints: {
      ...(isRecord(base.inlayHints) ? base.inlayHints : {}),
      ...(isRecord(override.inlayHints) ? override.inlayHints : {}),
    },
    packages: Array.isArray(override.packages) ? override.packages : base.packages,
  };
}

function normalizeProjectConfig(
  raw: unknown,
  defaults: ConfigDefaults = DEFAULT_CONFIG,
  localeDirsFallback: readonly string[] = defaults.localeDirs,
): ProjectConfig {
  const source = isRecord(raw) ? raw : {};
  const defaultLocale = typeof source.defaultLocale === 'string' && source.defaultLocale.trim()
    ? source.defaultLocale.trim()
    : defaults.defaultLocale;

  const localeDirs = Array.isArray(source.localeDirs)
    ? source.localeDirs
      .filter((dir): dir is string => typeof dir === 'string' && dir.trim() !== '')
      .map((dir) => normalizeRelativePath(dir.trim()))
    : [];

  const defaultInlayHints = defaults.inlayHints || DEFAULT_CONFIG.inlayHints;
  const rawInlayHints = isRecord(source.inlayHints) ? source.inlayHints : {};
  const enabled = typeof rawInlayHints.enabled === 'boolean' ? rawInlayHints.enabled : defaultInlayHints.enabled;
  const rawMaxLength = rawInlayHints.maxLength;
  const maxLength = typeof rawMaxLength === 'number' && Number.isInteger(rawMaxLength) && rawMaxLength > 0
    ? rawMaxLength
    : defaultInlayHints.maxLength;

  return {
    defaultLocale,
    localeDirs: localeDirs.length > 0 ? localeDirs : [...localeDirsFallback],
    inlayHints: { enabled, maxLength },
    rawTextDiagnostics: typeof source.rawTextDiagnostics === 'boolean' ? source.rawTextDiagnostics : defaults.rawTextDiagnostics,
  };
}

function normalizePackageConfig(raw: unknown, inherited: ProjectConfig): PackageConfig | undefined {
  if (!isRecord(raw)) return undefined;
  const root = typeof raw.root === 'string' && raw.root.trim()
    ? normalizeRelativePath(raw.root.trim())
    : undefined;
  if (!root) return undefined;
  const localeDirsMode: LocaleDirsMode = raw.localeDirsMode === 'override' ? 'override' : 'append';
  // A package stores only its own dirs (package-root-relative); the workspace
  // dirs are merged in later (see resolvePackageContext).
  return { root, localeDirsMode, ...normalizeProjectConfig(raw, inherited, []) };
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/g, '');
}

export function resolveProjectContext(filePath: string, workspaceRoot: string, config: I18nAssistantConfig): ProjectContext {
  const normalizedWorkspaceRoot = normalizeFsPath(workspaceRoot);
  const normalizedFilePath = normalizeFsPath(filePath);
  const candidates: ProjectContext[] = [
    { root: normalizedWorkspaceRoot, config: withoutPackages(config) },
    ...(config?.packages || []).map((pkg) => resolvePackageContext(workspaceRoot, config, pkg)),
  ];

  const matches = candidates
    .filter((candidate) => isPathInside(normalizedFilePath, candidate.root))
    .sort((a, b) => b.root.length - a.root.length);
  return matches[0] ?? candidates[0]!;
}

/**
 * Build a package's project context. The effective locale dirs depend on the
 * package's `localeDirsMode`:
 * - `append` (default): the workspace-level dirs (resolved from the workspace
 *   root, so a shared `packages/shared/src/locale` works from any package) plus
 *   the package's own dirs (resolved from the package root). Package dirs come
 *   last, so a package can override a shared key.
 * - `override`: only the package's own dirs; falls back to the workspace-level
 *   dirs when the package declares none.
 */
export function resolvePackageContext(workspaceRoot: string, config: I18nAssistantConfig, pkg: PackageConfig): ProjectContext {
  const normalizedWorkspaceRoot = normalizeFsPath(workspaceRoot);
  const globalDirs = withoutPackages(config).localeDirs.map((dir) => joinFsPath(normalizedWorkspaceRoot, dir));
  const ownDirs = pkg.localeDirs;
  const localeDirs = pkg.localeDirsMode === 'override'
    ? (ownDirs.length ? ownDirs : globalDirs)
    : [...globalDirs, ...ownDirs];
  return {
    root: normalizeFsPath(joinFsPath(normalizedWorkspaceRoot, pkg.root)),
    config: {
      defaultLocale: pkg.defaultLocale,
      localeDirs: uniquePaths(localeDirs),
      inlayHints: pkg.inlayHints,
      rawTextDiagnostics: pkg.rawTextDiagnostics,
    },
  };
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function withoutPackages(config: ProjectConfig): ProjectConfig {
  return {
    defaultLocale: config.defaultLocale,
    localeDirs: config.localeDirs,
    inlayHints: config.inlayHints,
    rawTextDiagnostics: config.rawTextDiagnostics,
  };
}

export function normalizeFsPath(value: string): string {
  return String(value || '').replace(/\\/g, '/').replace(/\/+$/g, '');
}

export function joinFsPath(root: string, relative: string): string {
  return root + '/' + normalizeRelativePath(relative || '');
}

export function isPathInside(filePath: string, root: string): boolean {
  return filePath === root || filePath.startsWith(root + '/');
}

export interface MtimeStat {
  mtimeMs?: number;
}

export function didWatchedFileChange(previous: MtimeStat | undefined, current: MtimeStat | undefined): boolean {
  return previous?.mtimeMs !== current?.mtimeMs;
}

const KNOWN_CONFIG_KEYS = new Set(['$schema', 'defaultLocale', 'localeDirs', 'inlayHints', 'rawTextDiagnostics', 'packages']);

/** Top-level keys in a project config file that the server does not recognise. */
export function unknownConfigKeys(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.keys(raw).filter((key) => !KNOWN_CONFIG_KEYS.has(key));
}

/**
 * Parse the project config file, tolerating JSONC (JSON with comments): strips
 * `//` and block comments and trailing commas before `JSON.parse`. Zed parses
 * `settings.json` as JSONC, so users reach for comments/trailing commas in the
 * project file too; without this a single one would throw and silently fall back
 * to defaults (which is how a valid config ends up "not applied").
 */
export function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      out += ch;
      if (ch === '\\') { out += text[i + 1] ?? ''; i++; }
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j]!)) j++;
      const next = text[j];
      if (next === '}' || next === ']') continue; // drop trailing comma
    }
    out += ch;
  }
  return JSON.parse(out);
}
