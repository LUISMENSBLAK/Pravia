# Facturación demo-ready — matriz dirigida y gaps

Estado: **NO CERTIFICADO / NO-GO** (27-10-2026). Fuente: `PRAVIA_OS_FACTURACION_DEMO_READY_PROMPT_MAESTRO_CODEX.md` SHA-256 `d8845d7962fe8ef7734e43261c9e2386bff0d5ed4ab706409c0ee2c5548e77ca`; DOCX `PRAVIA_OS_Prompt_Final_Facturacion_Demo_Ready.docx` SHA-256 `ba687b92a34b2335ff9aa97370b24bcf8c7d6a99182587929a48738ecdc59608`. Los archivos fueron leídos íntegramente; esto no implica cumplimiento.

Esta tabla registra el estado observado hasta ahora, no una aceptación final. **15/90** tienen evidencia local para el criterio puntual; **75/90** siguen sin verificación integral. Las pruebas parciales de otros casos se describen sin elevarlos a PASS. Compatibilidad con CSF auténtica SAT: **NOT VERIFIED**; proveedor externo OCR/IA: **NOT VERIFIED**. Las fixtures son sintéticas, sin validez fiscal y sin datos personales. PAC real: **NOT VERIFIED**; no se afirma timbrado. XML preliminar: **no requerido para esta demo** por instrucción posterior; XML fiscal definitivo sólo mediante PAC real verificado.

Última regresión local (27-10-2026): Chrome facturación **6/6**, PostgreSQL/Storage dirigido del borrador/PDF **1/1**, backend **2.292/2.292**, frontend **494/494**, builds backend/frontend, frontend typecheck, Prisma validate/generate y `git diff --check` **PASS**. La primera ejecución simultánea de suites/Chrome produjo timeouts bajo saturación; se descartó y se repitió secuencialmente. Health QA: API, DB y Storage locales `ok`; frontend HTTP 200. No hubo commit, push, deploy ni escrituras productivas. Estos resultados no cambian el **NO-GO** integral ni el conteo FDR.

Actualización privada de extracción (27-10-2026): se procesó localmente el PDF CSF aportado por el cliente, de dos páginas y sin incorporarlo al repositorio. Antes del ajuste tabular se reconocían sólo RFC/CP; ahora el parser reconoce RFC, CURP, nombre/apellidos, CP, domicilio estructurado, fecha de emisión, inicio de operaciones, estatus, actividad económica tabular y un régimen **descriptivo sin clave SAT explícita**. La salida exige revisión y no selecciona una clave por inferencia. Las pruebas sintéticas dirigidas y el parser CURP local pasan; esto **no eleva FDR12–FDR20 a certificación completa**: faltan confirmación/persistencia en UI, compatibilidad con catálogo oficial y recorrido Chrome principal. El PDF CURP privado presenta campos etiquetados por lectura local; el flujo CURP PostgreSQL/Storage/Chrome se probó sólo con fixture sintética. La INE, sin texto digital, sólo dio OCR local de baja confianza y permanece `NOT VERIFIED`. No se enviaron estos documentos a IA externa.

Comprobación adicional de Chrome local: el formulario Proveedores cargó la CSF real del cliente y recibió extracción HTTP 200; mostró `REVIEW_REQUIRED`, un régimen descriptivo y ninguna clave SAT. Se verificó la advertencia al usuario sin guardar el archivo o el perfil, sin screenshots/traces y sin imprimir identificadores. Las cinco pruebas Chrome de Facturación volvieron a pasar (5/5) tras reiniciar el backend QA con el build reciente; frontend completo pasó 493/493. Esto sigue sin ser el recorrido 31/31.

