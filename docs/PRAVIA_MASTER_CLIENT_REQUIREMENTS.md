# PRAVIA OS — registro maestro de requisitos del cliente

## Alta fiscal CSF-first — corrección P0 posterior (29-10-2026)

La orden P0 posterior al corte anterior sustituye el alta manual operativa de Entidad Fiscal por carga privada de CSF → extracción común → revisión/confirmación → persistencia → reutilización como emisor. La [matriz P0 de 45 pasos y 15 casos complementarios](FACTURACION_ENTIDAD_FISCAL_P0_20261029.md) contiene evidencia Chrome/PostgreSQL/Storage **local sintética** y brechas explícitas. No se reprodujo el error exacto de producción. El XLS oficial `catCFDI_V_4_20261029.xls`, adjuntado además por el usuario con SHA idéntico, se importó como snapshot versionado: 19 regímenes, 24 usos CFDI y compatibilidad régimen/persona/Uso en backend y selectores; no certifica una CSF auténtica ni otros catálogos SAT. La matriz global [FDR01–FDR90](FACTURACION_DEMO_READY_GAP_AND_CERTIFICATION.md) y [EXT01–EXT60](PRAVIA_UNIVERSAL_EXTRACTION_CERTIFICATION.md) conservan sus gates independientes. Estado: **NO-GO producción**, sin migración ni deploy productivos por esta corrección.

## Colaboración organizacional — corrección posterior (27-10-2026)

La regla de una notaría como equipo compartido añade lectura por organización y edición controlada por responsable, colaborador o Dirección/Administración. La matriz individual [COL01–COL70](PRAVIA_ORGANIZATION_COLLABORATION_CERTIFICATION.md) conserva por separado cada prueba requerida; su implementación local no equivale a certificación integral. No sustituye FDR01–FDR90, EXT01–EXT60 ni las matrices históricas. Estado: **NO-GO producción** hasta cerrar los casos pendientes y los gates generales.

## Facturación demo-ready — fuente posterior (26-10-2026)

El DOCX `PRAVIA_OS_Prompt_Final_Facturacion_Demo_Ready.docx` (SHA-256 `ba687b92a34b2335ff9aa97370b24bcf8c7d6a99182587929a48738ecdc59608`) y su orden maestra Markdown (SHA-256 `d8845d7962fe8ef7734e43261c9e2386bff0d5ed4ab706409c0ee2c5548e77ca`) se leyeron completos. Su matriz individual [FDR01–FDR90](FACTURACION_DEMO_READY_GAP_AND_CERTIFICATION.md) **no sustituye** CF01–CF39, CX13–CX17/CX20–CX24, SQ01–SQ22, QT09–QT14/QT28 ni los demás casos vigentes. Una implementación focalizada de PDF y OCR sintético no convierte esas matrices en PASS. El XML preliminar deja de ser requisito de la demo por prevalencia posterior; el timbrado/UUID/XML fiscal definitivo continúa condicionado a PAC real. Estado global: **NO CERTIFICADO / NO-GO**.

Continuación 27-10-2026: [EXT01–EXT60](PRAVIA_UNIVERSAL_EXTRACTION_CERTIFICATION.md) sigue **0/60 certificado integralmente**. Se incorporó parser CURP PDF local con procedencia y categoría de carga explícita; Chrome y PostgreSQL/Storage sólo usaron fixture sintética. La CSF real se leyó en memoria y ahora aporta actividad económica tabular sin clave SAT inferida. La INE y el mapeo oficial/compatibilidad SAT siguen no verificados. FDR permanece **15/90** de alcance puntual y el recorrido principal de 31 pasos no está certificado; no se autoriza producción por esta mejora aislada.

Estado: **EN CONSTRUCCIÓN / NO CERTIFICADO** (20-10-2026). Este registro no convierte una implementación, un test unitario o una captura aislada en aceptación del cliente. Los 226 casos mínimos y los 30 casos dirigidos CFG-002 permanecen en [CLIENT_6_CORRECTIONS_CERTIFICATION.md](CLIENT_6_CORRECTIONS_CERTIFICATION.md); este archivo registra las fuentes originales, la trazabilidad adicional y los requisitos que no deben perderse al ampliar aquella matriz.

## Fuentes originales verificadas

