/**
 * Canonical normalization for human-authored operational data.
 *
 * This must never be used for e-mail addresses, RFC/CURP, URLs, passwords,
 * tokens, technical identifiers, legal quotations, uploaded document text or
 * template/project transcription. Those values have format or literal-content
 * semantics that take precedence over the operational uppercase convention.
 */
export const normalizeOperationalText = (value: unknown, max = 2_000): string => String(value ?? '')
  .trim()
  .replace(/\s+/gu, ' ')
  .slice(0, max)
  .toLocaleUpperCase('es-MX');

export const optionalOperationalText = (value: unknown, max = 2_000): string | null =>
  normalizeOperationalText(value, max) || null;

export const preserveFormatText = (value: unknown, max = 2_000): string => String(value ?? '')
  .trim()
  .slice(0, max);
