# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Zed extension that shows the real translation text behind i18n keys (inlay hints, hover, diagnostics, completion, definition, references) for Vue/TS/TSX/JS. It has **two parts**:

- **Rust/WASM extension shell** (`src/lib.rs`) — the thin adapter Zed loads. It does not do i18n analysis. Its job is to install the language server npm package at runtime (`npm_package_latest_version` / `npm_install_package` for `i18n-assistant-language-server`), launch it over stdio, and bridge Zed settings (`lsp.i18n-assistant.settings`) into LSP `initializationOptions` / workspace configuration.
- **Node.js language server** (`server/`) — where all real logic lives. Published to npm as `i18n-assistant-language-server`; in production Zed downloads it, so `src/lib.rs` and `server/` are versioned and released together.

The `languages` list in `extension.toml` controls which buffers Zed attaches the server to (currently `Vue.js, TypeScript, TSX, JavaScript, JSON, JSONC, HTML`). A feature that must fire inside a file type (e.g. Find References from a `.json` locale file, or raw-text diagnostics in HTML) **only works if that language is registered here** — the LSP handler is never reached otherwise.

## Server architecture (`server/`)

TypeScript source, split by domain. The two entry points must stay stable because
the test suite imports them by path (Bun resolves `../server/core.js` /
`../server/index.js` to the `.ts` sources):

- **`server/core.ts`** — a thin compatibility barrel that re-exports the pure,
  I/O-free public API from `server/src/**` (`extractI18nKeys` and its
  regex/paren-balancing helpers, locale flattening, key↔position mapping
  (`findJsonKeyLocation`, `findLocaleKeyLocation`, `localeKeyAtPosition`,
  `findCodeKeyRanges`), diagnostics, inlay hints, completions, config
  normalization/merge). **All tests target this file.** Keep the exported set
  stable; add new behavior to the modules below.
- **`server/index.ts`** — entry point; calls `startServer()` and nothing else. The
  stdio LSP tests spawn it as `../server/index.js`.
- **`server/src/`** — the implementation, layered `types ← text ← {keys, locale} ←
  features`, with all filesystem/state isolated under `server/src/lsp/`:
  - Pure (no I/O): `config.ts`, `text/{positions,lex}.ts`, `keys/extract.ts`,
    `locale/{model,json,ts-module,select,lookup}.ts`,
    `features/{diagnostics,completions,hover,inlay}.ts`, `raw-text.ts`.
  - `lsp/{runtime,fs,contexts,config-manager,locale-manager,files,project,code-actions,handlers,server}.ts`
    — the connection, `fs.watchFile` watchers, debounced reloads, locale caching,
    monorepo project-context resolution and directory walking (e.g.
    `collectSourceFiles` for Find References).
  - `lsp/runtime.ts` owns the connection, open-document store and mutable state;
    no `lsp/*` module imports another in a cycle.
- **`server/dist/`** — build output (git-ignored). `bun run build:server` bundles
  `server/index.ts` into a single Node-targeted `server/dist/index.js` (npm
  deps stay external); this is the artifact Zed installs and runs.

The project config file is `.zed/i18n-assistant.json` (path in `CONFIG_RELATIVE_PATH`). Its editor completion/hover/validation schema lives in `server/src/schema.ts`; `bun run schema:build` writes the committed `schema/i18n-assistant.schema.json` (served via the documented `$schema` raw URL), and `tests/schema.test.ts` validates the example against it and guards drift.

### Config precedence (three layers, low → high)

```
DEFAULT_CONFIG  <  Zed settings (lsp.i18n-assistant.settings)  <  .zed/i18n-assistant.json
```

`mergeI18nAssistantConfig` merges the raw objects (Zed settings as base, project file as override; `inlayHints` deep-merged), then `normalizeI18nAssistantConfig` validates. Merge before normalize — never merge normalized defaults, or they clobber lower layers. `packages` entries in config create additional monorepo project contexts, each with its own `defaultLocale`, selected by longest-matching root.

