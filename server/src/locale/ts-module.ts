export function parseTsLocaleModule(text: string, fileName = 'index.ts'): Record<string, string> {
  const result: Record<string, string> = {};
  const stem = fileName.replace(/\.[cm]?[tj]sx?$/i, '');
  const exportObject = extractObjectAfter(text, /export\s+default\s*/g);
  if (exportObject) {
    Object.assign(result, flattenJsObjectLiteral(exportObject, stem === 'index' ? '' : stem));
  }

  if (stem === 'index') {
    const constRe = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = constRe.exec(text))) {
      const objectStart = text.indexOf('{', match.index);
      const objectText = readBalanced(text, objectStart);
      if (objectText) Object.assign(result, flattenJsObjectLiteral(objectText, match[1]!));
    }
  }
  return result;
}

function extractObjectAfter(text: string, re: RegExp): string | undefined {
  const match = re.exec(text);
  if (!match) return undefined;
  const start = text.indexOf('{', match.index + match[0]!.length);
  if (start === -1) return undefined;
  return readBalanced(text, start);
}

function readBalanced(text: string, start: number): string | undefined {
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
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return undefined;
}

function flattenJsObjectLiteral(objectText: string, prefix = '', out: Record<string, string> = {}): Record<string, string> {
  const body = objectText.replace(/^\s*\{/, '').replace(/\}\s*$/, '');
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /[\s,;]/.test(body[i]!)) i++;
    if (body.startsWith('//', i)) { const end = body.indexOf('\n', i); i = end === -1 ? body.length : end + 1; continue; }
    if (body.startsWith('/*', i)) { const end = body.indexOf('*/', i + 2); i = end === -1 ? body.length : end + 2; continue; }
    const keyMatch = body.slice(i).match(/^(?:['"]([^'"]+)['"]|([A-Za-z_$][\w$-]*))\s*:/);
    if (!keyMatch) { i++; continue; }
    const key = keyMatch[1] || keyMatch[2] || '';
    i += keyMatch[0]!.length;
    while (i < body.length && /\s/.test(body[i]!)) i++;
    const fullKey = prefix ? prefix + '.' + key : key;
    if (body[i] === '{') {
      const nested = readBalanced(body, i);
      if (!nested) break;
      flattenJsObjectLiteral(nested, fullKey, out);
      i += nested.length;
      continue;
    }
    const value = readJsValue(body, i);
    if (value) {
      if (value.kind === 'string') out[fullKey] = value.value;
      i = value.end;
    } else i++;
  }
  return out;
}

function readJsValue(text: string, start: number): { kind: 'string'; value: string; end: number } | undefined {
  const quote = text[start];
  if (quote !== '"' && quote !== "'" && quote !== '`') return undefined;
  let value = '';
  let escaped = false;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i]!;
    if (escaped) { value += ch; escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === quote) return { kind: 'string', value, end: i + 1 };
    value += ch;
  }
  return undefined;
}