Microfix posterior: el alta de Proveedor ya no acepta un régimen fiscal de texto libre cuando el extractor no detecta clave. Muestra un selector inhabilitado y bloquea Guardar; permite conservar el archivo seleccionado y reintentar una extracción fallida. El backend rechaza también una clave enviada por API que no aparezca entre las claves extraídas de la CSF, antes de crear Proveedor o documento. Prueba UI dirigida: 24/24 de Finanzas; prueba física PostgreSQL/Storage 1/1 con caso adversarial. Chrome real con la CSF privada: extracción HTTP 200, advertencia visible, selector y Guardar inhabilitados, sin intento de escritura. Una petición HTTP directa al backend QA con la misma CSF y clave inventada devolvió 422 `CFDI_CSF_REGIME_UNVERIFIED`; no se publicó el documento ni se imprimieron sus datos. La confirmación con catálogo oficial y el almacenamiento privado previo a extraer siguen pendientes.

Regresión posterior al microfix de extracción y al rechazo explícito de PDF sin texto: backend completo **2.289/2.289** en la última ejecución. Un test prueba que el parser de presupuesto no interpreta bytes crudos ni el marcador de página de `pdf-parse` como texto extraído; informa revisión manual sin exponer la excepción interna. El test PostgreSQL físico se ejecuta por separado y no se infiere de estas suites.

Corte final de este ciclo: backend build, frontend build/typecheck y `git diff --check` PASS; integración física de prefactura/CSF contra PostgreSQL y Storage QA locales 1/1 PASS. Frontend y backend locales responden; backend health informa `database_mode=local` y `storage_mode=local`. Ninguno de estos resultados sustituye los 75 FDR no verificados, las 60 EXT sin certificación integral, los 31 pasos faltantes ni los gates de recuperación y release.

Evidencia local más reciente: backend unitario `npm test` **2,289/2,289**, frontend Vitest **493/493**, builds backend/frontend **PASS**, Prisma validate/generate **PASS**. El dry-run PostgreSQL/Storage aislado de prefactura + CSF de Proveedor y Compareciente pasó tras aplicar sólo allí las cinco migraciones nuevas: conserva PDF original, SHA, extracción, procedencia y dos regímenes; el receptor guarda ambos, selecciona uno para un borrador y rechaza el no confirmado. Deniega tenant ajeno y rol sin lectura documental para la CSF de Proveedor. Cinco pruebas E2E con Google Chrome real y PostgreSQL/Storage locales pasaron en conjunto: borrador manual incompleto persiste y se reabre tras reload; USD incompleto no inventa tasa y bloquea PDF; USD/CAD con tasas **sintéticas de QA** conservan moneda/tasa, generan PDFs visibles y verifican SHA; borrador con concepto genera PDF v1/v2, visor y descarga real; editor sin overflow entre 1440 y 320 px. Una prueba física adicional PostgreSQL/Storage cotejó textos PDF y snapshots USD/CAD, y comprobó que editar receptor antes de v2 no altera v1. El comando indiscriminado `vitest run` del backend **no es el runner canónico**: recoge 12 suites de integración que requieren contenedores locales específicos; una intentó conectar en modo lectura con la URL por defecto, sin éxito y sin escritura. Estas suites no se contabilizan como aprobadas. El control directo del navegador de Codex está deshabilitado en esta sesión; los casos mencionados son del runner Playwright/Chrome, no la certificación completa. No hay evidencia Chrome del recorrido de 31 pasos ni segunda auditoría independiente.

