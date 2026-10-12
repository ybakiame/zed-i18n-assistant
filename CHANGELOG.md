# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.1] - 2026-10-09

First release of the `i18n-assistant-language-server` Zed extension.

### Added

- Node.js language server (TypeScript source in `server/`, bundled to
  `server/dist/index.js`) installed at runtime by the Zed extension from npm.
- Inline translations via LSP inlay hints, a hover table of every locale value,
  and diagnostics for missing keys, missing locale entries, and mismatched
  interpolation params.
- Completion, go-to-definition and find-references for i18n keys, including
  TS/JS locale modules and monorepo package contexts.
- Quick fixes: add/remove interpolation params and create missing keys in
  unambiguous JSON locale files using versioned edits.
- Project config file `.zed/i18n-assistant.json` (JSONC) with a published JSON
  Schema for editor completion/hover/validation, plus `lsp.i18n-assistant.settings`
  support and monorepo `packages` with `localeDirsMode` (`append`/`override`).
- Optional raw-text diagnostics for likely untranslated Vue/HTML template text
  and selected user-facing attributes.
