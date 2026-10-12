import { fileURLToPath } from 'node:url';
import { ResourceOperationKind, TextDocumentSyncKind } from 'vscode-languageserver/node';
import { loadConfig, normalizeIncomingSettings } from './config-manager.js';
import { registerHandlers } from './handlers.js';
import { scheduleProjectReload, watchConfigFile } from './project.js';
import { connection, documents, state } from './runtime.js';

export function startServer(): void {
  connection.onInitialize((params) => {
    const folderUri = params.workspaceFolders?.[0]?.uri;
    state.workspaceRoot = folderUri
      ? fileURLToPath(folderUri)
      : (params.rootUri ? fileURLToPath(params.rootUri) : process.cwd());
    state.zedSettingsConfig = normalizeIncomingSettings(params.initializationOptions);
    const editCaps = params.capabilities?.workspace?.workspaceEdit;
    state.clientSupportsDocumentChanges = editCaps?.documentChanges === true;
    const resourceOperations = editCaps?.resourceOperations;
    state.clientSupportsCreateFile = state.clientSupportsDocumentChanges
      && Array.isArray(resourceOperations)
      && resourceOperations.includes(ResourceOperationKind.Create);
    loadConfig();
    watchConfigFile();
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,
        hoverProvider: true,
        completionProvider: { triggerCharacters: ['.', '"', "'"] },
        definitionProvider: true,
        referencesProvider: true,
        inlayHintProvider: true,
        codeActionProvider: true,
      },
    };
  });

  connection.onInitialized(() => {
    // After (re)start the editor does not always re-request inlay hints for
    // already-open documents, so features only appeared after the first edit.
    // Proactively reload config/locales and ask the editor to refresh.
    scheduleProjectReload();
  });

  registerHandlers();
  documents.listen(connection);
  connection.listen();
}
