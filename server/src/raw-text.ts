import { DomUtils, parseDocument, type Options } from 'htmlparser2';
import type { I18nDiagnostic, OffsetRange } from './types.js';
import { makeRange } from './text/positions.js';

// Minimal structural view over htmlparser2/domhandler nodes. The parser output
// is cast once at the boundary; the pure logic stays decoupled from domhandler.
interface DomNode {
  type: string;
  name?: string;
  attribs?: Record<string, string>;
  children?: DomNode[];
  startIndex: number | null;
  endIndex: number | null;
}

const TRANSLATABLE_ATTRIBUTES = new Set(['title', 'alt', 'placeholder', 'label', 'aria-label']);
const RAW_TEXT_SKIPPED_TAGS = new Set(['script', 'style', 'code', 'pre', 'i18n', 'i18n-t', 'i18nt', 'trans']);

function isExcludedTemplateNode(node: DomNode): boolean {
  const attrs = node.attribs || {};
  return node.type === 'comment' || RAW_TEXT_SKIPPED_TAGS.has(node.name || '')
    || attrs.translate?.toLowerCase() === 'no'
    || Object.keys(attrs).some((name) => /^(?:v-t(?:\.|$)|v-pre$|v-html$|v-text$)/.test(name));
}

function isVueHtmlTemplate(node: DomNode): boolean {
  return node.name === 'template' && !Object.hasOwn(node.attribs || {}, 'src')
    && (!node.attribs?.lang || /^html$/i.test(node.attribs.lang));
}

function templateInterpolations(text: string, excludedRanges: OffsetRange[]): OffsetRange[] {
  const ranges: OffsetRange[] = [];
  let cursor = 0;
  while ((cursor = text.indexOf('{{', cursor)) !== -1) {
    const excluded = excludedRanges.find(({ start, end }) => cursor >= start && cursor < end);
    if (excluded) {
      cursor = excluded.end;
      continue;
    }
    const start = cursor;
    cursor += 2;
    let quote: string | undefined;
    let depth = 0;
    for (; cursor < text.length; cursor++) {
      const char = text[cursor]!;
      if (quote) {
        if (char === '\\') cursor++;
        else if (char === quote) quote = undefined;
      } else if (char === '"' || char === "'" || char === '`') {
        quote = char;
      } else if (text.startsWith('/*', cursor)) {
        const end = text.indexOf('*/', cursor + 2);
        cursor = end === -1 ? text.length : end + 1;
      } else if (text.startsWith('//', cursor)) {
        const end = text.indexOf('\n', cursor + 2);
        cursor = end === -1 ? text.length : end;
      } else if (char === '{') {
        depth++;
      } else if (char === '}' && depth > 0) {
        depth--;
      } else if (text.startsWith('}}', cursor)) {
        cursor += 2;
        break;
      }
    }
    ranges.push({ start, end: Math.min(cursor, text.length) });
  }
  return ranges;
}

