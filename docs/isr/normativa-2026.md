# Cálculo ISR — alcance normativo inicial 2026

Consulta realizada el 17 de agosto de 2026. Este documento registra fuentes oficiales; no sustituye revisión fiscal humana.

## Supuesto soportado

Pago provisional federal por enajenación de un inmueble conforme al artículo 126 de la LISR, realizada en 2026 por una persona física residente fiscal en México, en operación ordinaria consignable en escritura pública, sin exención, copropiedad, pagos parciales ni otro supuesto especial. Los importes de deducciones deben llegar actualizados, documentados y confirmados por una persona usuaria. El resultado no representa la determinación fiscal completa de la operación.

## Fuentes incorporadas

- Ley del Impuesto sobre la Renta, artículos 119, 120, 121 y 126: https://www.diputados.gob.mx/LeyesBiblio/pdf/LISR.pdf
- Reglamento de la Ley del ISR, artículos 200 a 217: https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LISR_060516.pdf
- RMF 2026, regla 3.15.4: https://wwwmat.sat.gob.mx/articulo/35375/regla-3.15.4
- Anexo 8 de la RMF 2026, apartado A.I, publicado en DOF el 28 de diciembre de 2025: https://www.dof.gob.mx/nota_detalle.php?codigo=5777219&fecha=28/12/2025
- RMF 2026, regla 3.15.1, “Opción para la actualización de deducciones”: https://wwwmat.sat.gob.mx/ordenamiento/13472/resolucion-miscelanea-fiscal
- Anexo 9 de la RMF 2026, “Tabla para la opción de actualización de deducciones, artículo 121 de la Ley del ISR”, publicado en el DOF el 17 de julio de 2026: https://www.dof.gob.mx/nota_detalle_popup.php?codigo=5793859

## Límites deliberados

No se implementan por aproximación: exención de casa habitación, copropiedad, herencia/donación, prescripción, adjudicación judicial o fiduciaria, fechas distintas de terreno y construcción, parcialidades, residentes en el extranjero, personas morales, adquisición, pérdida fiscal, pago a la entidad federativa del artículo 127 ni actualización automática por INPC. Esos casos devuelven “Cálculo no disponible para este supuesto” o “Requiere revisión”.

La regla 3.15.1 y el Anexo 9 RMF 2026 quedan documentados como capacidad normativa futura. El motor actual no consulta ni aplica automáticamente esa tabla, y tampoco etiqueta como cálculo de PRAVIA un importe actualizado proporcionado por la persona usuaria. Cada deducción conserva concepto, importe histórico, importe actualizado utilizado, fecha, origen y método de actualización, documento soporte, fundamento, responsable y fecha de confirmación, además de su inclusión o exclusión.

Los tratamientos de las fracciones del artículo 121 y las reglas de actualización del artículo 124 permanecen identificados de forma separada en el snapshot. El modelo no supone que todas las deducciones se actualizan de la misma manera.

## Alcance explícitamente no soportado

- Pago a la entidad federativa del artículo 127 de la LISR.
- Automatización de la opción de actualización de la regla 3.15.1 y el Anexo 9 RMF 2026.
- Cualquier obligación distinta del pago provisional federal del artículo 126 incluida en el supuesto soportado.

## Redondeo

Los importes se procesan con `Decimal`; el resultado final se redondea a centavos con HALF_UP. El snapshot conserva entrada, tarifa completa, desglose y resultado.