| ID | Criterio | Estado | Evidencia / brecha |
|---|---|---|---|
| FDR01 | Inventario/UX: no módulo paralelo | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR02 | Inventario/UX: botón Nueva factura | PASS (alcance local indicado) | Chrome local abre el editor y crea un borrador real mediante el botón. |
| FDR03 | Inventario/UX: editor amplio origen | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR04 | Inventario/UX: origen EXP | NOT VERIFIED | Chrome/PostgreSQL QA: un ingreso sintético abre el generador contextual y guarda/reabre un borrador de ese origen; falta el recorrido integral. |
| FDR05 | Inventario/UX: origen compareciente | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR06 | Inventario/UX: origen proveedor compatible | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR07 | Inventario/UX: origen manual | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR08 | Inventario/UX: datos precargados | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR09 | Inventario/UX: no capturas innecesarias | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR10 | Inventario/UX: cierre/reapertura | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR11 | CSF/receptor: extractor común | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR12 | CSF/receptor: PDF real | PASS (alcance local indicado) | PDF sintético leído por extracción determinista: `fiscalDocumentExtraction.service.test.ts`. |
| FDR13 | CSF/receptor: imagen real | PASS (alcance local indicado) | PNG y PDF escaneado sintéticos procesados por OCR local: 6/6 tests dirigidos. |
| FDR14 | CSF/receptor: private blob+SHA | NOT VERIFIED | Proveedor sintético: PostgreSQL/Storage local conservan el PDF original, SHA idéntico y tenant scope; falta demostrarlo para receptor/emisor y en Chrome. |
| FDR15 | CSF/receptor: Ver/Descargar/Sustituir | NOT VERIFIED | Endpoint privado firmado y botones Ver/Descargar para Proveedor implementados; faltan Chrome, sustitución/versionado y demás sujetos. |
| FDR16 | CSF/receptor: RFC/nombre/CP | NOT VERIFIED | Extracción sintética dirigida PASS; falta persistencia/reutilización de receptor por UI. |
| FDR17 | CSF/receptor: múltiples regímenes | NOT VERIFIED | PostgreSQL/Storage QA: extracción del archivo sintético, dos regímenes conservados en perfil y elección por borrador; prueba UI dirigida PASS. Falta Chrome real y catálogo SAT compatible. |
| FDR18 | CSF/receptor: único régimen default | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR19 | CSF/receptor: elección snapshot | NOT VERIFIED | Borrador QA conserva selección individual y rechaza código ajeno al perfil; falta snapshot/versión fiscal completa y Chrome. |
| FDR20 | CSF/receptor: parcial/retry sin borrar | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR21 | SAT/comprobante: Uso CFDI selector | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR22 | SAT/comprobante: compatibilidad régimen | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR23 | SAT/comprobante: moneda MXN | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR24 | SAT/comprobante: moneda USD | NOT VERIFIED | Chrome local guarda/reabre USD, muestra FX, bloquea PDF sin tasa y abre PDF con tasa sintética; PostgreSQL/Storage confirma snapshot, texto y SHA. Falta fuente de tasa/compatibilidad SAT para aceptación integral. |
| FDR25 | SAT/comprobante: moneda CAD | NOT VERIFIED | Chrome local guarda/reabre CAD y abre PDF con tasa sintética; PostgreSQL/Storage confirma snapshot, texto y SHA. Falta fuente de tasa/compatibilidad SAT para aceptación integral. |
| FDR26 | SAT/comprobante: FX recalcula | NOT VERIFIED | Chrome local recalcula equivalencia informativa al cambiar moneda/tasa/importe y conserva tasa tras reload; falta cotejo completo de snapshot y PDF histórico. |
| FDR27 | SAT/comprobante: Exportación selector | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR28 | SAT/comprobante: lugar expedición precarga | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR29 | SAT/comprobante: condiciones opcionales | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR30 | SAT/comprobante: PUE/PPD y forma SAT selector/precarga | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR31 | Entidades/emisión: entidad desde CSF | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR32 | Entidades/emisión: corregir guardar | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR33 | Entidades/emisión: guardar+reload+reutilizar | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR34 | Entidades/emisión: separación datos/emisión | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR35 | Entidades/emisión: carga .cer/.key | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR36 | Entidades/emisión: password secreto | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR37 | Entidades/emisión: vigencia/estado CSD | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR38 | Entidades/emisión: PAC config | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR39 | Entidades/emisión: PAC adapter/conexión real | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR40 | Entidades/emisión: sin PAC=no timbrado ni UUID | PASS (alcance local indicado) | Chrome local: borrador completo y PDF real conservan `Timbrar CFDI` deshabilitado con «PAC no configurado». PostgreSQL local: estado `PREFACTURA`, `uuid_fiscal` y XML nulos. No se probó un PAC real. |
| FDR41 | Conceptos/proveedor: concepto real catalog | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR42 | Conceptos/proveedor: emisor+acto/all | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR43 | Conceptos/proveedor: SAT claves/unidad | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR44 | Conceptos/proveedor: objeto/impuestos | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR45 | Conceptos/proveedor: autoload EXP | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR46 | Conceptos/proveedor: multiple matches selector | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR47 | Conceptos/proveedor: ninguno mensaje/enlace | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR48 | Conceptos/proveedor: proveedor alta CSF | NOT VERIFIED | PostgreSQL/Storage QA prueban reextracción backend del PDF y bloqueo por SHA distinto; falta E2E Chrome y catálogo SAT. |
| FDR49 | Conceptos/proveedor: proveedor persist/reload | NOT VERIFIED | Perfil de Proveedor y dos regímenes persisten en PostgreSQL; falta cierre/reapertura y reutilización en factura por Chrome. |
| FDR50 | Conceptos/proveedor: supplier role semantically safe | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR51 | Draft: BORRADOR persistente | PASS (alcance local indicado) | Chrome + PostgreSQL local: borrador creado por UI, folio real y registro tras reload. |
| FDR52 | Draft: guardar incompleto | PASS (alcance local indicado) | Chrome local guardó borrador central y de ingreso de total cero sin inventar RFC/concepto; PostgreSQL confirmó que el del ingreso no reserva saldo, no crea CxC ni PDF. |
| FDR53 | Draft: cerrar/reabrir | PASS (alcance local indicado) | Chrome local cerró editor, recargó y reabrió el mismo borrador. |
| FDR54 | Draft: reload/restart | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR55 | Draft: internal folio | PASS (alcance local indicado) | Folio FAC-BOR persistido y verificado en PostgreSQL QA local. |
| FDR56 | Draft: state guard transitions | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR57 | Draft: edit draft | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR58 | Draft: historical snapshot | NOT VERIFIED | v1 persistido en QA local; falta cambio autorizado de datos del borrador y cotejo completo v1/v2 en UI. |
| FDR59 | Draft: delete/cancel release | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR60 | Draft: no double save | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR61 | PDF: original binary PDF | PASS (alcance local indicado) | Bytes `%PDF-` y parseo de páginas en QA física. |
| FDR62 | PDF: disclaimer no fiscal | PASS (alcance local indicado) | Leyenda visible en render PNG de la página 1. |
| FDR63 | PDF: fields complete | NOT VERIFIED | PDF QA local contiene campos principales; faltan variantes FX/retenciones y cotejo integral. |
| FDR64 | PDF: blue/gold institutional | NOT VERIFIED | Página 1 renderizada/inspeccionada; faltan paginación y visor responsive. |
| FDR65 | PDF: CFG-002 one master template | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR66 | PDF: private Storage document | PASS (alcance local indicado) | Documento privado con SHA/tamaño almacenado en Storage local; DB cotejada. |
| FDR67 | PDF: view actual PDF | PASS (alcance local indicado) | Chrome local cargó el PDF firmado y dibujó al menos una página en canvas `data-preview-loaded=true`. |
| FDR68 | PDF: download identical SHA | PASS (alcance local indicado) | Chrome pulsó Descargar; el archivo recibido empieza `%PDF-` y su SHA coincide con el de la versión persistida en Storage. |
| FDR69 | PDF: v2 regeneration retains v1 | PASS (alcance local indicado) | Chrome local generó v1/v2 visibles tras reload con SHA/bytes distintos. PostgreSQL/Storage: cambió receptor antes de v2, verificó que texto y snapshot de v1 siguieron intactos y v2 contiene el dato corregido. |
| FDR70 | PDF: no fake UUID/XML | PASS (alcance local indicado) | Sin UUID ni XML fiscal en borrador tras generación, verificado en DB QA. |
| FDR71 | Fiscal amounts: base+IVA separate | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR72 | Fiscal amounts: IVA included reverse calc | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR73 | Fiscal amounts: source income reconciliation | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR74 | Fiscal amounts: tax/withholdings correct | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR75 | Fiscal amounts: 20k 8k reserve =12k | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR76 | Fiscal amounts: concurrency overinvoice prevention | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR77 | Fiscal amounts: cancel/adjust reservation | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR78 | Fiscal amounts: idempotent retry | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR79 | Fiscal amounts: no stamped balance until PAC | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR80 | Fiscal amounts: no SaaS billing mixing | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR81 | E2E/security/second pass: 31-step Chrome primary | NOT VERIFIED | Chrome/PostgreSQL verificaron sólo el subflujo de borrador incompleto desde ingreso; faltan CSF, SAT, emisor, concepto, PDF y pasos encadenados. |
| FDR82 | E2E/security/second pass: USD Chrome | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR83 | E2E/security/second pass: CAD Chrome | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR84 | E2E/security/second pass: fiscal entity E2E | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR85 | E2E/security/second pass: concept E2E | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR86 | E2E/security/second pass: supplier E2E | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR87 | E2E/security/second pass: public general test only | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR88 | E2E/security/second pass: PAC absent full demo | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR89 | E2E/security/second pass: tenant/RBAC/CSD/signed security | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |
| FDR90 | E2E/security/second pass: independent second-pass replay | NOT VERIFIED | Pendiente de prueba integral UI/API/DB/Storage/Chrome según el criterio. |