// Intentionally conservative: natural-language candidates, not arbitrary strings
// or a dictionary. Single title-cased labels and non-Latin text are useful too.
export function isLikelyUserFacingText(value: string): boolean {
  const text = value.trim();
  if (!/\p{L}/u.test(text)) return false;
  if (/^(?:https?:|mailto:|www\.|[/#])|\S+@\S+\.\S+/i.test(text)) return false;
  if (/^[\w.-]+(?:[/\\][\w.-]+)+$|^[\w-]+(?:\.[\w-]+)+$/.test(text)) return false;
  if (/^[A-Z\d_-]+$|^[a-z\d]+(?:[_-][a-z\d]+)+$|^[a-z]+(?:[A-Z][a-z\d]*)+$/.test(text)) return false;
  if (/[^\p{Script=Latin}\p{N}\p{P}\p{S}\p{Z}\p{M}\s]/u.test(text)) return true;
  return (/\s/.test(text) && (text.match(/\p{L}[\p{L}\p{M}]*/gu) || []).length >= 2)
    || /^\p{Lu}\p{Ll}{2,}[.!?…]?$/u.test(text);
}

/**
 * Detect only template text/attributes. Parser indices and JS string offsets are
 * UTF-16, matching LSP positions. Mask Vue expressions before HTML parsing so
 * comparisons and string literals inside {{ ... }} cannot become markup.
 */
export function getRawTextDiagnostics(text: string, language: string | undefined, enabled = false): I18nDiagnostic[] {
  if (!enabled || !language || !['vue', 'html'].includes(language)) return [];
  const parserOptions: Options = { withStartIndices: true, withEndIndices: true, recognizeSelfClosing: true };
  const parse = (source: string): DomNode => parseDocument(source, parserOptions) as unknown as DomNode;
  // An unmatched "{{" in a comment, script, style or custom SFC block must
  // never mask the template that follows it. Let the HTML parser locate these.
  const excludedRanges: OffsetRange[] = [];
  function excludeNonTemplate(node: DomNode, topLevel = false): void {
    if (isExcludedTemplateNode(node)
      || (language === 'vue' && topLevel && node.name && !isVueHtmlTemplate(node))) {
      excludedRanges.push({ start: node.startIndex!, end: node.endIndex! + 1 });
      return;
    }
    for (const child of node.children || []) excludeNonTemplate(child);
  }
  for (const node of parse(text).children || []) excludeNonTemplate(node, true);
  const interpolations = templateInterpolations(text, excludedRanges);
  let previous = 0;
  const masked = interpolations.map(({ start, end }) => {
    const part = text.slice(previous, start) + text.slice(start, end).replace(/[^\r\n]/g, ' ');
    previous = end;
    return part;
  }).join('') + text.slice(previous);
  const document = parse(masked);
  const diagnostics: I18nDiagnostic[] = [];
  function report(raw: string, start: number, value: string = raw): void {
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.trimEnd().length;
    if (!isLikelyUserFacingText(value)) return;
    diagnostics.push({
      range: makeRange(text, start + leading, start + trailing),
      severity: 2,
      code: 'raw-text',
      source: 'i18n-assistant',
      message: 'Potential untranslated text: ' + JSON.stringify(value.trim()),
    });
  }
  function visit(node: DomNode): void {
    if (node.type === 'text') {
      const raw = text.slice(node.startIndex!, node.endIndex! + 1);
      // Report each literal part separately, never an interpolation expression.
      let cursor = 0;
      for (const { start, end } of interpolations) {
        if (end <= node.startIndex! || start > node.endIndex!) continue;
        const part = raw.slice(cursor, Math.max(0, start - node.startIndex!));
        report(part, node.startIndex! + cursor, DomUtils.textContent(parseDocument(part)));
        cursor = Math.min(raw.length, end - node.startIndex!);
      }
      const part = raw.slice(cursor);
      report(part, node.startIndex! + cursor, DomUtils.textContent(parseDocument(part)));
      return;
    }
    if (!node.name) return;
    const attrs = node.attribs || {};
    if (isExcludedTemplateNode(node)) return;
    // HTML parser determines element boundaries; this small lexer only recovers
    // exact source spans for attributes (including quoted > characters).
    const opening = /^<[^\s/>]+((?:"[^"]*"|'[^']*'|[^'">])*)>/.exec(text.slice(node.startIndex!));
    if (opening) {
      const prefixLength = opening[0]!.length - opening[1]!.length - 1;
      for (const match of opening[1]!.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        const name = match[1]!.toLowerCase();
        const bound = name.startsWith(':') || name.startsWith('v-bind:');
        const target = bound ? name.replace(/^(?::|v-bind:)/, '') : name;
        if (!TRANSLATABLE_ATTRIBUTES.has(target) || !match[0]!.includes('=')) continue;
        let raw = match[2] ?? match[3] ?? match[4] ?? '';
        if (raw.includes('{{')) continue;
        const valuePrefix = /^[^=]+=\s*["']?/.exec(match[0]!)![0]!.length;
        let start = node.startIndex! + prefixLength + match.index! + valuePrefix;
        let value = attrs[name] ?? raw;
        if (bound) {
          // No JS parsing: only a whole, unescaped quoted string is safe.
          const literal = /^\s*(['"])([^\\\r\n]*?)\1\s*$/.exec(raw);
          const decodedLiteral = /^\s*(['"])([^\\\r\n]*?)\1\s*$/.exec(value);
          if (!literal || literal[2]!.includes(literal[1]!) || !decodedLiteral || decodedLiteral[2]!.includes(decodedLiteral[1]!)) continue;
          start += raw.indexOf(literal[1]!) + 1;
          raw = literal[2]!;
          value = decodedLiteral[2]!;
        }
        report(raw, start, value);
      }
    }
    for (const child of node.children || []) visit(child);
  }
  if (language === 'vue') {
    for (const node of document.children || []) {
      if (!isVueHtmlTemplate(node) || isExcludedTemplateNode(node)) continue;
      for (const child of node.children || []) visit(child);
    }
  } else {
    for (const node of document.children || []) visit(node);
  }
  return diagnostics;
}
