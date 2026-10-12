import type { OffsetRange } from '../types.js';

type Frame =
  | { type: 'code' }
  | { type: 'lineComment'; start: number }
  | { type: 'blockComment'; start: number }
  | { type: 'htmlComment'; start: number }
  | { type: 'string'; quote: string; start: number }
  | { type: 'template'; start: number }
  | { type: 'templateExpr'; depth: number }
  | { type: 'attrExpr'; quote: string; depth: number };

/**
 * Lexical mask over mixed Vue/TS/JSX text: returns the sorted ranges that are
 * NOT real code — comments, plain strings, template-literal raw text, HTML
 * comments, and ordinary (non-directive) attribute values. Vue directive
 * attribute values (`:x="…"`, `v-x="…"`, `@x="…"`, `#x="…"`) and `${…}`
 * interpolations inside template literals stay transparent so real
 * expressions inside them are still scanned. Best-effort lexing only — no AST.
 */
export function computeOpaqueRanges(text: string): OffsetRange[] {
  const ranges: OffsetRange[] = [];
  const stack: Frame[] = [{ type: 'code' }];
  const top = (): Frame => stack[stack.length - 1]!;
  let i = 0;
  while (i < text.length) {
    const f = top();
    const ch = text[i];
    if (f.type === 'lineComment') {
      if (ch === '\n') { ranges.push({ start: f.start, end: i }); stack.pop(); }
      i++;
      continue;
    }
    if (f.type === 'blockComment') {
      if (ch === '*' && text[i + 1] === '/') { ranges.push({ start: f.start, end: i + 2 }); stack.pop(); i += 2; continue; }
      i++;
      continue;
    }
    if (f.type === 'htmlComment') {
      if (ch === '-' && text[i + 1] === '-' && text[i + 2] === '>') { ranges.push({ start: f.start, end: i + 3 }); stack.pop(); i += 3; continue; }
      i++;
      continue;
    }
    if (f.type === 'string') {
      if (ch === '\\') { i += 2; continue; }
      if (ch === f.quote) { ranges.push({ start: f.start, end: i + 1 }); stack.pop(); }
      i++;
      continue;
    }
    if (f.type === 'template') {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '`') { ranges.push({ start: f.start, end: i + 1 }); stack.pop(); i++; continue; }
      if (ch === '$' && text[i + 1] === '{') {
        ranges.push({ start: f.start, end: i });
        stack.pop();
        stack.push({ type: 'templateExpr', depth: 0 });
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    // code-like frames: code, templateExpr, attrExpr
    if (f.type === 'attrExpr' && f.depth === 0 && ch === f.quote) { stack.pop(); i++; continue; }
    if (ch === '{') {
      if (f.type === 'templateExpr' || f.type === 'attrExpr') f.depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      if (f.type === 'templateExpr') {
        if (f.depth === 0) { stack.pop(); stack.push({ type: 'template', start: i + 1 }); }
        else f.depth--;
      } else if (f.type === 'attrExpr' && f.depth > 0) f.depth--;
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') { stack.push({ type: 'lineComment', start: i }); i += 2; continue; }
    if (ch === '/' && text[i + 1] === '*') { stack.push({ type: 'blockComment', start: i }); i += 2; continue; }
    if (ch === '<' && text[i + 1] === '!' && text[i + 2] === '-' && text[i + 3] === '-') { stack.push({ type: 'htmlComment', start: i }); i += 4; continue; }
    if (ch === '"' || ch === "'") {
      if (f.type === 'code' && isAttrExprQuote(text, i)) stack.push({ type: 'attrExpr', quote: ch, depth: 0 });
      else stack.push({ type: 'string', quote: ch, start: i });
      i++;
      continue;
    }
    if (ch === '`') { stack.push({ type: 'template', start: i }); i++; continue; }
    i++;
  }
  while (stack.length > 1) {
    const f = stack.pop()!;
    if ('start' in f) ranges.push({ start: f.start, end: text.length });
  }
  return ranges;
}

// A quote is a Vue directive attribute opener when preceded by `name=` where
// name is `:foo`, `@foo`, `#foo`, `v-foo`, or `ns:foo` (v-on:, v-bind:, …).
// Plain attributes (`title="…"`, JSX `attr="…"`) keep string semantics.
function isAttrExprQuote(text: string, quoteOffset: number): boolean {
  const before = text.slice(Math.max(0, quoteOffset - 200), quoteOffset);
  return /(?:^|[\s<"'`])(?:[:@#][\w.:[\]-]*|[\w-]+:[\w.:[\]-]*|v-[\w.:[\]-]*)\s*=\s*$/.test(before);
}

export function isOpaque(ranges: OffsetRange[], offset: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = ranges[mid]!;
    if (offset < r.start) hi = mid - 1;
    else if (offset >= r.end) lo = mid + 1;
    else return true;
  }
  return false;
}