## Hallazgos y gates inmediatos

### Recorrido principal desde Expediente — 31 pasos

**0/31 PASS del recorrido encadenado.** Las pruebas de editor central y PDF descritas arriba son evidencia parcial de componentes, no sustituyen el mismo flujo desde un ingreso de expediente. Para cada paso de la secuencia el estado del recorrido es `NOT VERIFIED` hasta ejecutarlo en un mismo caso de Chrome/DB/Storage.

| Paso | Operación | Estado del recorrido |
|---|---|---|
| 1 | Expediente con ingreso pendiente | NOT VERIFIED |
| 2 | Finanzas → Facturación | NOT VERIFIED |
| 3 | Localizar ingreso | NOT VERIFIED |
| 4 | Abrir Nueva factura | NOT VERIFIED |
| 5 | Seleccionar receptor real | NOT VERIFIED |
| 6 | Usar/cargar CSF | NOT VERIFIED |
| 7 | Almacenamiento privado | NOT VERIFIED |
| 8 | RFC | NOT VERIFIED |
| 9 | Nombre | NOT VERIFIED |
| 10 | CP | NOT VERIFIED |
| 11 | Regímenes | NOT VERIFIED |
| 12 | Elegir régimen | NOT VERIFIED — catálogo SAT no disponible |
| 13 | Uso CFDI compatible | NOT VERIFIED — catálogo SAT no disponible |
| 14 | Entidad emisora | NOT VERIFIED |
| 15 | Lugar de expedición | NOT VERIFIED |
| 16 | MXN | NOT VERIFIED |
| 17 | Tipo de cambio no aplicable | NOT VERIFIED |
| 18 | PUE/PPD | NOT VERIFIED |
| 19 | Forma de pago SAT | NOT VERIFIED — catálogo SAT no disponible |
| 20 | Concepto fiscal precargado | NOT VERIFIED |
| 21 | Impuestos/total | NOT VERIFIED |
| 22 | Guardar borrador | NOT VERIFIED — sólo editor central probado |
| 23 | Cerrar | NOT VERIFIED |
| 24 | Reabrir | NOT VERIFIED |
| 25 | Persistencia DB/UI | NOT VERIFIED — sólo editor central probado |
| 26 | Generar PDF | NOT VERIFIED — PDF central probado |
| 27 | Abrir PDF | NOT VERIFIED — visor central probado |
| 28 | Descargar PDF | NOT VERIFIED — descarga central probada |
| 29 | Regenerar v2 | NOT VERIFIED — versionado central probado |
| 30 | Integridad v1/v2 | NOT VERIFIED — Storage central probado |
| 31 | Timbrado bloqueado sin UUID simulado | NOT VERIFIED — bloqueo central probado |

