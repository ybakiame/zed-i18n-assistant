import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { documents } from './runtime.js';

/** The open (possibly unsaved) document backed by `filePath`, if any. */
export function openDocument(filePath: string): TextDocument | undefined {
  let target: string;
  try { target = path.resolve(filePath); } catch { return undefined; }
  for (const doc of documents.all()) {
    try {
      if (path.resolve(fileURLToPath(doc.uri)) === target) return doc;
    } catch { /* non-file uri */ }
  }
  return undefined;
}

/** In-memory text of an open (possibly unsaved) document for filePath. */
export function openDocumentText(filePath: string): string | undefined {
  return openDocument(filePath)?.getText();
}

export function readFileSafe(filePath: string): string | undefined {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return undefined; }
}

// Prefer the open document's current text; fall back to disk.
export function localeText(filePath: string): string | undefined {
  return openDocumentText(filePath) ?? readFileSafe(filePath);
}

// Document version for an annotated TextDocumentEdit: the exact version for an
// open document, null when the file is not open in the editor.
export function documentVersion(filePath: string): number | null {
  return openDocument(filePath)?.version ?? null;
}
