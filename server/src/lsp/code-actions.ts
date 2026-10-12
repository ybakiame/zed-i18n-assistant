import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CodeActionKind, CreateFile, TextDocumentEdit, type CodeAction } from 'vscode-languageserver/node';
import { insertNestedJsonKey } from '../locale/json.js';
import { offsetToPosition } from '../text/positions.js';
import type { I18nDiagnostic, Locale, LocaleMap, ProjectContext, Range } from '../types.js';
import { documentVersion, openDocument, openDocumentText, readFileSafe } from './fs.js';
import { loadLocalesForContext } from './locale-manager.js';
import { state } from './runtime.js';

interface EditPlan {
  uri: string;
  version: number | null;
  text: string;
  newText: string;
  create: boolean;
}

export function getCreateKeyActions(diagnostics: I18nDiagnostic[], context: ProjectContext): CodeAction[] {
  if (!state.clientSupportsDocumentChanges) return [];
  const { locales, localeTexts } = loadLocalesForContext(context);
  const actions: CodeAction[] = [];
  for (const diagnostic of diagnostics) {
    const key = diagnostic.data?.key;
    const missingLocales = diagnostic.data?.missingLocales;
    if (!key || !Array.isArray(missingLocales) || missingLocales.length === 0) continue;

    const missing = missingLocales.filter((name) => locales[name] && !Object.hasOwn(locales[name]!.flat, key));
    const plans = missing.map((name) => planKeyInsertion(key, locales[name]!, locales, localeTexts));
    // Do not offer a partial repair of a multi-locale diagnostic.
    if (!plans.length || plans.some((plan) => !plan || (plan.create && !state.clientSupportsCreateFile))) continue;
    const documentChanges = [];
    for (const plan of plans) {
      if (!plan) continue;
      // If a file appeared after this action was computed, fail rather than
      // inserting into unrelated content at a stale offset.
      if (plan.create) documentChanges.push(CreateFile.create(plan.uri));
      documentChanges.push(TextDocumentEdit.create({ uri: plan.uri, version: plan.version }, [minimalTextEdit(plan.text, plan.newText)]));
    }
    actions.push({
      title: `Create i18n key "${key}" in ${plans.length} locale file(s)`,
      kind: CodeActionKind.QuickFix,
      diagnostics: [diagnostic],
      edit: { documentChanges },
    });
  }
  return actions;
}

// Namespace routing follows loaded file stems. Index-owned prefixes and
// overlapping layouts are not guessed; ambiguous targets disable the action.
function planKeyInsertion(key: string, locale: Locale, locales: LocaleMap, localeTexts: Record<string, string>): EditPlan | undefined {
  if (!locale) return undefined;
  if (!locale.directories?.length) {
    const files = locale.files || [];
    return files.length === 1 && /\.json$/i.test(files[0]!)
      ? insertInto(files[0]!, key) : undefined;
  }
  if (locale.directories.length !== 1 || locale.topLevelFiles?.length) return undefined;
  const directory = locale.directories[0]!;
  const targets = filesByStem(locale);
  const namespaceFiles = [...targets.keys()].filter((stem) => stem !== 'index' && key.startsWith(stem + '.'));
  if (namespaceFiles.length > 1 || targets.has(key)) return undefined;
  const indexFiles = targets.get('index') || [];
  const indexFile = indexFiles.length === 1 && /\.json$/i.test(indexFiles[0]!) ? indexFiles[0] : undefined;
  let indexOwnsPrefix = false;
  if (indexFiles.length) {
    if (!indexFile) return undefined;
    try {
      const text = localeTexts[indexFile]!;
      const prefix = key.split('.')[0]!;
      // A whitespace-only index owns nothing; treat it like an empty object.
      indexOwnsPrefix = Object.keys(JSON.parse(text.trim() ? text : '{}'))
        .some((existing) => existing === prefix || existing.startsWith(prefix + '.'));
    } catch { return undefined; }
  }
  if (namespaceFiles.length) {
    if (indexOwnsPrefix) return undefined;
    const stem = namespaceFiles[0]!;
    const files = targets.get(stem)!;
    return files.length === 1 && /\.json$/i.test(files[0]!)
      ? insertInto(files[0]!, key.slice(stem.length + 1)) : undefined;
  }
  if (indexOwnsPrefix) return insertInto(indexFile!, key);

  const siblingStems = new Map<string, string[]>();
  for (const sibling of Object.values(locales)) {
    if (sibling === locale || sibling.directories?.length !== 1 || sibling.topLevelFiles?.length) continue;
    for (const [stem, files] of filesByStem(sibling)) {
      if (stem === 'index' || !key.startsWith(stem + '.')) continue;
      siblingStems.set(stem, (siblingStems.get(stem) || []).concat(files));
    }
  }
  if (siblingStems.size > 1) return undefined;
  if (siblingStems.size === 1) {
    const [stem, files] = siblingStems.entries().next().value!;
    if (files.some((file) => !/\.json$/i.test(file))) return undefined;
    return insertOrCreate(path.join(directory, stem + '.json'), key.slice(stem.length + 1));
  }
  return indexFile ? insertInto(indexFile, key) : undefined;
}

