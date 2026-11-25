# PRAVIA — cierre documental del chat y Agenda, 25-11-2026

Complementa la matriz CLIENT_UPDATES_20261121.md y prevalece para el lote recibido durante el rollout. No significa que todos los requisitos jurídicos pendientes estén certificados.

## Correcciones y evidencia

| Requisito | Implementación / verificación |
| --- | --- |
| Cumplimiento desalineado | Se corrigió el label que aparecía dentro del buscador y se añadió la utilidad accesible sr-only que faltaba globalmente. Icono de empty state centrado. Chrome sin overflow a 1440/1366/1024/768/390/320; captura móvil revisada. |
| Arrastrar archivos | Drop zone accesible en el chat, misma carga privada canónica que el selector, hasta seis archivos por mensaje y 50 MiB por archivo. El lote se detiene al cambiar de conversación; no envía los archivos restantes al chat nuevo. |
| Adjuntos se quedan en el cuadro | Se mueven al mensaje al enviar; retries conservan IDs e idempotencia sin duplicar el mensaje. Reabrir nunca vuelve a poner adjuntos vinculados en el composer. |
| Extracción natural rechazada | El planificador recibe la presencia, no el contenido de adjuntos. «Extrae la información importante» se reconoce como trabajo documental. El contenido sigue siendo dato no confiable y no autoriza acciones. |
| Formatos comunes | PDF/PNG/JPG/HEIC sintéticos reales cargados, extraídos con OpenAI y persistidos en Chrome. HEIC conserva el original privado; derivado JPEG en worker con tiempo/dimensiones acotados, sin proveedor adicional. TXT/WEBP/GIF añadidos a validación/análisis; DOC antiguo puede seguir requiriendo exportación DOCX/PDF y no se declara leído falsamente. No se promete lectura perfecta de toda imagen o archivo dañado. |
| Límite económico incompatible | La extracción local solicitaba 16384 tokens frente al catálogo de 8192 y fallaba antes de llamar al proveedor. Opt-in del adaptador ajusta únicamente hacia abajo al límite vigente; no eleva reservas, precios ni máximos. El rechazo estricto sigue por defecto. |
| Usar datos y Ver cambios | Follow-up explícito recupera adjuntos únicamente de la conversación propia. Alta de compareciente con datos de PDF, confirmación y fuentes persistentes al registro real PASS Chrome/PostgreSQL; sin inventar RFC/CURP. Links canónicos de resultados disponibles tras acciones reales. |
| Corregir y deshacer | Edición de ocupación desde la ficha actual, confirmación, persistencia y deshacer confirmado PASS Chrome/AuditLog. Deshacer se limita a la última edición básica de compareciente del chat y rechaza revisiones posteriores. No borra altas, auditoría, pagos ni documentos fiscales ni promete una reversión universal. |
| Indicadores Agenda | Consulta mensual mínima sin el límite de 750 filas del listado, usando la misma visibilidad canónica. Evento compartido visible al lector; privado ajeno y otra Organization no aparecen. Punto desaparece tras terminar sin reload; fallos de consulta se informan. Chrome/API/PostgreSQL PASS con cancelación recuperable de fixtures. |

Pruebas Chrome: chat-documents-local.spec.ts y agenda-markers-compliance-local.spec.ts. Datos inequívocamente sintéticos. La imagen incluye una instrucción maliciosa de crear evento; el conteo real de eventos permanece igual. No se usaron documentos personales de producción.

## Estado de infraestructura al preparar este lote

Regresión local: backend 234 suites / 2727 pruebas PASS (incluye HEIC real y LibreOffice); contrato adicional de formatos 7/7 PASS, tres casos nuevos. Frontend 73 suites / 581 pruebas PASS. Builds backend y frontend PASS; diff --check limpio. Los recorridos críticos se repiten y el CI exacto se ejecutará al consolidar; esos resultados no se presuponen.

Primer candidato fd74d94: CI remoto de los cuatro jobs PASS; backend 2724 PASS y seis omitidas por dependencias físicas (cinco LibreOffice, una HEIC), frontend 581 PASS. La comprobación API/seguridad local posterior pasó 157/157. Una repetición Chrome detectó variación de planificación en la orden directa de cotización: se cambió su ejecución a determinista, conservando el texto literal y sin costo proveedor; 50/50 pruebas dirigidas PASS. El test de zoom ahora espera que termine el render manual antes de registrar su ancho; conserva la aserción original de igualdad al rotar. Estos últimos cambios requieren nuevo CI y repetición Chrome antes de promoción.