A package's effective locale dirs are driven by `localeDirsMode` (default `"append"`): `append` unions the workspace-level `localeDirs` (resolved from the workspace root) with the package's own dirs (resolved from the package root, searched last so a package can override a shared key); `override` uses only the package's own dirs. `resolvePackageContext` builds the context, and dirs may therefore be **absolute** (the merged workspace-level ones) — loaders use `path.resolve(context.root, dir)`, never `path.join`, so absolute dirs pass through.

### Locale loading nuance

A locale can be a single flat JSON file or a directory of files. Keys from nested files under a locale directory get **prefixed by the file stem** (`common.json` → `common.*`, except `index`). `lookupKeyForLocaleFile` encapsulates stripping that prefix, and `localeKeyAtPosition` restores it — key/location logic is precise for JSON and best-effort (line-based) for TS/JS locale modules. Keep both directions consistent when touching this.

## Commands

```bash
bun run test                        # all tests (bun test)
bun test tests/core.test.ts         # same suite; single file
bun test -t "Find"                  # run tests matching a name
bun run typecheck                   # tsc --noEmit (server strict; tests less strict)
bun run build:server                # bundle server/index.ts -> server/dist/index.js
bun run schema:build                # regenerate schema/i18n-assistant.schema.json
cargo check --target wasm32-wasip1  # verify the WASM shell builds
```

`bun run typecheck` runs two configs: `tsconfig.json` (server, `strict` +
`noUncheckedIndexedAccess`) and `tsconfig.tests.json` (server + `tests/`, with
`noUncheckedIndexedAccess` off to keep test fixtures readable). Run it, plus
`bun run test` and the `cargo check`, after changes (the project convention, also
in `ROADMAP.md`). On Windows the cargo binary is at `"$HOME/.cargo/bin/cargo.exe"`.

## Local iteration in Zed

`scripts/deploy-local.ps1` `npm pack`s the current working tree (uncommitted changes included) and installs it into Zed's extension work dir — then run **"restart language server"** in Zed. `npm pack` runs the `prepack` script, so the bundle is rebuilt (`server/dist`) before packing; this only updates the server JS.

**Changes to `extension.toml` or `src/lib.rs` are NOT picked up by `deploy-local.ps1`** — they require reinstalling the dev extension in Zed ("install dev extension"), which may re-fetch the published npm server, so re-run `deploy-local.ps1` afterward.

The npm package name (`i18n-assistant-language-server`) is not published during local development, so `zed::npm_package_latest_version` returns E404. `src/lib.rs` therefore falls back to the already-installed work-dir server when the latest-version lookup fails — a re-installed dev extension still starts from the local build instead of erroring.

## Releasing

Use the `zed-extension-release` skill (`.agents/skills/zed-extension-release/SKILL.md`) — it is the source of truth for the release flow, including the `CHANGELOG.md` gap check. Key points:

- A version bump touches **five files**: `extension.toml`, `Cargo.toml`, `Cargo.lock` (only the `zed-i18n-assistant` package block — never blanket-replace, it hits dependency versions), `package.json`, `bun.lock`.
- The release workflow runs `bun run typecheck`, `bun run test` and `bun run build:server` before `npm publish`; `prepack` also rebuilds the bundle for `npm pack`.
- `CHANGELOG.md` (Keep a Changelog, English, newest-first) must have an entry for every version that ever appears in `extension.toml` history — verify no gaps before releasing.
- Release is driven by pushing a `v*` tag; `.github/workflows/release.yml` runs `npm publish`. The extension is also submitted to `zed-industries/extensions` as a submodule PR.

## Conventions

- Commit messages: Chinese, conventional-commit `type: subject` (e.g. `feat: ...`, `docs: ...`). Do **not** add a `Co-Authored-By: Claude` trailer in this repo.
- Files use CRLF line endings; git may warn on LF→CRLF — expected, not an error.
- The extension id is `i18n-assistant-language-server` (Zed, suffixed per the extension publishing prerequisites since this extension only wraps a language server) and the npm package is also `i18n-assistant-language-server`; only the internal Cargo crate/repo may contain `zed` (Zed publishing rule forbids it in the extension/package names). The `[language_servers.i18n-assistant]` key in `extension.toml` and the `lsp.i18n-assistant.settings` namespace are a separate, shorter id and are unaffected by this.
