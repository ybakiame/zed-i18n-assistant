export interface JsonProperty {
  start: number;
  end: number;
  value: JsonNode;
}

export interface JsonNode {
  start: number;
  end: number;
  properties: Map<string, JsonProperty> | undefined;
}

// JSON.parse validates the grammar; this walk retains property-token and value
// boundaries for edits. Maps avoid prototype keys and duplicate keys are refused.
export function parseJsonStructure(text: string): JsonNode | undefined {
  try { JSON.parse(text); } catch { return undefined; }
  let offset = 0;
  let duplicate = false;
  const whitespace = (): void => { while (/\s/.test(text[offset] || '') && offset < text.length) offset++; };
  function stringEnd(): void {
    offset++;
    while (offset < text.length) {
      if (text[offset] === '\\') offset += 2;
      else if (text[offset++] === '"') break;
    }
  }
  function value(): JsonNode {
    whitespace();
    const start = offset;
    const properties = text[offset] === '{' ? new Map<string, JsonProperty>() : undefined;
    if (properties) {
      offset++;
      whitespace();
      while (text[offset] !== '}') {
        const keyStart = offset;
        stringEnd();
        const keyEnd = offset;
        const key = JSON.parse(text.slice(keyStart, keyEnd)) as string;
        whitespace();
        offset++; // colon
        const child = value();
        if (properties.has(key)) duplicate = true;
        properties.set(key, { start: keyStart, end: keyEnd, value: child });
        whitespace();
        if (text[offset] !== ',') break;
        offset++;
        whitespace();
      }
      offset++;
    } else if (text[offset] === '[') {
      offset++;
      whitespace();
      while (text[offset] !== ']') {
        value();
        whitespace();
        if (text[offset] !== ',') break;
        offset++;
      }
      offset++;
    } else if (text[offset] === '"') {
      stringEnd();
    } else {
      while (offset < text.length && !/[\s,\]}]/.test(text[offset]!)) offset++;
    }
    return { start, end: offset, properties };
  }
  const root = value();
  return duplicate ? undefined : root;
}

export function findJsonProperty(node: JsonNode | undefined, parts: string[]): JsonProperty | undefined {
  if (!node?.properties) return undefined;
  let found: JsonProperty | undefined;
  for (let count = 1; count <= parts.length; count++) {
    const property = node.properties.get(parts.slice(0, count).join('.'));
    if (!property) continue;
    const candidate = count === parts.length ? property : findJsonProperty(property.value, parts.slice(count));
    if (!candidate) continue;
    if (found) return undefined; // dotted and nested representations collide
    found = candidate;
  }
  return found;
}

// Insert only into an unambiguous object path. Existing scalar/array prefixes,
// duplicate properties and existing values are never overwritten.
export function insertNestedJsonKey(jsonText: string, key: string, value = ''): string | undefined {
  const root = parseJsonStructure(jsonText);
  if (!root || !root.properties || key.split('.').some((part) => !part)) return undefined;
  let node: JsonNode = root;
  let properties: Map<string, JsonProperty> = root.properties;
  let parts = key.split('.');
  let depth = 0;
  while (true) {
    const matches: { count: number; property: JsonProperty }[] = [];
    for (let count = 1; count <= parts.length; count++) {
      const property = properties.get(parts.slice(0, count).join('.'));
      if (property) matches.push({ count, property });
    }
    if (!matches.length) break;
    if (matches.length !== 1) return undefined;
    const { count, property } = matches[0]!;
    if (count === parts.length || !property.value.properties) return undefined;
    parts = parts.slice(count);
    node = property.value;
    properties = property.value.properties;
    depth++;
  }
  const eol = jsonText.includes('\r\n') ? '\r\n' : '\n';
  const unit = detectIndentUnit(jsonText);
  const firstProperty = properties.values().next().value;
  const lineStart = firstProperty ? jsonText.lastIndexOf('\n', firstProperty.start) + 1 : -1;
  const existingIndent = firstProperty ? jsonText.slice(lineStart, firstProperty.start) : '';
  const indent = firstProperty && /^[ \t]+$/.test(existingIndent) ? existingIndent : unit.repeat(depth + 1);
  const snippet = buildNestedProperty(parts, value, indent, unit, eol);
  let contentEnd = node.end - 1;
  while (contentEnd > node.start + 1 && /\s/.test(jsonText[contentEnd - 1]!)) contentEnd--;
  if (!properties.size) {
    return jsonText.slice(0, node.start + 1) + eol + snippet + eol + indent.slice(0, -unit.length) + jsonText.slice(node.end - 1);
  }
  return jsonText.slice(0, contentEnd) + ',' + eol + snippet + jsonText.slice(contentEnd);
}

function detectIndentUnit(jsonText: string): string {
  const match = jsonText.match(/\n([ \t]+)\S/);
  return match ? match[1]! : '  ';
}

function buildNestedProperty(parts: string[], value: string, indent: string, unit: string, eol: string): string {
  const keyStr = JSON.stringify(parts[0]);
  if (parts.length === 1) return indent + keyStr + ': ' + JSON.stringify(value);
  return indent + keyStr + ': {' + eol + buildNestedProperty(parts.slice(1), value, indent + unit, unit, eol) + eol + indent + '}';
}