Los seis DOCX siguientes se localizaron en `/Users/15indicado/Downloads/`, se abrieron y se leyeron íntegramente el 20-10-2026. Los SHA-256 fijan la edición utilizada; no son evidencia de que cada requisito esté implementado.

| Código | Archivo original | SHA-256 | Secciones funcionales | Casos mínimos relacionados |
|---|---|---|---|---|
| CF | `PRAVIA_OS_Facturacion_CFDI_Prompt_COMPLETO_v2.docx` | `bae94aa1506ce3005f80867ad8d50d9c5031ef81adb2c50cf8b49038c37fca6f` | 0–35; segunda pasada 1–10 | CF01–CF39 |
| BJ | `PRAVIA_OS_Prompt_Biblioteca_Juridica_Motor_Cotizaciones_Valor_Operacion.docx` | `44e3b6e658337c2ec2261d30dadb4e7afebc5bd255e6e2c54c28b897ab64882b` | Biblioteca, jurisdicción, valor, fuentes, aranceles, motor | BJ01–BJ36 |
| TN | `PRAVIA_OS_Prompt_Eliminar_Modulo_Notarias_Una_Notaria_por_Tenant.docx` | `dcd768a1f17dedb0fd759c777e601395496ab19a50482970a6e589eb650a6503` | 0–22 | TN01–TN18 |
| EXD | `PRAVIA_OS_Prompt_Expedientes_Comparecientes_Predios_Explorador_Documental.docx` | `c1c575a8e398bf0edcd90314f8868c6e92684458c10a343049c1a51d6153f6ce` | 0–22 | EXD01–EXD27 |
| UP | `PRAVIA_OS_Prompt_Infraestructura_Global_Carga_Archivos.docx` | `2ee9d995ffb8fc8a9b2c2e85085e5cf18d64dc6d5565d1cdb20f249e7ac0fff4` | 0–26 | UP01–UP31 |
| QT | `PRAVIA_OS_Prompt_Mejoras_Cotizaciones_Resumen_Word_Comparecientes.docx` | `840e32b6b74bb490ccf8ea7ce6fcb194f0c38079bf85c0a7f2fcc97fe8bbcf0b` | 0–25 | QT01–QT29 |

Los casos transversales CX01–CX24 y SQ01–SQ22 también pertenecen a la matriz mínima. Los títulos de sección del DOCX no son por sí mismos requisitos atómicos: cada párrafo, lista y prueba dentro de cada sección debe contrastarse antes de declarar completa esta descomposición. **Total de requisitos adicionales aún no determinado; no se asume que 226 + 30 sea el total final.**

## Deltas atómicos identificados directamente en las fuentes

Cada entrada declara todos los campos exigidos para que un hallazgo no se diluya en una afirmación genérica de cobertura. `NOT VERIFIED` incluye implementaciones parciales que aún carecen de prueba integral.

### QT-D01 — rellenar el presupuesto dentro del machote Word original

- Origen y sección: QT, §8–11 y §20; regla fiel: el Word debe conservar el machote y rellenar sus tablas económicas, sin añadir otro presupuesto al final; el layout es determinístico.
- Módulo/componente: Cotizaciones / documento generado desde CFG-002; servicio: `backend/src/services/quoteDocument.service.ts`; API: generación de documento de Cotización existente; modelo: `Cotizacion`, `CotizacionConcepto`, `CatalogoArtefactoVersion`, `Documento`; permiso: generación de Cotización ya autorizado por backend.
- Aceptación: descargar DOCX desde UI real, cotejar contenido, número de tablas, formato, SHA/versión del machote fuente y vínculo al presupuesto persistido. Probar más de una línea por categoría, ausencia de datos, reload y fallo de machote malformado.
- Prueba/evidencia: el generador actual inserta `OTRO_GASTO` y su tratamiento fiscal en la tabla original; existen pruebas focalizadas y un render local sintético del ADM-001. La categoría ya existe en Prisma y en la migración incremental `20261020230000_quote_budget_tax_correction`. Falta la generación y descarga HTTP/Chrome con la versión activa del machote y cotejo visual completo; el blob referenciado por esa versión no está disponible en el Storage QA aislado.
- Estado: **NOT VERIFIED**. La ausencia de categoría persistible descrita en el corte anterior ya fue corregida; el bloqueo actual es la prueba integral con el machote activo, no un segundo motor ni una segunda tabla.