- El candidato anterior 06251d0 pasó CI y se promovió a main; no se activó su backend y Netlify quedó bloqueado en la publicación anterior para atender la nueva petición.
- Las cuatro migraciones aditivas sí se aplicaron correctamente a NOTARYPROY. 135 migraciones canónicas presentes; el ledger además conserva baseline/historial. Cero fallidas y conteos conservados: 14 expedientes, 36 cotizaciones, 181 documentos y 6 CFDI.
- Respaldo privado previo de 3651622 bytes restaurado y migrado en PostgreSQL físico. SHA-256: a464c3dbafe0fd6089b622f50630c181549899d2082e8f1739fda3ff3982be97. No acredita recuperar los 26 binarios históricos ausentes, que no se borraron ni reescribieron.
- Bucket privado pravia_documentos: 52428800 bytes. Sólo infraestructura existente. Seis operaciones OpenAI habilitadas con wallet/catálogo; PAC real deshabilitado.
- Publicación de este lote sujeta a CI del commit exacto, builds y smoke productivo. No confundir pruebas locales con despliegue completado. READY FOR REAL CLIENT DATA sigue NO por las dependencias jurídicas/formatos señaladas en la matriz anterior; el release técnico autorizado no las oculta.

Referencia de conversión: API del decoder [heic-decode](https://github.com/catdad-experiments/heic-decode); no se suben originales a un servicio de conversión externo.

## Facturama: repetición externa del 25-11-2026

- La cuenta sandbox autenticada tiene registrado el CSD **público de pruebas** EKU9003173C9: GET Multiemisor 200 y material presente. Los archivos empresariales recibidos el 25-11 corresponden a FIEL; no se leyó la contraseña ni se subieron claves privadas empresariales al sandbox. La configuración del portal y los CSD de API-Lite son independientes.
- Chrome real, PostgreSQL y Storage local: **MXN/USD/CAD PASS**. El botón de PRAVIA obtuvo XML timbrado y PDF del proveedor, comprobó moneda/total/UUID y tipo de cambio en XML; ambos archivos coinciden con SHA-256/tamaño persistidos. Reapertura tras reload y PDF renderizado completo PASS. Repetir cada solicitud devuelve el mismo UUID, con una sola auditoría de solicitud y finalización. Cero movimientos financieros y cero aplicaciones de pago añadidos por timbrar.
- La repetición descubrió un defecto que MXN no exponía: Facturama recibe `CurrencyExchangeRate`, mientras el snapshot interno usa `ExchangeRate`. Se corrigió exclusivamente la serialización de salida, conservando snapshots y folio/fecha. La primera prueba USD rechazada permanece identificada como intento QA fallido; no se borró ni se reescribió. Se comprobó por GET que no había emisión antes del diagnóstico. No se cuentan sus fallos como PASS.
- Prueba ejecutable `frontend/e2e/facturama-sandbox-local.spec.ts`: 1 recorrido externo PASS con tres monedas, usando claves idempotentes estables. Adaptador/mapper: **29/29 pruebas dirigidas PASS**; build backend PASS. Los tipos de cambio 17 y 12.5 son fixtures explícitas de QA, no tasas de mercado ni parámetros fiscales productivos.
- Regresión posterior: prefactura real MXN/USD/CAD con descarga/regeneración sin PAC PASS; chat con lenguaje natural, cambio entre conversaciones y respuesta tardía, renombrado, papelera/restauración, archivo/restauración, recarga, rechazo fuera de dominio y aislamiento entre organizaciones PASS. Una suite antigua se invocó por error sin su credencial específica y no se cuenta como aprobada; el recorrido vigente utiliza el usuario y entorno QA verificados.
- Este resultado acredita **sandbox local**, no timbrado productivo, cancelación, REP, complementos ni habilitación remota. El proveedor productivo continúa deshabilitado. No se necesitan firmas privadas empresariales para repetir estas pruebas. Referencias oficiales: [Multiemisor](https://facturama.mx/docs/es/api-lite/crear-cfdi), [CSD API-Lite](https://facturama.mx/docs/es/api-lite/cargar-csds), [SDK oficial y campo CurrencyExchangeRate](https://github.com/Facturama/facturama-javascript-sdk/blob/master/README.md).