- PDF: un borrador QA en PostgreSQL y Storage locales generó v1/v2; reintento concurrente idempotente, bytes/SHA y snapshot histórico se cotejaron. Se editó el receptor antes de v2 y se confirmó por extracción de texto que v1 conserva el dato original. PDFs USD/CAD con tasas sintéticas contienen moneda, tasa y equivalente MXN del snapshot. El PDF se renderizó a imagen e inspeccionó. Chrome local abrió PDFs MXN/USD/CAD en el visor de páginas, descargó mediante el botón real y cotejó los bytes/SHA de v1/v2 con Storage. Falta el recorrido de 31 pasos.
- Borrador incremental: backend permite total cero sólo en `LOCAL_DRAFT/DRAFT`, sin crear CxC/CxP ficticia; al completar importe crea la cuenta. Prueba física local pasó. Chrome local guardó, recargó y reabrió el borrador incompleto; el editor central aún carece de catálogos SAT compatibles, CSF inline y múltiples conceptos.
- CSF: parser único local para PDF textual, PNG/JPG y PDF escaneado con OCR offline; 6/6 pruebas con fixtures sintéticas. La confirmación del receptor ahora relee el archivo privado por vínculo/tenant y coteja SHA; conserva todos los regímenes detectados. La ficha y el borrador guardan datos separados. La integración para Entidades fiscales, CSF auténtica y catálogos SAT sigue pendiente; no llamar completa a la función compartida por existir una clase.
- Timbrado: ambas vistas de prefactura muestran un botón deshabilitado y una causa concreta; un estado de «proveedor conectado» no puede habilitar por sí solo un botón sin operación real. En Chrome local, el borrador completo indica «PAC no configurado» y PostgreSQL mantiene `uuid_fiscal`/XML nulos.
- Catálogos SAT: el [XSD oficial de datos CFDI](https://www.sat.gob.mx/sitio_internet/cfd/catalogos/catCFDI.xsd) permite verificar códigos, pero no contiene la matriz completa de descripciones, vigencia y compatibilidad régimen/persona/Uso CFDI exigida por el contrato. La descarga del XLS oficial intentada en este corte agotó el tiempo de conexión. No se ha sembrado una tabla parcial ni se han presentado los campos libres actuales como selectores certificados. La fuente oficial/versionada y la validación backend quedan pendientes.
- Reintento 27-10-2026: la página oficial [«Qué necesito para facturar»](https://www.sat.gob.mx/minisitio/Factura/emite_quenecesitoparafacturar.htm) enlaza `catCFDI_V_4_20261015.xls`, pero la conexión HTTPS directa a `omawww.sat.gob.mx` agotó el tiempo; la ruta equivalente en `www.sat.gob.mx` respondió HTTP 403. El SAT indica allí que el Uso CFDI debe corresponder a las opciones del régimen fiscal del receptor. No se cargó ningún catálogo no verificado ni se asignó una clave SAT a la CSF real por parecido de descripción.
- Flujo principal de ingreso: el generador contextual conserva un ingreso y permite cargar CSF del compareciente. Ahora puede guardar un primer borrador `EXP008_INCOME` de total cero aunque falten perfil fiscal, emisor o conceptos; no reserva saldo ni crea cuenta ni PDF. PostgreSQL/Storage QA comprobó idempotencia, rechazo de PDF, confirmación posterior del receptor, finalización con emisor/concepto, reserva exacta y liberación al eliminar. Chrome local comprobó guardado, reload, reapertura y eliminación del borrador incompleto desde el ingreso sintético; esto es evidencia parcial, no el recorrido encadenado de 31 pasos ni FDR81 PASS.
- Segunda auditoría independiente, 31 pasos Chrome, restauración/backup y gates de producción: **NOT VERIFIED**. Las suites unitarias completas ya pasaron en el estado indicado; eso no sustituye la certificación integral.
- Producción: **sin escritura, migración, commit, push ni deploy** en este corte. Las cinco migraciones nuevas sólo se aplicaron a PostgreSQL QA local aislado.
