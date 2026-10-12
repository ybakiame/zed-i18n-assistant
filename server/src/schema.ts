// JSON Schema (draft-07) for the project config file `.zed/i18n-assistant.json`.
//
// This object is the single source of truth for editor completion, hover
// documentation and validation. `bun run schema:build` serializes it to
// `schema/i18n-assistant.schema.json`, which is what the documented `$schema`
// URL points at. Keep the fields in sync with the normalization in `config.ts`;
// `tests/schema.test.ts` validates the example against it and guards drift.

export interface JsonSchema {
  $schema?: string;
  $id?: string;
  title?: string;
  description?: string;
  type?: 'object' | 'array' | 'string' | 'boolean' | 'integer' | 'number';
  properties?: Record<string, JsonSchema>;
  additionalProperties?: boolean;
  required?: string[];
  items?: JsonSchema;
  enum?: readonly string[];
  default?: string | number | boolean | readonly unknown[];
  examples?: readonly unknown[];
  minimum?: number;
}

const localeDirsSchema: JsonSchema = {
  type: 'array',
  items: { type: 'string' },
  examples: [['src/locales', 'src/i18n']],
};

const inlayHintsSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean', default: true, description: 'Whether this language server emits inline translation hints. This is the extension option; it is separate from Zed\'s global `inlay_hints.enabled` (default false), which must also be on in settings.json or nothing renders.' },
    maxLength: { type: 'integer', minimum: 1, default: 24, description: 'Maximum inline hint label length before truncation. Hover still shows the full text.' },
  },
};

export const i18nAssistantSchema: JsonSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://raw.githubusercontent.com/ybakiame/zed-i18n-assistant/main/schema/i18n-assistant.schema.json',
  title: 'i18n Assistant configuration',
  description: 'Project configuration for the i18n Assistant Zed extension, stored in .zed/i18n-assistant.json.',
  type: 'object',
  additionalProperties: false,
  properties: {
    $schema: { type: 'string', description: 'Path or URL of this JSON Schema (for editor completion and validation).' },
    defaultLocale: { type: 'string', default: 'zh-CN', description: 'Locale used for completion details and inline translation hints. Supports exact names such as en-US, case-insensitive matching, _/- normalization and language aliases such as en matching en-US.' },
    localeDirs: { ...localeDirsSchema, description: 'Directories scanned for locale files. At the root they are workspace-relative (e.g. src/locales).' },
    inlayHints: inlayHintsSchema,
    rawTextDiagnostics: { type: 'boolean', default: false, description: 'Opt-in warnings for likely untranslated Vue/HTML template text and selected attributes. No automatic extraction.' },
    packages: {
      type: 'array',
      description: 'Optional monorepo package contexts. The language server picks the package whose root is the longest path prefix of the edited file.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['root'],
        properties: {
          root: { type: 'string', description: 'Workspace-relative package root, e.g. apps/web or packages/shared.' },
          defaultLocale: { type: 'string', description: 'Overrides the root-level defaultLocale for files in this package.' },
          localeDirs: { ...localeDirsSchema, description: "This package's own locale dirs, resolved relative to the package root." },
          localeDirsMode: {
            enum: ['append', 'override'],
            default: 'append',
            description: "How this package's localeDirs combine with the workspace-level ones. append (default) merges the workspace-level dirs (resolved from the workspace root) with the package's own dirs (resolved from the package root); override uses only the package's own dirs.",
          },
          inlayHints: inlayHintsSchema,
          rawTextDiagnostics: { type: 'boolean' },
        },
      },
    },
  },
};
