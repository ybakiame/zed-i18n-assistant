import type { I18nKeyItem, OffsetRange, ParamsEdit, ParamsObject, Position, Range } from '../types.js';
import { computeOpaqueRanges, isOpaque } from '../text/lex.js';
import { makeRange, positionToOffset } from '../text/positions.js';

interface ArgWithOffset {
  text: string;
  start: number;
  end: number;
}

export function extractI18nKeys(text: string): I18nKeyItem[] {
  const found: I18nKeyItem[] = [];
  const opaque = computeOpaqueRanges(text);
  collectFunctionCallKeys(text, found, opaque);
  collectFormatMessageKeys(text, found, opaque);
  const patterns = [
    // <i18n-t keypath="key"> (Vue I18n) and <Trans i18nKey="key"> (react-i18next)
    /\b(?:keypath|i18nKey)\s*=\s*(['"])([A-Za-z0-9_.:-]+)\1/g,
    /\bv-t\s*=\s*"'([A-Za-z0-9_.:-]+)'"/g,
    /\bv-t\s*=\s*'"([A-Za-z0-9_.:-]+)"'/g,
    /\bv-t\s*=\s*"\s*\{\s*path\s*:\s*(['"])([A-Za-z0-9_.:-]+)\1/g,
  ];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) {
      const before = text[match.index - 1];
      // Literal attribute only — bound directives (`:keypath`, `@`, `#`, `.prop`)
      // hold expressions handled by the call scanner, not a literal key.
      if (before !== undefined && /[\w:@#.-]/.test(before)) continue;
      if (isOpaque(opaque, match.index)) continue;
      const key = match[2] || match[1] || '';
      const keyOffsetInMatch = match[0]!.lastIndexOf(key);
      const start = match.index + keyOffsetInMatch;
      const end = start + key.length;
      found.push({ key, range: makeRange(text, start, end), startOffset: start, endOffset: end });
    }
  }
  found.sort((a, b) => a.startOffset - b.startOffset);
  return found;
}

function collectFunctionCallKeys(text: string, found: I18nKeyItem[], opaque: OffsetRange[]): void {
  // t/$t/tc/$tc/i18n.t/i18n.tc(...) — function calls, incl. Vue I18n plural tc
  const re = /(?:\x24tc?|\btc?|\bi18n\.tc?)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const parenOffset = re.lastIndex - 1;
    if (/[\w$]/.test(text[match.index - 1] || '')) continue;
    if (isOpaque(opaque, match.index)) continue;
    const callText = readParens(text, parenOffset);
    if (!callText) continue;
    // First arg must be exactly one string literal — dynamic keys like
    // `t('prefix.' + name)` are skipped, never half-matched.
    const keyMatch = callText.match(/^\(\s*(['"])([A-Za-z0-9_.:-]+)\1(?=\s*[,)])/);
    if (!keyMatch) continue;
    const key = keyMatch[2] || '';
    const start = parenOffset + keyMatch[0]!.indexOf(key);
    const end = start + key.length;
    const args = splitArgsWithOffsets(callText.slice(1, -1));
    const paramsEdit = getParamsEdit(args.slice(1), parenOffset + 1, parenOffset + callText.length - 1);
    const paramsObject = extractParamsObject(args.slice(1), parenOffset + 1);
    found.push({ key, range: makeRange(text, start, end), startOffset: start, endOffset: end, providedParams: collectParamNames(args.slice(1)), paramsEdit, paramsObject });
  }
}

function collectFormatMessageKeys(text: string, found: I18nKeyItem[], opaque: OffsetRange[]): void {
  const re = /\bformatMessage\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (/[\w$]/.test(text[match.index - 1] || '')) continue;
    if (isOpaque(opaque, match.index)) continue;
    const parenOffset = re.lastIndex - 1;
    const callText = readParens(text, parenOffset);
    if (!callText) continue;
    const args = splitArgsWithOffsets(callText.slice(1, -1));
    const idArg = args[0]?.text || '';
    const keyMatch = idArg.match(/\bid\s*:\s*(['"])([A-Za-z0-9_.:-]+)\1(?=\s*[,}])/);
    if (!keyMatch) continue;
    const key = keyMatch[2] || '';
    const start = parenOffset + 1 + args[0]!.start + keyMatch.index! + keyMatch[0]!.lastIndexOf(key);
    const end = start + key.length;
    const paramsEdit = getParamsEdit(args.slice(1), parenOffset + 1, parenOffset + callText.length - 1);
    const paramsObject = extractParamsObject(args.slice(1), parenOffset + 1);
    found.push({ key, range: makeRange(text, start, end), startOffset: start, endOffset: end, providedParams: collectParamNames(args.slice(1)), paramsEdit, paramsObject });
  }
}

// Read a balanced (...) starting at `start`.
function readParens(text: string, start: number): string | undefined {
  if (text[start] !== '(') return undefined;
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i + 2);
      if (end < 0) return undefined;
      i = end;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) return undefined;
      i = end + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '{' || ch === '[') depth++;
    else if (ch === ')' || ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function splitArgs(text: string): string[] {
  const args: string[] = [];
  let start = 0, depth = 0, quote = '', escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) { args.push(text.slice(start, i).trim()); start = i + 1; }
  }
  const last = text.slice(start).trim();
  if (last) args.push(last);
  return args;
}

function splitArgsWithOffsets(text: string): ArgWithOffset[] {
  const args: ArgWithOffset[] = [];
  let start = 0, depth = 0, quote = '', escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) { args.push(trimArg(text, start, i)); start = i + 1; }
  }
  const last = trimArg(text, start, text.length);
  if (last.text) args.push(last);
  return args;
}

