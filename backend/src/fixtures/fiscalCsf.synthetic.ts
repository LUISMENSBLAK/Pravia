// QA-only text used to generate PDF/image fixtures in memory. These are not SAT
// documents, contain no personal data, and must never be seeded to production.
const mark = 'CONSTANCIA DE SITUACIÓN FISCAL — SINTÉTICA / SIN VALIDEZ FISCAL';

export const fiscalCsfSynthetic = {
  physicalSingle: `${mark}\nRFC: QAFA010101QA1\nNombre completo: PERSONA FISICA SINTETICA\nCódigo Postal: 63735\nDomicilio Fiscal: CALLE DE PRUEBA 10, COLONIA QA\nFecha de emisión: 2026-10-26\nRégimen Fiscal: 901 REGIMEN SINTETICO A`,
  physicalMultiple: `${mark}\nRFC: QAFA010101QA1\nNombre completo: PERSONA FISICA SINTETICA\nCódigo Postal: 63735\nDomicilio Fiscal: CALLE DE PRUEBA 10, COLONIA QA\nFecha de emisión: 2026-10-26\nRégimen Fiscal: 901 REGIMEN SINTETICO A\nRégimen Fiscal: 902 REGIMEN SINTETICO B`,
  company: `${mark}\nRFC: QAQ010101QA1\nDenominación/Razón Social: EMPRESA SINTETICA QA\nCódigo Postal: 63736\nDomicilio Fiscal: AVENIDA DE PRUEBA 20, COLONIA QA\nFecha de emisión: 2026-10-26\nRégimen Fiscal: 903 REGIMEN SINTETICO C`,
  missing: `${mark}\nRFC: QAFA010101QA1\nNombre completo: PERSONA FISICA SINTETICA`,
  contradictory: `${mark}\nRFC: QAFA010101QA1\nRFC: QAQ010101QA1\nNombre completo: IDENTIDAD EN CONFLICTO\nCódigo Postal: 63735\nRégimen Fiscal: 901 REGIMEN SINTETICO A`,
  notCsf: 'DOCUMENTO DE PRUEBA NO CSF\nRFC: QAFA010101QA1\nCódigo Postal: 63735',
} as const;
