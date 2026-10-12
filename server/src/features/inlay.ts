import type { I18nKeyItem, InlayHintsConfig, InlayHintLike, LocaleMap, Position, Range } from '../types.js';
import { extractI18nKeys } from '../keys/extract.js';
import { isPositionInRange, offsetToPosition } from '../text/positions.js';
import { resolvePreferredLocale } from '../locale/select.js';
import { DEFAULT_CONFIG } from '../config.js';

export function getInlayHints(
  text: string,
  range: Range | undefined,
  locales: LocaleMap,
  defaultLocale: string | undefined,
  options: Partial<InlayHintsConfig> = {},
): InlayHintLike[] {
  if (options.enabled === false) return [];
  const maxLength = options.maxLength ?? DEFAULT_CONFIG.inlayHints.maxLength;
  const preferred = resolvePreferredLocale(locales, defaultLocale);
  if (!preferred) return [];

  return extractI18nKeys(text)
    .filter((item) => isPositionInRange(item.range.start, range))
    .map((item) => {
      const value = preferred.flat[item.key];
      if (value === undefined) return undefined;
      return {
        position: inlayPositionAfterKeyLiteral(text, item),
        label: truncateInlayText(value, maxLength),
        paddingLeft: true,
        tooltip: value,
      };
    })
    .filter((hint): hint is InlayHintLike => hint !== undefined);
}

function inlayPositionAfterKeyLiteral(text: string, item: I18nKeyItem): Position {
  const next = text[item.endOffset];
  const offset = (next === '"' || next === "'") ? item.endOffset + 1 : item.endOffset;
  return offsetToPosition(text, offset);
}

function truncateInlayText(value: string, maxLength: number): string {
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength - 1)) + '…';
}