function trimArg(text: string, start: number, end: number): ArgWithOffset {
  while (start < end && /\s/.test(text[start]!)) start++;
  while (end > start && /\s/.test(text[end - 1]!)) end--;
  return { text: text.slice(start, end), start, end };
}

function getParamsEdit(args: ArgWithOffset[], argsStartOffset: number, closingParenOffset: number): ParamsEdit {
  const objectArg = args.find((arg) => arg.text.startsWith('{') && arg.text.lastIndexOf('}') > 0);
  if (objectArg) {
    const closeBrace = objectArg.text.lastIndexOf('}');
    let insertAt = closeBrace;
    while (insertAt > 1 && /\s/.test(objectArg.text[insertAt - 1]!)) insertAt--;
    const body = objectArg.text.slice(1, insertAt);
    return { insertOffset: argsStartOffset + objectArg.start + insertAt, prefix: body.trim() ? ', ' : ' ' };
  }
  return { insertOffset: closingParenOffset, prefix: ', { ', suffix: ' }' };
}

function collectParamNames(args: readonly (ArgWithOffset | string)[]): string[] {
  const params = new Set<string>();
  for (const arg of args) {
    const trimmed = (typeof arg === 'string' ? arg : arg.text).trim();
    if (!trimmed.startsWith('{')) continue;
    const body = trimmed.slice(1, trimmed.lastIndexOf('}'));
    for (const part of splitArgs(body)) {
      const name = paramNameOf(part);
      if (name) params.add(name);
    }
  }
  return [...params].sort();
}

function paramNameOf(part: string): string | undefined {
  const trimmed = String(part).trim();
  if (trimmed.startsWith('...')) return undefined;
  const m = trimmed.match(/^(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$]*))\s*(?::|$)/);
  return (m && (m[1] || m[2])) || undefined;
}

// Absolute span of the params object literal plus each top-level property's raw
// text, so a code action can rebuild the object with unused params removed.
function extractParamsObject(args: ArgWithOffset[], argsStartOffset: number): ParamsObject | undefined {
  const objectArg = args.find((arg) => arg.text.startsWith('{') && arg.text.lastIndexOf('}') > 0);
  if (!objectArg) return undefined;
  const start = argsStartOffset + objectArg.start;
  const body = objectArg.text.slice(1, objectArg.text.lastIndexOf('}'));
  const props = splitArgsWithOffsets(body).map((part) => ({ name: paramNameOf(part.text), text: part.text }));
  return { start, end: start + objectArg.text.length, props };
}

export function keyAtPosition(text: string, position: Position): I18nKeyItem | undefined {
  const offset = positionToOffset(text, position);
  return extractI18nKeys(text).find((item) => item.startOffset <= offset && offset <= item.endOffset);
}

// Reverse of Go to Definition: every range in `text` (source code) that uses `key`.
export function findCodeKeyRanges(text: string, key: string): Range[] {
  return extractI18nKeys(text).filter((item) => item.key === key).map((item) => item.range);
}

export function getCompletionPrefix(text: string, position: Position): string | undefined {
  const before = text.slice(0, positionToOffset(text, position));
  const opaque = computeOpaqueRanges(before);
  const patterns = [
    /(?:\x24tc?|\btc?|\bi18n\.tc?)\s*\(\s*['"]([A-Za-z0-9_.:-]*)$/,
    /\bformatMessage\s*\(\s*\{[^}]*?\bid\s*:\s*['"]([A-Za-z0-9_.:-]*)$/,
    /\b(?:keypath|i18nKey)\s*=\s*['"]([A-Za-z0-9_.:-]*)$/,
    /\bv-t\s*=\s*"'([A-Za-z0-9_.:-]*)$/,
    /\bv-t\s*=\s*'\x22([A-Za-z0-9_.:-]*)$/,
    /\bv-t\s*=\s*"\s*\{\s*path\s*:\s*['"]([A-Za-z0-9_.:-]*)$/,
  ];
  for (const re of patterns) {
    const match = before.match(re);
    if (!match) continue;
    if (isOpaque(opaque, match.index!)) continue;
    if (/[\w$:@#-]/.test(before[match.index! - 1] || '')) continue;
    return match[1];
  }
  return undefined;
}