### QT-D02 — IVA automático sobre honorarios y otros gastos diferenciados

- Origen y sección: QT, §5–7 y §19; regla fiel: IVA presupuestario derivado de honorarios cuando corresponda, y `OTRO GASTO` separado de impuestos/derechos y honorarios.
- Módulo/componente: Cotizaciones / presupuesto; servicios: `expedienteBudget.ts` y servicios de Cotización; API: presupuesto de Cotización; modelo: `PresupuestoConceptoCategoria`; permiso: edición de Cotización.
- Aceptación: cálculo exacto en UI/API/DB/DOCX, sin cobro ficticio ni reclasificación por texto del concepto; prueba de cada subtotal y conversión a Expediente.
- Prueba/evidencia al 22-10-2026: `quoteBudgetCorrection.test.ts` cubre $50,000 + $8,000 de IVA + $20,000 = $78,000 y otro gasto sin IVA de $1,500 = $79,500; cubre además gasto gravado únicamente con tasa, fuente y versión explícitas. `quoteBudgetCorrection.postgresql.integration.test.ts` volvió a pasar 2/2 en `pravia_six_corr_qa`: persistió $79,740 con gasto gravado, IVA derivado, reload y rechazo de acceso cross-tenant, IVA manual y revisión obsoleta. Prisma validate y builds backend/frontend pasaron en este corte. El flujo API/UI/DOCX completo y la conversión a Expediente aún no quedaron certificados de punta a punta.
- Estado: **NOT VERIFIED** para aceptación integral; el defecto de modelo/cálculo de este delta fue corregido y probado focalmente, pero no se eleva a PASS sin la cadena UI → API → DB → Word → Expediente → Finanzas.

Dependencias de la corrección coordinada: `PresupuestoConceptoCategoria` en Prisma y la migración incremental no destructiva `20261020230000_quote_budget_tax_correction`; `expedienteBudget.ts` (validación y totales); `quoteBudget.service.ts` (save/snapshot); generador ADM-001; `QuoteConcepts.tsx` y `quoteFormatters.ts`; tipos de Cotización; consumidores de Expediente, Finanzas e ISR. El DOCX QT §6 **sí aprueba explícitamente el 16 % para honorarios** salvo excepción fiscal futura configurada; esto no autoriza IVA universal sobre `OTRO_GASTO`. Las filas IVA históricas permanecen trazables y sujetas a revisión. La migración se aplicó únicamente en PostgreSQL QA local; no se aplicó en producción.

### CFG2-D01 — separación de plantilla determinística y redacción generativa

- Origen y sección: orden maestra §5, QT §11; regla fiel: rellenar variables existentes de DOCX no requiere proveedor IA; redactar contenido jurídico nuevo sí pasa por AI Gateway, catálogo, pricing y permisos.
- Módulo/componente: CFG-002 / Proyecto y Cotizaciones; servicios: resolución de plantilla y generación; API: resolver/generar; modelos: versión de artefacto y registro de uso IA; permiso: acceso al expediente y operación IA si hay generación.
- Aceptación: DOCX estructurado se rellena sin llamada de proveedor; machote que requiere redacción no evade `AI_OPERATION_DISABLED`; observaciones y procedencia quedan trazables.
- Prueba/evidencia: Cotización ADM-001 se rellena localmente sin proveedor; la generación de Proyecto con `COMPRAVENTA.docx` sin variables estructuradas continúa bloqueada por `AI_OPERATION_DISABLED` en el entorno QA sin catálogo aprobado.
- Estado: **NOT VERIFIED**. Defecto pendiente: ejecutar ambas ramas por API/Chrome y cotejar ledger/ausencia de cargo según corresponda. Relacionado con CFG2-08/09/30.

### CFG2-D02 — datos institucionales del tenant en documentos nuevos

