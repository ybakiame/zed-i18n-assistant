import type { Position, Range } from '../types.js';

/** Convert a UTF-16 offset into an LSP position. */
export function offsetToPosition(text: string, offset: number): Position {
  const before = text.slice(0, offset);
  const lines = before.split('\n');
  return { line: lines.length - 1, character: (lines[lines.length - 1] ?? '').length };
}

export function makeRange(text: string, start: number, end: number): Range {
  return { start: offsetToPosition(text, start), end: offsetToPosition(text, end) };
}

/** Convert an LSP position into a UTF-16 offset. */
export function positionToOffset(text: string, position: Position): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < position.line; i++) offset += (lines[i] ?? '').length + 1;
  return offset + position.character;
}

export function comparePosition(a: Position, b: Position): number {
  if (a.line !== b.line) return a.line - b.line;
  return a.character - b.character;
}

export function isPositionInRange(position: Position, range: Range | undefined): boolean {
  if (!range) return true;
  return comparePosition(position, range.start) >= 0 && comparePosition(position, range.end) <= 0;
}
