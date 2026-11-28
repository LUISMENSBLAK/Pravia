/** ICAO Doc 9303 (parts 3 and 4). This checks transcription consistency, not authenticity. */
export function mrzCheckDigit(raw: string): number {
  return [...raw].reduce((sum, char, index) => {
    const code = char === '<' ? 0 : /[0-9]/.test(char) ? Number(char) : char.charCodeAt(0) - 55;
    return sum + code * [7, 3, 1][index % 3];
  }, 0) % 10;
}

const lines = (text: string) => text.toUpperCase().split(/\r?\n/).map(line => line.replace(/[\s\u00ad]/gu, '').replace(/[‹«〈]/gu, char => char === '«' ? '<<' : '<')).filter(Boolean);

/** Use the first nine characters and validate their check digit. The name
 * line and the date checks tie the candidate to a TD3 passport, not a random number. */
export function readPassportMrzCandidate(text: string) {
  const rows = lines(text);
  const result = new Map<string, { folio: string; control: string; uncertainPrefix: boolean; fragmento: string }>();
  for (let index = 1; index < rows.length; index += 1) {
    const first = rows[index - 1], second = rows[index];
    if (!/^P[A-Z<][A-Z<]{3}[A-Z<]{10,39}$/.test(first) || !first.includes('<<')) continue;
    const match = second.match(/^([A-Z0-9]{1,9}<*)(\d)([A-Z<]{3})(\d{6})(\d)([MFX<])(\d{6})(\d)[A-Z0-9<]{0,16}$/);
    if (!match || match[1].length !== 9) continue;
    const [, number, check, , birth, birthCheck, , expiry, expiryCheck] = match;
    const confirmed = mrzCheckDigit(number) === Number(check) && mrzCheckDigit(birth) === Number(birthCheck) && mrzCheckDigit(expiry) === Number(expiryCheck);
    if (!confirmed) continue;
    if (second.length === 44 && mrzCheckDigit(second.slice(0, 10) + second.slice(13, 20) + second.slice(21, 43)) !== Number(second[43])) continue;
    let folio = number.replace(/<+$/, '');
    let opticalProof = false;
    let uncertainPrefix = false;
    if (first.slice(2, 5) === 'MEX' && /^\d{9}$/.test(folio)) {
      // Some characters have the same weight modulo ten. In a Mexican
      // passport, for an all-digit reading, look for a separately printed
      // alphanumeric candidate with an identical tail and matching control.
      // If there is no such evidence, abstain; never infer a leading letter.
      const printed = rows.flatMap((row, i) => i === index || i === index - 1 ? [] : [...row.matchAll(/([A-Z]\d{8})(?!\d)/g)].map(item => item[1]))
        .filter(value => value.slice(1) === folio.slice(1) && mrzCheckDigit(value) === Number(check));
      const uniquePrinted = [...new Set(printed)];
      if (uniquePrinted.length === 1) {
        [folio] = uniquePrinted;
        opticalProof = true;
      } else uncertainPrefix = true;
    }
    result.set(folio, { folio, control: check, uncertainPrefix, fragmento: uncertainPrefix ? 'Primer carácter incierto; se requiere cotejo independiente.'
      : `${folio} · Número cotejado con dígitos de control de la zona de lectura mecánica${opticalProof ? ' y lectura visual independiente' : ''}.` });
  }
  const reconstructed = [...result.values()];
  const proven = reconstructed.filter(item => !item.uncertainPrefix);
  if (proven.length === 1 && reconstructed.every(item => !item.uncertainPrefix || (item.folio.slice(1) === proven[0].folio.slice(1) && item.control === proven[0].control))) return proven[0];
  return reconstructed.length === 1 ? reconstructed[0] : undefined;
}

export function readPassportMrz(text: string) {
  const candidate = readPassportMrzCandidate(text);
  return candidate && !candidate.uncertainPrefix ? candidate : undefined;
}

/** On documented Mexican INE models, CIC consists of nine digits before
 * its verifier. Keep OCR separate and require its full printed block. */
export function readIneMrz(text: string) {
  const unique = new Map<string, { cic: string; ocr: string }>();
  for (const row of lines(text)) {
    const found = row.match(/^IDMEX(\d{9})(\d)<<(\d{13})$/);
    if (!found || mrzCheckDigit(found[1]) !== Number(found[2])) continue;
    const [, cic, , ocr] = found;
    unique.set(`${cic}:${ocr}`, { cic: `IDMEX${cic}`, ocr });
  }
  return unique.size === 1 ? [...unique.values()][0] : undefined;
}

export function readInePrintedValidity(text: string) {
  const plain = text.toUpperCase().normalize('NFD').replace(/\p{M}/gu, '');
  const ranges = [...plain.matchAll(/\bVIGENCIA\s*[:.]?\s*(20\d{2})\s*[-–—]\s*(20\d{2})(?!\d)/g)];
  const valid = ranges.filter(row => Number(row[2]) > Number(row[1]) && Number(row[2]) - Number(row[1]) <= 15);
  const expiry = new Set(valid.map(row => row[2]));
  if (expiry.size !== 1) return undefined;
  return { year: valid[0][2], fragmento: valid[0][0].replace(/\s+/g,' ') };
}
