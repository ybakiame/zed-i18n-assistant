import { pathToFileURL } from 'node:url';
import { CodeActionKind, MarkupKind, TextDocumentEdit, type CodeAction } from 'vscode-languageserver/node';
import { getCompletions } from '../features/completions.js';
import { getParamCodeActions } from '../features/diagnostics.js';
import { buildHoverMarkdown } from '../features/hover.js';
import { getInlayHints } from '../features/inlay.js';
import { getCompletionPrefix, keyAtPosition } from '../keys/extract.js';
import { collectLocaleKeyTargets } from '../locale/lookup.js';
import type { I18nDiagnostic } from '../types.js';
import { getCreateKeyActions } from './code-actions.js';
import { normalizeIncomingSettings } from './config-manager.js';
import {
  collectCodeReferences,
  isLocaleDocument,
  isLocaleFileUri,
  isSourceFile,
  resolveKeyAtPosition,
} from './files.js';
import { loadLocalesForContext } from './locale-manager.js';
import { getProjectContext, refreshInlayHints, refreshOpenDocuments, scheduleProjectReload, validate } from './project.js';
import { connection, documents, invalidateLocaleCaches, state } from './runtime.js';

export function registerHandlers(): void {
  documents.onDidOpen((event) => {
    if (isLocaleDocument(event.document)) {
      // An open (possibly dirty) locale document overrides the disk copy, so a
      // previously cached load is stale the moment the file opens.
      invalidateLocaleCaches();
    }
    validate(event.document);
    // A freshly started server may receive the inlay-hint request before the
    // locale cache is ready; prompt the editor to re-request once it is.
    refreshInlayHints();
  });

  documents.onDidChangeContent((event) => {
    if (isLocaleDocument(event.document)) {
      // Open locale text feeds the cache, so it must be dropped now — the very
      // next request must already see this snapshot, not a debounced reload.
      invalidateLocaleCaches();
      refreshOpenDocuments();
      refreshInlayHints();
      return;
    }
    validate(event.document);
  });

  // An open locale document overrides the disk copy. Closing it reverts to
  // disk, which is also a content change for every feature.
  documents.onDidClose((event) => {
    if (!isLocaleDocument(event.document)) return;
    invalidateLocaleCaches();
    refreshOpenDocuments();
    refreshInlayHints();
  });

  documents.onDidSave(() => scheduleProjectReload());

  connection.onDidChangeConfiguration((params) => {
    state.zedSettingsConfig = normalizeIncomingSettings(params.settings);
    scheduleProjectReload();
  });

  connection.onHover((params) => {
    if (isLocaleFileUri(params.textDocument.uri)) return null;
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const item = keyAtPosition(doc.getText(), params.position);
    if (!item) return null;
    const context = getProjectContext(params.textDocument.uri);
    const { locales } = loadLocalesForContext(context);
    return {
      contents: { kind: MarkupKind.Markdown, value: buildHoverMarkdown(item.key, locales) },
      range: item.range,
    };
  });

  connection.onCompletion((params) => {
    if (!isSourceFile(params.textDocument.uri) || isLocaleFileUri(params.textDocument.uri)) return [];
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const prefix = getCompletionPrefix(doc.getText(), params.position);
    // undefined = caret is not inside an i18n call; '' = empty key prefix.
    if (prefix === undefined) return [];
    const context = getProjectContext(params.textDocument.uri);
    const { locales } = loadLocalesForContext(context);
    return getCompletions(prefix, locales, context.config.defaultLocale);
  });

  connection.languages.inlayHint.on((params) => {
    if (!isSourceFile(params.textDocument.uri) || isLocaleFileUri(params.textDocument.uri)) return [];
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return [];
    const context = getProjectContext(params.textDocument.uri);
    const { locales } = loadLocalesForContext(context);
    return getInlayHints(doc.getText(), params.range, locales, context.config.defaultLocale, context.config.inlayHints);
  });

  connection.onDefinition((params) => {
    if (isLocaleFileUri(params.textDocument.uri)) return null;
    const doc = documents.get(params.textDocument.uri);
    if (!doc) return null;
    const item = keyAtPosition(doc.getText(), params.position);
    if (!item) return null;
    const context = getProjectContext(params.textDocument.uri);
    const { locales, localeTexts } = loadLocalesForContext(context);
    const locations = collectLocaleKeyTargets(locales, item.key, localeTexts, context.config.defaultLocale)
      .map(({ filePath, range }) => ({ uri: pathToFileURL(filePath).toString(), range }));
    return locations.length ? locations : null;
  });

  connection.onReferences((params) => {
    const uri = params.textDocument.uri;
    const context = getProjectContext(uri);
    const key = resolveKeyAtPosition(uri, params.position, context);
    if (!key) return null;

    const locations = collectCodeReferences(context, key);
    if (params.context?.includeDeclaration) {
      const { locales, localeTexts } = loadLocalesForContext(context);
      for (const { filePath, range } of collectLocaleKeyTargets(locales, key, localeTexts, context.config.defaultLocale)) {
        locations.push({ uri: pathToFileURL(filePath).toString(), range });
      }
    }
    return locations.length ? locations : null;
  });

  connection.onCodeAction((params) => {
    const doc = documents.get(params.textDocument.uri);
    const diagnostics = (params.context.diagnostics || []) as I18nDiagnostic[];
    const actions: CodeAction[] = [];
    if (state.clientSupportsDocumentChanges && doc && isSourceFile(params.textDocument.uri) && !isLocaleFileUri(params.textDocument.uri)) {
      for (const action of getParamCodeActions(doc.getText(), diagnostics)) {
        actions.push({
          title: action.title,
          kind: CodeActionKind.QuickFix,
          diagnostics: [action.diagnostic],
          edit: { documentChanges: [TextDocumentEdit.create({ uri: doc.uri, version: doc.version }, [action.edit])] },
        });
      }
    }
    actions.push(...getCreateKeyActions(diagnostics, getProjectContext(params.textDocument.uri)));
    return actions;
  });
}