function filesByStem(locale: Locale): Map<string, string[]> {
  const stems = new Map<string, string[]>();
  for (const file of locale.files || []) {
    const stem = path.basename(file, path.extname(file));
    if (!stems.has(stem)) stems.set(stem, []);
    stems.get(stem)!.push(file);
  }
  return stems;
}

function insertInto(filePath: string, lookupKey: string): EditPlan | undefined {
  if (!lookupKey) return undefined;
  const text = openDocumentText(filePath) ?? readFileSafe(filePath);
  if (text === undefined) return undefined;
  // A whitespace-only file has no JSON structure to insert into; seed it like
  // an empty object (matching its line-ending style) so the fix still lands
  // instead of silently disappearing.
  const source = text.trim() ? text : (text.includes('\r\n') ? '{}\r\n' : '{}\n');
  const newText = insertNestedJsonKey(source, lookupKey, '');
  if (newText === undefined) return undefined;
  return toEditPlan(filePath, text, newText, false);
}

// Prefer an in-place insert when the file exists or is open as a buffer (the
// file may have been deleted on disk while its document stays alive); fall
// back to a CreateFile only when there is truly nothing to edit.
function insertOrCreate(filePath: string, lookupKey: string): EditPlan | undefined {
  if (fs.existsSync(filePath) || openDocument(filePath)) return insertInto(filePath, lookupKey);
  return createIn(filePath, lookupKey);
}

// Create a missing namespace JSON file: only ever proposed with a CreateFile
// operation ahead of the text edit, and only when the file truly does not
// exist — never as a fallback guess.
function createIn(filePath: string, lookupKey: string): EditPlan | undefined {
  if (!lookupKey || fs.existsSync(filePath) || openDocument(filePath)) return undefined;
  const newText = insertNestedJsonKey('{}\n', lookupKey, '');
  if (newText === undefined) return undefined;
  return toEditPlan(filePath, '', newText, true);
}

function toEditPlan(filePath: string, text: string, newText: string, create: boolean): EditPlan {
  return { uri: pathToFileURL(filePath).toString(), version: documentVersion(filePath), text, newText, create };
}

// Smallest single edit turning `oldText` into `newText`: trim the shared
// prefix/suffix instead of replacing the whole document.
function minimalTextEdit(oldText: string, newText: string): { range: Range; newText: string } {
  let start = 0;
  const maxStart = Math.min(oldText.length, newText.length);
  while (start < maxStart && oldText[start] === newText[start]) start++;
  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText[endOld - 1] === newText[endNew - 1]) { endOld--; endNew--; }
  return { range: { start: offsetToPosition(oldText, start), end: offsetToPosition(oldText, endOld) }, newText: newText.slice(start, endNew) };
}
