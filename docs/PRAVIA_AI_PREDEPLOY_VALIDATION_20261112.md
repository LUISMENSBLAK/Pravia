# PRAVIA · Extracción y Proyección antes del release

12-11-2026 · **NO-GO** · candidato de trabajo sobre `c0eeed580a0b48d9213c37df5e667fc50b1636a1`. Las escrituras de QA quedaron en PostgreSQL y Storage locales. No se enviaron expedientes o identificaciones privadas al proveedor externo.

## Lo comprobado con archivos reales de QA

| Superficie | Evidencia | Resultado de este corte |
|---|---|---|
| Comparecientes, ficha existente | Dos recorridos en Chrome: PDF sin capa de texto y archivos JPG/PNG sintéticos con inclinación, luz desigual y compresión JPG. OCR ejecutado sobre píxeles; RFC, CURP, CIC y OCR contrastados con los valores de la fixture. Se conservó el RFC previo ante conflicto; el candidato CURP exigió guardar, se comprobó tras recarga y se cotejaron originales, SHA y trazabilidad en PostgreSQL/Storage. | PASS del alcance descrito. No autentica documentos ni certifica nombres/domicilios INE, reversos ilegibles o fotos de cámara. |
| Facturación, Proveedores | PDF sintético de 100 KiB: extracción RFC/razón social/CP/régimen, confirmación, guardado, recarga y descarga idéntica. Regresión de dos extracciones en paralelo: una respuesta tardía no puede rellenar el archivo que la sustituyó. | PASS local. |
| Facturación, Emisor | Cinco pruebas dirigidas: CSF privada sintética → confirmación → historial y sustitución; OCR de PDF rasterizado y rechazo de no-CSF con original conservado; CSF parcial, concurrencia/permisos/aislamiento y 390/320 px. Prefactura generada, vista y descargada, RFC de ambas partes, CP, clave SAT, importe y SHA cotejados. Integración física adicional 1/1. | PASS local. La copia derivada del machote usa Liberation Sans al faltar Aptos; el original no cambia. Dependencia disponible en [Alpine](https://pkgs.alpinelinux.org/package/v3.23/main/aarch64/font-liberation). |
| Expediente → Proyecto estructurado | Chrome genera un DOCX desde el machote, conserva cláusula fija, tabla, encabezado y pie, y marca fecha y superficie pendientes. Vista previa, descarga, render de ambas versiones, reload y SHA comprobados. Corrección dirigida con texto exacto: 409 si no existe, versión nueva si existe; no altera el original ni elimina los dos pendientes, y registra auditoría. | PASS local. La instrucción acompaña al cambio de texto explícito; no es una prueba de interpretación generativa de una instrucción libre. |

## Qué valida el contrato, no el razonamiento del proveedor

- Cuatro pruebas con Gateway simulado comprueban el envío de bytes JPG con detalle alto, operación y clase de consumo, preservación de las otras fuentes al releer un documento, conflicto en identificadores sin elegir uno y ausencia de propuestas cuando Predios, Finanzas y Cumplimiento no tienen datos suficientes. Se retiró la conversión automática de un rango anual INE en dos fechas exactas.
- No hay catálogo de operaciones, modelos, rutas vigentes ni wallet configurados en la base local de QA. No se ejecutó ninguna inferencia externa. Siguen pendientes el análisis de fotos difíciles por el proveedor, la generación literal y revisión IA de Proyecto y la interpretación autónoma de una instrucción de corrección. No se equiparan OCR, sustitución de texto y razonamiento generativo.
- Aún falta evidencia transversal por campo y en navegador para alta de Comparecientes, receptor CFDI, Predios, comprobantes de Expedientes, Cotizaciones, ISR, Cumplimiento, Chat, Archivo y Bibliotecas/importaciones aplicables. El escenario antiguo de receptor CFDI sobre fallo de extracción y carga de 50 MiB no llega al flujo en esta base: referencia un ingreso que no existe y su prueba positiva usa `.txt`, no un formato CSF admitido.

## Regresión y siguiente gate

Backend 2,376/2,376 y frontend 507/507; nueve escenarios dirigidos aprobados en Chrome real. Builds frontend/backend, Prisma validate/generate y `git diff --check` correctos. Se ejecutaron también las pruebas físicas de conversión Word→PDF con LibreOffice. El inventario transversal sigue en [EXT01–EXT60](PRAVIA_UNIVERSAL_EXTRACTION_CERTIFICATION.md).

Para aprobar el gate, preparar el proveedor en QA mediante el Gateway ya existente, con catálogo, modelo/ruta, política de cobro aprobada y wallet sintético; probar fotos de cámara autorizadas con un conjunto de respuestas comprobables. Medir exactitud por campo y casos donde el resultado correcto es no leer o pedir confirmación; repetir generación literal y revisión de Proyecto, cotejando el Word y la evidencia. Sin push, deploy, migraciones nuevas ni escrituras productivas en este corte.