- Origen y sección: TN §3/§5 y orden CFG2-21; regla fiel: el documento nuevo usa la Organización vigente (nombre, número, titular, domicilio, logo y demás datos institucionales), nunca una Notaría operativa legacy.
- Módulo/componente: Organización y CFG-002; servicio: `quoteDocument.service.ts` y renderizadores documentales; API: generación de documento; modelos: `Organization`, `CatalogoArtefactoVersion`, `Documento`; permiso: generación ya autorizado por cada módulo.
- Aceptación: tenants A/B generan documentos diferentes con sus propios datos; cambio institucional afecta sólo documentos nuevos; bytes de los anteriores permanecen; logo y campos configurados aparecen en el formato aprobado.
- Prueba/evidencia: el generador ADM-001 de Cotización consulta ahora `Organization.name` en lugar de `quote.notaria.nombre` legacy; build backend PASS. El resto de campos, logo, snapshots y prueba A/B no están certificados.
- Estado: **NOT VERIFIED**. Defecto pendiente: cobertura institucional completa y prueba HTTP/Chrome e inmutabilidad histórica. Relacionado con CFG2-21/22.

### UP-D01 — upload y procesamiento son estados independientes

- Origen y sección: UP, §7–11, §14–15 y §21; regla fiel: un error de OCR/extracción no debe borrar el archivo recibido ni producir éxito falso de procesamiento.
- Módulo/componente: carga documental compartida; servicio: upload/processing existente; API: endpoints documentales; modelo: `Documento` y Storage; permiso: RBAC/document object access.
- Aceptación: archivo físico, SHA, vínculo y descarga persisten tras error de procesamiento; reintento no resube ni duplica blob.
- Prueba/evidencia: pendiente de prueba transversal; consultar UP22–UP25 en matriz mínima.
- Estado: **NOT VERIFIED**. Defecto pendiente: falta certificación por destino, no sólo por expediente.

### TN-D01 — titularidad institucional activa sin borrar procedencia histórica

- Origen y sección: TN, §2–6, §9–11 y §17; regla fiel: una Organización representa una Notaría operativa; referencias históricas a Notaría se preservan, no se reinterpretan ni se convierten en selector activo.
- Módulo/componente: CFG-001/CFG-002 y organización; servicio: `configurationCatalog.service.ts`; API: excepciones/catálogos; modelos: `Organization`, `Notaria`, artefactos y excepciones; permiso: administración de catálogos.
- Aceptación: nuevas excepciones `NOTARIA` rechazadas; `INSTITUCION`/`JURISDICCION` funcionan; históricas legibles; aislamiento A/B y migración sin pérdida.
- Prueba/evidencia: catálogo focalizado 103/103 y build backend PASS tras eliminar rama de escritura `NOTARIA` inalcanzable; pruebas físicas de organización constan en la matriz mínima. Falta regresión transversal completa.
- Estado: **NOT VERIFIED**. Defecto pendiente: revalidación integral de flujos afectados por la eliminación del selector.

## Disciplina de avance

### EXTRACT-20261027 — certificación universal CSF/CURP/INE y todos los puntos de extracción

- Fuente: orden maestra de certificación de facturación y extracción del 27-10-2026, §§4–48. Los tres PDF privados del cliente se usan sólo en QA local; no se agregan como fixtures ni evidencia pública.
- Alcance: inventario transversal de carga/extracción, CSF fiscal, CURP, INE con OCR visual, propuestas con procedencia, revisión humana, Storage privado, AI Gateway, permisos/tenant, matriz EXT01–EXT60, FDR01–FDR90 y 31 pasos Chrome. Evidencia y brechas: `PRAVIA_UNIVERSAL_DOCUMENT_EXTRACTION_INVENTORY.md`, `PRAVIA_UNIVERSAL_EXTRACTION_CERTIFICATION.md`, `FACTURACION_DEMO_READY_GAP_AND_CERTIFICATION.md`.
- Prueba parcial: parser CSF tabular corregido, siete pruebas sintéticas dirigidas PASS y lectura privada de CSF textual/CURP; INE aún no se extrae con confianza. La CSF real trae un régimen descriptivo sin clave SAT explícita, por lo que el sistema pide revisión sin inferir una clave.
- Estado: **NOT VERIFIED / NO-GO** para aceptación integral. No hay recorrido Chrome 31/31, EXT60/60 ni FDR90/90; no se autoriza elevar la evidencia parcial a release.

La matriz mínima conserva sus `NOT VERIFIED` hasta que el caso exacto se ejecute. Las fuentes restantes, los casos históricos y los deltas que aparezcan durante la inspección deben añadirse aquí con el mismo nivel de trazabilidad antes de declarar cobertura completa. La orden del 22-10-2026 autoriza commit, push y deploy de manera condicional, sólo cuando los gates correspondientes sean PASS; no se hizo ninguna escritura productiva en este corte.
