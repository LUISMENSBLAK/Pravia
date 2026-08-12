export class IdentityValidationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

export const normalizeIdentifier = (value?: string | null) => value?.trim().toUpperCase().replace(/\s+/g, '') || '';

const CURP_PATTERN = /^[A-Z][AEIOUX][A-Z]{2}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[HM](?:AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;
const RFC_FISICA_PATTERN = /^[A-ZÑ&]{4}\d{6}[A-Z\d]{3}$/;
const RFC_MORAL_PATTERN = /^[A-ZÑ&]{3}\d{6}[A-Z\d]{3}$/;

export function validateCurp(value?: string | null) {
  const normalized = normalizeIdentifier(value);
  if (!normalized) return null;
  if (!CURP_PATTERN.test(normalized)) {
    throw new IdentityValidationError('La CURP no tiene una estructura válida de 18 caracteres.', 'CURP_INVALID');
  }
  return normalized;
}

export function validateRfc(value: string | null | undefined, personType: 'FISICA' | 'MORAL') {
  const normalized = normalizeIdentifier(value);
  if (!normalized) return null;
  const pattern = personType === 'FISICA' ? RFC_FISICA_PATTERN : RFC_MORAL_PATTERN;
  if (!pattern.test(normalized)) {
    throw new IdentityValidationError(
      `El RFC de persona ${personType === 'FISICA' ? 'física' : 'moral'} no tiene una estructura válida.`,
      'RFC_INVALID',
    );
  }
  return normalized;
}

export function validateOptionalDate(value: string | null | undefined, label: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new IdentityValidationError(`${label} no contiene una fecha válida.`, 'DATE_INVALID');
  }
  return date;
}
