import { Prisma } from '@prisma/client';
import { territoryKey, type QuoteTerritory } from './quoteTerritory';

const official = 'https://periodicooficial.nayarit.gob.mx/descargar_pdf.php?archivo=LI+291225+%2804%29+Estado.pdf';
const umaEvidence = 'https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2026/uma/UMA2026.pdf';
const bahiaEvidence = 'https://congresonayarit.gob.mx/wp-content/uploads/QUE_HACEMOS/LEGISLACION_ESTATAL/leyes_ingresos_presupuesto/2026/ley_ingresos_bahia_de_banderas_2026.pdf';
export const isConveyance = (act: string) => !/\b(?:EMBARCACION|VEHICULO|ACCIONES|MUEBLE|MUEBLES|PROMESA|CESION)\b/.test(territoryKey(act)) && /\bCOMPRAVENTA\b/.test(territoryKey(act));

/** Deterministic reference amount, never a proposed budget line. Number of acts,
 * discounts, exemptions, surcharges and date of registration are not established by a quote. */
export function legalReviewForQuote(act: string, territory: QuoteTerritory | null, day: string, confirmedRealEstate: boolean) {
  const items: Array<{ category: string; status: string; message: string; amount?: string; article?: string; official_url?: string; uma_url?: string }> = [];
  if (!isConveyance(act)) return items;
  if (!territory) return [{ category: 'Jurisdicción', status: 'PENDIENTE', message: 'Confirma el estado y municipio del inmueble antes de evaluar impuestos y derechos.' }];
  const nayarit = territoryKey(territory.state) === 'NAYARIT' && territoryKey(territory.jurisdiction) === 'NAYARIT';
  if (nayarit && day >= '2026-02-01' && day <= '2026-12-31' && confirmedRealEstate) {
    items.push({ category: 'Derecho estatal de inscripción', status: 'REFERENCIA NO INCLUIDA EN EL TOTAL', article: 'Art. 18, apartado A, fracción I', official_url: official, uma_url: umaEvidence,
      amount: new Prisma.Decimal('131.8').mul('117.31').toFixed(2),
      message: 'Tarifa base de referencia: 131.8 UMA × $117.31 MXN, para una inscripción ordinaria. Verifica fecha de pago, actos adicionales, exenciones y estímulos. No es una liquidación.' });
  } else items.push({ category: 'Derecho estatal de inscripción', status: 'PENDIENTE', message: 'Confirma que la compraventa es de inmueble y revisa la tarifa oficial aplicable a la inscripción en el estado y fecha correspondientes.' });
  if (confirmedRealEstate && nayarit && territoryKey(territory.municipality || '') === 'BAHIA DE BANDERAS' && day >= '2026-01-01' && day <= '2026-12-31') {
    items.push({ category: 'Impuesto municipal por adquisición de inmueble (ISABI)', status: 'FUNDAMENTO IDENTIFICADO · IMPORTE PENDIENTE', article: 'Ley de Ingresos municipal 2026, art. 21', official_url: bahiaEvidence,
      message: 'Tasa general: 2% sobre el mayor entre precio pactado, avalúo comercial y avalúo de la autoridad catastral. Vivienda de interés social o popular: 0.50%. Mínimo: 7.8674 UMA. Coteja la modalidad, los avalúos y la fecha de presentación a Catastro. El valor fiscal catastral de un recibo no acredita por sí solo el avalúo de la autoridad.' });
  } else {
    items.push({ category: 'Impuesto municipal por adquisición de inmueble (ISABI)', status: 'PENDIENTE', message: territory.municipality
      ? `Requiere verificar para ${territory.municipality} la ley municipal, base gravable, tasa, vigencia y beneficios aplicables. No se obtiene de la tarifa registral estatal.`
      : 'Falta municipio del inmueble. No es posible elegir el régimen municipal ni proponer un importe.' });
  }
  return items;
}
