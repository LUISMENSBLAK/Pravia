import { describe, expect, it } from 'vitest';
import { mrzCheckDigit, readIneMrz, readInePrintedValidity, readPassportMrz } from './machineReadableIdentity';

const first = 'P<MEXFICTICIA<<PERSONA<<<<<<<<<<<<<<<<<<<<<<'.padEnd(44,'<');
const folio = 'Z12345678';
const second = `${folio}${mrzCheckDigit(folio)}MEX900101${mrzCheckDigit('900101')}F360101${mrzCheckDigit('360101')}<<<<<<<<<<<<<<<`;
const fullSecond = second + mrzCheckDigit(second.slice(0,10) + second.slice(13,20) + second.slice(21,43));
const cic = '065123456';
const ocr = '0567000012345';
const reverse = `IDMEX${cic}${mrzCheckDigit(cic)}<<${ocr}`;

describe('Lectura mecánica de documentos sin corrección de caracteres', () => {
  it('devuelve los nueve caracteres del folio de pasaporte, nunca el verificador', () => {
    expect(readPassportMrz(`${first}\n${fullSecond}`)?.folio).toBe(folio);
    expect(readPassportMrz(`${first}\n${fullSecond.slice(0,28)}`)?.folio).toBe(folio);
    expect(readPassportMrz(`${first}\n${fullSecond.replace(folio, 'Z12345679')}`)).toBeUndefined();
    expect(readPassportMrz(fullSecond)).toBeUndefined();
  });
  it('separa CIC y OCR aun con espacios y conserva ceros iniciales', () => {
    expect(readIneMrz(reverse.split('').join(' '))).toEqual({ cic:`IDMEX${cic}`,ocr });
    expect(readIneMrz(reverse.replace(cic,'065123457'))).toBeUndefined();
    expect(readIneMrz(reverse.slice(0,-1))).toBeUndefined();
    expect(readIneMrz(`${reverse}\n${reverse.slice(0,-1)}6`)).toBeUndefined();
  });
  it('no convierte un dígito en letra aunque el control coincida, salvo cotejo visual independiente', () => {
    const ambiguous = `5${fullSecond.slice(1)}`;
    expect(readPassportMrz(`${first}\n${ambiguous}`)).toBeUndefined();
    expect(readPassportMrz(`NÚMERO DE PASAPORTE: ${folio}\n${first}\n${ambiguous}`)?.folio).toBe(folio);
  });
  it('recupera vencimiento del intervalo rotulado, no del año de registro o intervalo contradictorio', () => {
    expect(readInePrintedValidity('AÑO DE REGISTRO 1999\nVIGENCIA\n2026 – 2036')).toMatchObject({year:'2036'});
    expect(readInePrintedValidity('AÑO DE REGISTRO 2026 – 2036')).toBeUndefined();
    expect(readInePrintedValidity('VIGENCIA 2026 - 2036\nVIGENCIA 2025 - 2035')).toBeUndefined();
  });
});
