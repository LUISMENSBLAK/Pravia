# PRAVIA OS v0.4 — Auditoría contractual y análisis de brechas

Fecha de auditoría: 24 de agosto de 2026
Fuente contractual: `PRAVIA_OS_Documento_Maestro_Diseno_Funcional_v0.4_EXTENSO_APROBADO.docx`
Fuente de implementación: repositorio local PRAVIA OS, rama actual, sin cambios funcionales durante esta auditoría.

## Criterio y alcance

Se leyó íntegramente el documento maestro (68 páginas) y se revisaron sus 15 referencias visuales. Cuando una referencia visual conserva un folio, navegación o texto anterior, se aplicó la regla contractual de prevalencia del texto. La clasificación no concede cumplimiento por semejanza visual:

- `IMPLEMENTED_EXACTLY`: cumplimiento literal.
- `IMPLEMENTED_COMPATIBLE`: solución arquitectónica equivalente y compatible.
- `PARTIAL`: existe una base útil, pero faltan obligaciones materiales.
- `INCOMPATIBLE`: existe un flujo que contradice v0.4 y debe sustituirse de forma controlada.
- `MISSING`: no existe una implementación sustantiva.

La auditoría fue estática y de solo lectura sobre código, esquema, migraciones y pruebas. No se ejecutaron escrituras ni se inspeccionó o modificó producción.

## Resumen ejecutivo

| ID | Estado | Conclusión |
|---|---|---|
| CFG-001 | PARTIAL | Hay catálogos de actos, etapas y versiones congelables; falta el catálogo operativo completo de actividades, dependencias, tiempos y excepciones. |
| CFG-002 | PARTIAL | Hay una versión documental congelable y Storage privado; faltan la taxonomía Plantilla/Formato, reglas tipadas, explorador y multiplicidad. |
| PRO-001 | INCOMPATIBLE | La ficha y los documentos son aprovechables, pero el pipeline, folio, solicitud a notaría y conversión contradicen v0.4. |
| COT-001 | INCOMPATIBLE | La cadena y conversión tienen controles sólidos, pero el workflow, versionado editable, UI y envío a notaría contradicen v0.4. |
| EXP-001 | INCOMPATIBLE | Existe workspace, pero también creación directa con wizard y recaptura; el origen 1:1 obligatorio no está impuesto. |
| EXP-002 | INCOMPATIBLE | El expediente guarda un solo `tipo_acto_id`; no existe relación multi-acto ni reevaluación con vista previa. |
| EXP-003 | PARTIAL | La identidad maestra y la representación existen, pero la comparecencia no está vinculada por acto ni dispara reevaluación CFG-002. |
| PRD-001 | MISSING | No existe maestro Predio/Inmueble, API, ficha, documentos ni propuesta IA controlada. |
| EXP-004 | PARTIAL | Existe sistema documental privado y herencia sin duplicar blobs; faltan agrupación, sincronización y snapshot de firma. |
| EXP-005 | PARTIAL | Hay etapas, tareas, postfirma y entrega; falta consumir una plantilla CFG-001 de actividades/dependencias completa. |
| EXP-006 | PARTIAL | Se generan requisitos genéricos desde una versión; faltan resolución de reglas, multiplicidad, acciones y contexto IA mínimo por persona. |
| EXP-007 | PARTIAL | El presupuesto vigente se congela en el expediente y alimenta Finanzas; falta la ficha contractual única editable y PDFs históricos. |
| EXP-008 | PARTIAL | El ledger central, validación, reversión, evidencia y RBAC son reutilizables; falta el flujo Solicitud–Comprobante–Fiscal y recibo verificable. |
| ISR-001 | PARTIAL | El motor determinista y auditable es sólido para enajenación federal acotada; falta el alcance fiscal completo y vínculo máximo 1:1. |
| EXP-009 | PARTIAL | Actividad operativa y AuditLog están separados; faltan notas, categorías/filtros, cambios anterior→nuevo y deep links. |
| CMP-001 | PARTIAL | La ficha maestra y revisión IA humana existen; faltan UX vigente/histórico, restauración/sustitución y sincronización/congelamiento. |
| MID-BASE | PARTIAL | Mi Día consume tareas, agenda, expedientes, cotizaciones y finanzas; faltan fuentes canónicas de Prospectos y CFG-001/EXP-008. |

No hay un requisito de los 17 que pueda clasificarse como `IMPLEMENTED_EXACTLY`: todos contienen al menos un delta material. Tampoco se recomienda declarar `IMPLEMENTED_COMPATIBLE` a nivel de requisito completo; sí existen subsistemas compatibles que deben preservarse y extenderse.

---

## CFG-001 — Catálogo de actos y tiempos

**ID:** CFG-001
**REQUISITO:** Catálogo maestro editable de actos con etapas, actividades/hitos, duración, unidad hábil/natural, margen, responsable, aplicabilidad, dependencias múltiples, paralelismo, bloqueos y excepciones por institución, notaría y jurisdicción; separado de la ejecución congelada del expediente.
**STATUS:** `PARTIAL`

**CURRENT IMPLEMENTATION:** Existen `TipoActo`, `FlujoVersion` y `FlujoEtapa`; la apertura del expediente selecciona y congela una versión de flujo y crea etapas operativas. Esto establece una base correcta de catálogo versus ejecución. El catálogo actual representa principalmente etapas lineales: no modela una plantilla de actividades/hitos con grafo de dependencias, unidad de tiempo, margen, asignación por defecto o jerarquía de excepciones. No existe la ruta visual Configuración → Catálogos → Actos y tiempos.
**FILES:** `backend/prisma/schema.prisma`; `backend/src/services/expedienteOpening.service.ts`; `backend/src/domain/expedienteWorkflow.ts`; `backend/src/routes/settings.routes.ts`; `frontend/src/features/settings/SettingsPage.tsx`.
**DB MODELS:** `TipoActo`, `FlujoVersion`, `FlujoEtapa`, `Expediente`, `ExpedienteEtapa`, `Notaria`.
**ROUTES/API:** `/api/settings` no expone administración contractual de CFG-001; `/api/expedientes` opera las etapas ya creadas.
**FRONTEND COMPONENTS:** `SettingsPage.tsx`; `WorkflowTab.tsx`. No hay explorador/editor de actos, tiempos, dependencias o excepciones.
**TESTS:** `backend/src/services/expedienteOpening.service.test.ts`; `backend/src/domain/expedienteWorkflow.test.ts`; `frontend/src/tests/Settings.test.tsx`; `frontend/src/tests/Expedientes.test.tsx`. Cubren apertura/transición y configuración general, no el contrato CFG-001.
**CONFLICT:** La ejecución lineal actual no puede representar dependencias múltiples, paralelismo o excepciones. Convertirla directamente en la plantilla maestra mezclaría catálogo con ejecución.
**EXACT DELTA:** Incorporar modelos tenant-aware y versionados para plantilla de acto, etapa, actividad/hito, dependencia y reglas de excepción; duración, unidad, margen, responsable/aplicabilidad/estado; APIs RBAC y AuditLog; UI de Configuración. Reutilizar `TipoActo`, `Notaria`, institución y jurisdicción. Mantener cálculo de firma fuera de alcance y no rediseñar Mi Día.
**MIGRATION REQUIRED:** Sí: nuevas entidades y relaciones; posible adaptación controlada desde `FlujoVersion`/`FlujoEtapa`, sin modificar migraciones históricas.
**RISK:** Alto. Es raíz de EXP-002, EXP-005, EXP-006 y fuentes de MID-BASE. Una migración incorrecta puede alterar expedientes activos; las ejecuciones existentes deben seguir congeladas.
**IMPLEMENTATION PHASE:** A.

## CFG-002 — Plantillas y formatos

**ID:** CFG-002
**REQUISITO:** Catálogo separado de Plantillas y Formatos con carpetas, subcarpetas, breadcrumbs, versiones, reglas por notaría/banco/acto/compareciente/etapa/hito, obligatoriedad y multiplicidad, sobre Storage privado y controles existentes.
**STATUS:** `PARTIAL`

**CURRENT IMPLEMENTATION:** `PlantillaDocumentalVersion` puede asociarse a tipo de acto y notaría, conserva metadatos de Storage y un `requisitos_json`; `expedienteOpening.service.ts` congela una versión y expande requisitos genéricos. La base de versionado y Storage privado es aprovechable. No diferencia Plantilla de Formato, no representa carpetas, selección múltiple de actos, banco/fiduciaria, reglas tipadas o multiplicidad contractual.
**FILES:** `backend/prisma/schema.prisma`; `backend/src/services/expedienteOpening.service.ts`; `backend/src/seeders/expedientesInitialSeed.ts`; `backend/src/storage/`; `backend/src/routes/settings.routes.ts`; `frontend/src/features/settings/SettingsPage.tsx`.
**DB MODELS:** `PlantillaDocumentalVersion`, `TipoActo`, `Notaria`, `Expediente`, `ExpedienteRequisitoDoc`, `Documento`.
**ROUTES/API:** No hay API administrativa completa para catálogo, carpetas, reglas, versiones o múltiples actos. Las APIs documentales existentes deben reutilizarse.
**FRONTEND COMPONENTS:** No existe Configuración → Catálogos → Plantillas y formatos ni vistas contractuales Notaría/Banco.
**TESTS:** `backend/src/services/expedienteOpening.service.test.ts`; pruebas de Storage/documentos; no hay suite contractual CFG-002.
**CONFLICT:** `requisitos_json` sin esquema no garantiza reglas, multiplicidad o auditabilidad; una sola FK a acto impide selección múltiple.
**EXACT DELTA:** Extender el catálogo actual con tipo `PLANTILLA|FORMATO`, jerarquía de carpetas, relaciones muchos-a-muchos a actos, propietario Notaría/Banco, reglas tipadas de aplicabilidad y multiplicidad, versionado y administración RBAC/auditada. No agregar “permite IA”, no interpretar automáticamente listas bancarias y no ejecutar definitivamente el formato desde CFG.
**MIGRATION REQUIRED:** Sí: taxonomía, carpetas, relaciones, reglas y versiones normalizadas.
**RISK:** Alto. Debe conservar blobs, rutas privadas y versiones ya congeladas; no puede convertir JSON histórico de forma destructiva.
**IMPLEMENTATION PHASE:** A, después de estabilizar el núcleo CFG-001 que reutiliza.

## PRO-001 — Prospectos

**ID:** PRO-001
**REQUISITO:** Prospecto como origen obligatorio con folio `PRO-####-AAAA`, creación mínima, ficha inline, siete etapas exactas, documentos generales, solicitud a notaría con adjuntos explícitos, fuente separada de cotización notarial y conversión única únicamente al recibirla.
**STATUS:** `INCOMPATIBLE`

**CURRENT IMPLEMENTATION:** Existe módulo global con lista/tarjetas, ficha, documentos, seguimiento, responsable y catálogo searchable de 38 actos. El frontend separa un pipeline comercial de cuatro columnas (`Nuevo`, `En proceso`, `Cotización`, `Convertido`) de subestados detallados; el backend conserva `estado` y `etapa_operativa_codigo`. La edición posterior se realiza en `EditProspectDrawer`. Se puede crear una cotización directamente desde la ficha y no existe el flujo contractual completo de solicitud a notaría/fuente recibida. No hay folio PRO.
**FILES:** `backend/prisma/schema.prisma`; `backend/src/controllers/prospectos.controller.ts`; `backend/src/routes/prospectos.routes.ts`; `frontend/src/features/prospects/ProspectsPage.tsx`; `frontend/src/features/prospects/ProspectDetailPage.tsx`; `frontend/src/features/prospects/components/EditProspectDrawer.tsx`; `frontend/src/features/prospects/prospects.types.ts`.
**DB MODELS:** `Prospecto`, `ProspectoEtapaCatalogo`, `ProspectoServicioCatalogo`, `ProspectoSeguimiento`, `ProspectoDocumento`, `Cotizacion`.
**ROUTES/API:** `/api/prospectos`; `/api/documentos` para vínculos; `/api/cotizaciones` permite iniciar la cadena sin la fuente notarial contractual.
**FRONTEND COMPONENTS:** `ProspectsPage`, `ProspectDetailPage`, `ProspectCardsView`, `ProspectListView`, `EditProspectDrawer`, `CatalogCombobox`.
**TESTS:** `frontend/src/tests/Prospects.test.tsx`; pruebas de documentos de prospecto y controladores/rutas. La búsqueda de servicios existente debe preservarse.
**CONFLICT:** El pipeline de cuatro columnas y subestados aprobado en una fase anterior no equivale a las siete etapas contractuales v0.4. El drawer, la conversión directa y la ausencia de fuente notarial contradicen el texto prevalente.
**EXACT DELTA:** Añadir generador tenant-aware de folio PRO; migrar/mapejar estados sin perder historia; ficha inline; solicitud a notaría con notaría, adjuntos seleccionados y salida correo/copiar correo/PDF; fuente documental aislada `COTIZACION_NOTARIA`; bloquear conversión antes de `Cotización recibida` y doble conversión; conservar ficha, catálogo 38 actos, seguimiento, documentos, RBAC y multitenencia.
**MIGRATION REQUIRED:** Sí: folio único por organización/año, estado contractual y entidad/relación de solicitud y fuente recibida; backfill explícito.
**RISK:** Alto. Cambia el estado canónico del embudo y condiciona COT-001/EXP-001; requiere mapa determinista de datos existentes.
**IMPLEMENTATION PHASE:** C, después de CFG y de las bases CMP/PRD.

## COT-001 — Cotizaciones

**ID:** COT-001
**REQUISITO:** Cotización 1:1 desde Prospecto, folio `COT-####-AAAA`, ficha inline sin wizard/estadísticas/envío a notaría, fuente notarial aislada para IA, presupuesto estructurado, distribución interna oculta, una versión editable y PDFs históricos, estados contractuales y conversión 1:1.
**STATUS:** `INCOMPATIBLE`

**CURRENT IMPLEMENTATION:** El backend exige prospecto en creación y bloquea una segunda cotización por el índice único; la conversión exige estado aceptado, versión aprobada y anticipo, es transaccional/idempotente y hereda documentos sin duplicar blobs. Sin embargo, el folio es `COT-AAAA-###`; el workflow incluye solicitud/presupuesto/revisión de notaría y varios estados no contractuales; existen `CotizacionVersion` editables, `NewQuoteFlow` y `EditQuoteVersionDrawer`; la ficha contiene acción “Enviar a notaría” y analítica/indicadores operativos. `prospecto_id` sigue nullable en DB.
**FILES:** `backend/prisma/schema.prisma`; `backend/src/controllers/cotizaciones.controller.ts`; `backend/src/domain/cotizacionWorkflow.ts`; `backend/src/services/cotizacionConversion.service.ts`; `backend/src/routes/cotizaciones.routes.ts`; `frontend/src/features/quotes/QuoteDetailPage.tsx`; `frontend/src/features/quotes/components/NewQuoteFlow.tsx`; `frontend/src/features/quotes/components/EditQuoteVersionDrawer.tsx`; `frontend/src/features/quotes/components/QuoteMetrics.tsx`.
**DB MODELS:** `Cotizacion`, `CotizacionVersion`, `CotizacionSeguimiento`, `CotizacionDocumento`, `Prospecto`, `Expediente`, `Documento`.
**ROUTES/API:** `/api/cotizaciones`; `POST /:id/versiones`; transiciones, aprobación, extracción y conversión actuales.
**FRONTEND COMPONENTS:** `QuotesPage`, `QuoteDetailPage`, `NewQuoteFlow`, `EditQuoteVersionDrawer`, `QuoteMetrics`, `QuoteActivity`.
**TESTS:** `backend/src/domain/cotizacionWorkflow.test.ts`; pruebas de conversión/controlador; `frontend/src/tests/Quotes.test.tsx`. Varias aserciones codifican el workflow anterior y deben actualizarse únicamente al implementar.
**CONFLICT:** La notaría está integrada dentro del ciclo de Cotización, cuando v0.4 la mueve al Prospecto y exige fuente separada. Las versiones editables múltiples y la UI modal contradicen una ficha vigente única.
**EXACT DELTA:** Cambiar folio y estados; hacer origen no-null tras backfill; retirar del flujo operativo el envío a notaría; modelar fuente notarial aislada y limitar IA a ella; consolidar un presupuesto editable con conceptos Honorarios/Impuestos y derechos/IVA; distribución PRAVIA/Notaría oculta del PDF; convertir versiones actuales en historia/PDF inmutable donde sea posible; ficha inline y salida suspendida/cancelada. Preservar conversión idempotente, RBAC, auditoría, documentos y ledger.
**MIGRATION REQUIRED:** Sí: folio, no-null origen, estados, presupuesto vigente, conceptos/distribución e historia de PDF; requiere estrategia de compatibilidad para `CotizacionVersion`.
**RISK:** Muy alto. Es el puente contractual y financiero de la cadena; un cambio incorrecto puede romper expedientes, documentos heredados o saldos.
**IMPLEMENTATION PHASE:** C, después de PRO-001 y antes de EXP-001.

## EXP-001 — Expediente desde cotización

**ID:** EXP-001
**REQUISITO:** Expediente siempre originado 1:1 desde una cotización elegible, sin wizard ni recaptura, herencia completa, folio `EXP-####-AAAA`, cabecera compacta y navegación interna contractual.
**STATUS:** `INCOMPATIBLE`

**CURRENT IMPLEMENTATION:** Existe workspace por expediente y conversión desde cotización. También existe `POST /api/expedientes` con apertura `source: DIRECTO`, y `NewExpedienteFlow` recaptura acto, cliente, notaría y responsable en cinco pasos. `Expediente.cotizacion_id` es nullable. El folio es `EXP-AAAA-####`. Las pestañas actuales son Resumen, Comparecientes, Documentos, Proyecto, Workflow, Finanzas, Cálculo ISR, Cumplimiento y Actividad.
**FILES:** `backend/prisma/schema.prisma`; `backend/src/controllers/expedientes.controller.ts`; `backend/src/routes/expedientes.routes.ts`; `backend/src/services/expedienteOpening.service.ts`; `backend/src/services/cotizacionConversion.service.ts`; `backend/src/services/expedienteFolio.service.ts`; `frontend/src/features/cases/components/NewExpedienteFlow.tsx`; `frontend/src/features/cases/ExpedienteWorkspace.tsx`.
**DB MODELS:** `Expediente`, `Cotizacion`, `ExpedienteEtapa`, `ExpedienteCompareciente`, `Documento` y vínculos.
**ROUTES/API:** `/api/expedientes` permite creación directa; `/api/cotizaciones/:id/...` realiza conversión controlada.
**FRONTEND COMPONENTS:** `ExpedientesPage`, `NewExpedienteFlow`, `ExpedienteWorkspace` y tabs internos.
**TESTS:** `backend/src/services/expedienteOpening.service.test.ts`; pruebas de conversión; `frontend/src/tests/Expedientes.test.tsx`. Fixtures todavía esperan folios antiguos.
**CONFLICT:** El wizard directo y `cotizacion_id` opcional contradicen el origen obligatorio y la prohibición de recaptura. La navegación no contiene Actos, Predios, Plantillas/formatos ni Presupuesto contractuales.
**EXACT DELTA:** Sustituir “Nuevo expediente” por selector de cotizaciones elegibles; retirar/inhabilitar creación directa para usuarios y proteger backend; hacer vínculo no-null después de resolver legacy; nuevo folio; heredar fuente, presupuesto, personas, predios y documentos; ajustar navegación interna sin crear módulos globales indebidos; preservar contexto de ida/vuelta a maestros.
**MIGRATION REQUIRED:** Sí: backfill/decisión humana para expedientes sin cotización, no-null + unique, folio nuevo y relaciones heredadas nuevas.
**RISK:** Muy alto. Los expedientes legacy sin cotización requieren conciliación, no eliminación ni vínculo inventado.
**IMPLEMENTATION PHASE:** C, después de PRO-001/COT-001 y coordinado con EXP-002/003.

## EXP-002 — Actos del expediente

**ID:** EXP-002
**REQUISITO:** Uno o varios actos por expediente, acto principal heredado, actos adicionales, comparecientes/predios por acto y reevaluación CFG-001/CFG-002 con impacto previo antes de retirar trabajo.
**STATUS:** `INCOMPATIBLE`

**CURRENT IMPLEMENTATION:** `Expediente` contiene un solo `tipo_acto_id` rígido. No existe `ExpedienteActo`, API o pestaña Actos. Las etapas y plantilla documental se resuelven una vez durante apertura y no existe reevaluación controlada.
**FILES:** `backend/prisma/schema.prisma`; `backend/src/services/expedienteOpening.service.ts`; `backend/src/controllers/expedientes.controller.ts`; `frontend/src/features/cases/ExpedienteWorkspace.tsx`.
**DB MODELS:** `Expediente.tipo_acto_id`, `TipoActo`, `ExpedienteEtapa`, `ExpedienteRequisitoDoc`. Falta `ExpedienteActo`.
**ROUTES/API:** No hay endpoints multi-acto ni preview/aplicación de impacto.
**FRONTEND COMPONENTS:** No existe `ActosTab`; el tipo se muestra/edita como atributo único de resumen.
**TESTS:** Pruebas de apertura cubren acto único; no hay casos multi-acto, reevaluación o preservación de evidencia.
**CONFLICT:** La FK única impide literalmente la cardinalidad aprobada y asociar personas/predios por acto.
**EXACT DELTA:** Crear relación tenant-aware `ExpedienteActo` con principal/adicional, orden y snapshot de origen; servicio de evaluación de impacto CFG-001/CFG-002; operación en dos pasos preview/confirmación; nunca borrar actividades, pendientes o evidencia silenciosamente, sino conservar/anular con trazabilidad.
**MIGRATION REQUIRED:** Sí: tabla nueva y backfill del acto actual como principal; mantener temporalmente la columna actual durante transición compatible.
**RISK:** Muy alto. Es una migración estructural que afecta documentos, comparecientes, predios, seguimiento, ISR y presupuesto.
**IMPLEMENTATION PHASE:** C, después del modelo CFG-001 y junto a EXP-003.

## EXP-003 — Comparecientes por acto

**ID:** EXP-003
**REQUISITO:** Relación Expediente + Acto + Compareciente + rol/comparecencia + participación/proporción + representación, usando identidad maestra, retorno contextual y reevaluación CFG-002.
**STATUS:** `PARTIAL`

**CURRENT IMPLEMENTATION:** `ExpedienteCompareciente` enlaza identidad maestra, carácter, forma de comparecencia, orden/principal, validación y representación; `ExpedienteRepresentacion` conserva vínculos representado/representante e instrumento. Desvincular puede conservar la persona maestra. Sin `ExpedienteActo`, la relación es expediente-persona y no persona-acto; la restricción única no admite el rol por distintos actos.
**FILES:** `backend/prisma/schema.prisma`; controladores/rutas de expedientes y comparecientes; `frontend/src/features/cases/components/tabs/PartiesTab.tsx`; `frontend/src/features/comparecientes/ComparecienteWorkspace.tsx`.
**DB MODELS:** `Compareciente`, `ExpedienteCompareciente`, `CaracterCompareciente`, `ExpedienteRepresentacion`, `CaracterRepresentacion`, `PersonaMoralInstrumento`.
**ROUTES/API:** `/api/expedientes` para vínculos; `/api/comparecientes` para maestro. No hay contexto de acto ni reevaluación CFG-002.
**FRONTEND COMPONENTS:** `PartiesTab`, `ComparecienteWorkspace`; falta flujo contextual Crear nuevo/Seleccionar existente y retorno garantizado al acto/expediente.
**TESTS:** Pruebas de comparecientes, IDOR y expedientes cubren seguridad y maestro; faltan cardinalidad por acto, proporciones y reevaluación.
**CONFLICT:** La identidad se reutiliza correctamente, pero el vínculo carece de la dimensión Acto exigida.
**EXACT DELTA:** Relacionar el vínculo con `ExpedienteActo`; permitir múltiples caracteres/participaciones por persona según acto; conservar representación y validación; navegación contextual; preview al desvincular/cambiar y reevaluación CFG-002 sin borrar persona ni evidencia.
**MIGRATION REQUIRED:** Sí: FK a `ExpedienteActo`, backfill al acto principal y revisión de restricción única.
**RISK:** Alto. La asignación automática al acto principal es razonable solo como backfill técnico y debe auditarse en expedientes multi-acto.
**IMPLEMENTATION PHASE:** C, después de EXP-002.

## PRD-001 — Predios/Inmuebles

**ID:** PRD-001
**REQUISITO:** Maestro reutilizable de múltiples predios con datos registrales, físicos, fiscales, comerciales, colindancias variables, documentos, vínculo por acto y extracción IA limitada a fuente seleccionada con propuesta humana.
**STATUS:** `MISSING`

**CURRENT IMPLEMENTATION:** Hay campos libres en `datos_operacion`, descripciones en ISR y documentos genéricos, pero no constituyen una identidad maestra reutilizable ni preservan estructura, procedencia o relación multi-acto.
**FILES:** `backend/prisma/schema.prisma`; `backend/src/services/isr.service.ts`; `frontend/src/features/isr/`; `frontend/src/features/cases/`.
**DB MODELS:** No existen `Predio`, `PredioDocumento`, `PredioColindancia` ni `ExpedienteActoPredio`.
**ROUTES/API:** No existe `/api/predios`.
**FRONTEND COMPONENTS:** No hay maestro, ficha ni pestaña Predios/Inmuebles.
**TESTS:** No hay pruebas de maestro, extracción, propuesta, IDOR o copia hacia ISR.
**CONFLICT:** Usar `datos_operacion` o ISR como fuente maestra mezclaría operación/cálculo con identidad del inmueble y contradiría la prohibición de escritura inversa.
**EXACT DELTA:** Crear maestro tenant-aware con campos mínimos, colindancias en colección no limitada, documentos privados y auditados; vínculo a expediente/acto; flujo IA de fuente explícita → propuesta → confirmación por campo, sin invención; copiar snapshot al cálculo ISR sin modificar maestro desde ISR.
**MIGRATION REQUIRED:** Sí: módulo nuevo completo y relaciones; ningún dato JSON existente debe reinterpretarse automáticamente sin evidencia.
**RISK:** Muy alto. Alimenta EXP-002/004/006 e ISR; la deduplicación y el backfill requieren criterio humano.
**IMPLEMENTATION PHASE:** B, después de reutilizar los patrones de maestro/documentos/IA de CMP-001.

## EXP-004 — Consolidación documental del expediente

**ID:** EXP-004
**REQUISITO:** Consolidar documentos de Prospecto/Cotización, Comparecientes, Predios, CFG-002, ISR, Finanzas y carga directa; vigentes por persona, sincronización prefirma y snapshot inmutable al firmar, sin mezclar la fuente notarial.
**STATUS:** `PARTIAL`

**CURRENT IMPLEMENTATION:** `Documento` y sus tablas de vínculo soportan múltiples orígenes, Storage privado, preview/descarga autenticada y procedencia. La conversión vincula documentos de Prospecto/Cotización al expediente sin duplicar el blob. Existen vínculos a Compareciente, Finanzas e ISR. `DocumentsTab` presenta una lista plana y no hay origen Predio. No existe sincronización explícita prefirma ni snapshot/apéndice de firma.
**FILES:** `backend/prisma/schema.prisma`; `backend/src/controllers/documentos.controller.ts`; `backend/src/routes/documentos.routes.ts`; `backend/src/storage/`; `backend/src/services/cotizacionConversion.service.ts`; `frontend/src/components/documents/DocumentViewer.tsx`; `frontend/src/features/cases/components/tabs/DocumentsTab.tsx`.
**DB MODELS:** `Documento`, `ProspectoDocumento`, `CotizacionDocumento`, `ExpedienteDocumento`, `ComparecienteDocumento`, vínculos financieros/ISR y `ExpedienteRequisitoDoc`.
**ROUTES/API:** `/api/documentos`; acciones de upload, acceso y vínculo; faltan sync/preview/snapshot.
**FRONTEND COMPONENTS:** `DocumentsTab`, `DocumentViewer`; faltan carpetas/agrupación por persona/origen y control de snapshot.
**TESTS:** Pruebas de documentos de prospecto, visor, Storage, autorización/IDOR y conversión; faltan exclusión de históricos, prefirma y congelamiento.
**CONFLICT:** El sistema base es compatible, pero una vista plana no implementa el apéndice operacional; no debe crearse un segundo sistema documental.
**EXACT DELTA:** Extender vínculos a Predio y CFG-002; resolver vista por origen/persona usando solo documentos vigentes; servicio idempotente de sincronización antes de firma; snapshot inmutable con procedencia al hito Firma; conservar cambios posteriores del maestro fuera del snapshot; acciones/deep links/auditoría y fuente notarial aislada.
**MIGRATION REQUIRED:** Sí: vínculos faltantes, estado/snapshot y metadatos de procedencia; reutilizar blobs existentes.
**RISK:** Alto. Debe garantizar cero pérdida y cero duplicación física; los históricos nunca deben reaparecer como vigentes.
**IMPLEMENTATION PHASE:** D, después de CMP-001/PRD-001 y EXP-002/003.

## EXP-005 — Seguimiento operativo

**ID:** EXP-005
**REQUISITO:** Copia operativa desde CFG-001, con estados exactos, paralelismo, dependencias/bloqueos, responsable, estimado/real, prefirma/firma/postfirma y entrega final separada.
**STATUS:** `PARTIAL`

**CURRENT IMPLEMENTATION:** `ExpedienteEtapa` congela etapas; existen tareas, tareas externas, transiciones, progreso/readiness, postfirma y entrega. La firma no es necesariamente el cierre final. Sin embargo, la fuente actual no contiene una plantilla de actividades/dependencias completa y la UI `WorkflowTab` es principalmente una línea de etapas.
**FILES:** `backend/prisma/schema.prisma`; `backend/src/domain/expedienteWorkflow.ts`; `backend/src/services/expedienteOpening.service.ts`; `backend/src/services/expedienteProgress.service.ts`; servicios/controladores de postfirma y entrega; `frontend/src/features/cases/components/tabs/WorkflowTab.tsx`.
**DB MODELS:** `ExpedienteEtapa`, `Tarea`, `TareaExterna`, `EntregaFinal`, `ExpedienteEstatus_Log`, `ExpedienteActividad`.
**ROUTES/API:** `/api/expedientes` para transiciones/progreso/postfirma/entrega; no hay motor contractual de dependencia/parallelismo derivado de CFG-001.
**FRONTEND COMPONENTS:** `WorkflowTab`, paneles de postfirma/entrega y agenda/tareas relacionadas.
**TESTS:** `backend/src/domain/expedienteWorkflow.test.ts`; pruebas de apertura/progreso/postfirma; `frontend/src/tests/Expedientes.test.tsx`.
**CONFLICT:** Las etapas actuales son aprovechables como ejecución, pero no deben tratarse como sustituto del grafo de actividades aprobado.
**EXACT DELTA:** Instanciar actividades/hitos desde la versión CFG-001, con snapshot de reglas; estados exactos, dependencias múltiples, desbloqueo, no aplica, tiempos y responsables; conservar prefirma/firma/postfirma/entrega y conectar eventos a Actividad/Mi Día.
**MIGRATION REQUIRED:** Sí: entidad operativa de actividad/dependencia y backfill conservador; mantener etapas actuales para compatibilidad/historia.
**RISK:** Alto. Cambios de catálogo no deben mutar ejecuciones existentes ni recalcular firma automáticamente.
**IMPLEMENTATION PHASE:** D, después de CFG-001 y EXP-002.

## EXP-006 — Ejecución de plantillas y formatos

**ID:** EXP-006
**REQUISITO:** Resolver CFG-002 por acto/notaría/banco/persona/rol/etapa/obligatoriedad/multiplicidad y generar pendientes; cada pendiente permite IA limitada a la persona o carga externa, con faltantes y validación humana.
**STATUS:** `PARTIAL`

**CURRENT IMPLEMENTATION:** La apertura congela una `PlantillaDocumentalVersion` y crea `ExpedienteRequisitoDoc` desde `requisitos_json`. Hay carga documental, procesamiento IA y revisión humana en subsistemas documentales/comparecientes. No hay resolución normalizada de reglas, pendiente por instancia, acción “Generar con IA”, límite de contexto específico o pestaña contractual.
**FILES:** `backend/prisma/schema.prisma`; `backend/src/services/expedienteOpening.service.ts`; servicios IA/documentales y comparecientes; `frontend/src/features/cases/ExpedienteWorkspace.tsx`; `DocumentsTab.tsx`.
**DB MODELS:** `PlantillaDocumentalVersion`, `ExpedienteRequisitoDoc`, `RequisitoDocumentoVinculo`, `Documento`, `ComparecienteDocumento`.
**ROUTES/API:** No existe API de resolución/preview/generación/validación por instancia; se reutilizarían `/api/documentos`, `/api/ia` y `/api/expedientes`.
**FRONTEND COMPONENTS:** No hay tab Plantillas y formatos ni cola de pendientes contractuales.
**TESTS:** Apertura/requisitos y pruebas IA/documentales existentes; faltan matriz de reglas, multiplicidad, aislamiento de contexto y revisión.
**CONFLICT:** Expandir JSON genérico no demuestra la regla aplicada ni soporta múltiples instancias por persona/inmueble/cantidad.
**EXACT DELTA:** Motor determinista de resolución sobre CFG-002 con explicación; generar pendientes, no documentos llenos; UI por pendiente; IA recibe solo estructurados + vigentes de la persona objetivo; registrar faltantes, propuesta, revisión, validación, fuente y auditoría. Banco solo Formatos; Notaría Plantillas + Formatos.
**MIGRATION REQUIRED:** Sí: pendiente tipado, instancia/multiplicidad, regla resuelta, estado, salida y evidencia.
**RISK:** Alto. Riesgo de fuga de contexto si se reutiliza IA sin filtro de fuente y tenant/actor.
**IMPLEMENTATION PHASE:** D, después de CFG-002, EXP-003 y EXP-004.

## EXP-007 — Presupuesto del expediente

**ID:** EXP-007
**REQUISITO:** Presupuesto único vigente heredado de Cotización, rubros Honorarios e Impuestos y derechos, IVA de honorarios, edición inline, distribución interna oculta, PDFs históricos y generación simple.
**STATUS:** `PARTIAL`

**CURRENT IMPLEMENTATION:** La conversión congela el presupuesto aprobado dentro de `Expediente.datos_operacion.presupuesto`; Finanzas y PRAVIA IA lo leen como fuente vigente. El expediente permite actualizar ficha/presupuesto y registra actividad. No existe modelo/pestaña Presupuesto contractual; la historia editable vive en `CotizacionVersion`, y no hay historia específica de PDFs del expediente.
**FILES:** `backend/src/services/cotizacionConversion.service.ts`; `backend/src/controllers/expedientes.controller.ts`; `backend/src/controllers/finanzas.controller.ts`; `backend/src/services/assistantTools.service.ts`; `frontend/src/features/cases/ExpedienteWorkspace.tsx`; componentes actuales de cotización/versiones.
**DB MODELS:** `Expediente.datos_operacion`, `Cotizacion`, `CotizacionVersion`, `HonorarioGenerado`, `ExpedienteActividad`.
**ROUTES/API:** `/api/expedientes` contiene actualización genérica; no hay API de presupuesto vigente/historia PDF con distribución privada.
**FRONTEND COMPONENTS:** No existe `BudgetTab`; edición actual no satisface la ficha inline contractual dedicada.
**TESTS:** `backend/src/services/cotizacionConversion.service`/workflow; `backend/src/services/expedienteProgress.service.test.ts`; `frontend/src/tests/Quotes.test.tsx` y `Expedientes.test.tsx`.
**CONFLICT:** El snapshot JSON es compatible como antecedente, pero no garantiza una única ficha estructurada/auditable; las versiones editables múltiples contradicen el contrato.
**EXACT DELTA:** Modelar presupuesto vigente por expediente y conceptos; Honorarios contiene IVA identificado, más Impuestos y derechos; distribución interna PRAVIA/Notaría por monto/porcentaje, excluida de PDF cliente; edición inline; PDFs históricos inmutables; generación con fecha/datos y nota opcional; actividad/auditoría fuera del documento.
**MIGRATION REQUIRED:** Sí: presupuesto, conceptos, distribución e historia PDF; backfill desde snapshot/versiones con reporte de excepciones.
**RISK:** Alto. Debe conservar exactamente totales y alimentar el ledger sin doble contabilización.
**IMPLEMENTATION PHASE:** E, después de COT-001 y EXP-001.

## EXP-008 — Flujo financiero Abogado–Administración

**ID:** EXP-008
**REQUISITO:** Solicitudes, comprobantes de pago y documentos fiscales diferenciados; abogado solicita/carga sin aplicar, administración revisa/captura/valida/aplica; IA opcional con validación, alertas, recibo PRAVIA verificable y reversibilidad sobre ledger canónico.
**STATUS:** `PARTIAL`

**CURRENT IMPLEMENTATION:** Existe ledger canónico con `MovimientoFinanciero`, distribución, comprobantes/evidencias, categorías/cuentas, aplicación/cancelación/reversión y RBAC separado de validación. La pestaña Finanzas del expediente comparte la misma fuente global. No hay entidad canónica de Solicitud financiera con sus estados/SLA, ni distinción completa entre ficha origen, comprobante de pago y factura, ni recibo QR/código verificable.
**FILES:** `backend/prisma/schema.prisma`; `backend/src/controllers/financeLedger.controller.ts`; `backend/src/controllers/finanzas.controller.ts`; `backend/src/domain/financialLedger.ts`; `backend/src/services/financialMovement.service.ts`; rutas financieras; `frontend/src/features/finance/`; `frontend/src/features/cases/components/tabs/FinanceTab.tsx`.
**DB MODELS:** `MovimientoFinanciero`, `MovimientoDistribucion`, `ComprobanteFinanciero`/vínculos documentales, categorías/cuentas, `HonorarioGenerado`, `AuditLog`, `ExpedienteActividad`.
**ROUTES/API:** `/api/finanzas` y acciones de expediente; falta API de solicitud/estado/revisión/aplicación/recibo.
**FRONTEND COMPONENTS:** Módulo Finanzas central y `FinanceTab`; no existe flujo contractual de bandejas Abogado/Administración.
**TESTS:** Pruebas de ledger, movimientos y `frontend/src/tests/Finance.test.tsx`; faltan permisos extremos, solicitud, SLA, IA controlada y verificación de recibo.
**CONFLICT:** No debe duplicarse el ledger. La infraestructura existente es compatible, pero “cargar comprobante” no debe equivaler automáticamente a “aplicar contablemente”.
**EXACT DELTA:** Extender el ledger con entidad de solicitud y estados, relación a comprobante y documento fiscal; permisos actor/administración; formulario→ficha/PDF o externo→propuesta IA→validación; aplicación general por Honorarios o Impuestos/derechos; alertas con tiempos configurables; recibo PRAVIA verificable; reversión/auditoría. No rediseñar Finanzas central ni agregar conciliación/facturación/reportes globales fuera del alcance.
**MIGRATION REQUIRED:** Sí: solicitudes, estados, relaciones, recibos y SLA/alertas; reutilizar movimientos y documentos.
**RISK:** Muy alto. Afecta dinero y segregación de funciones; exige idempotencia y pruebas de no doble aplicación.
**IMPLEMENTATION PHASE:** E, después de EXP-007.

## ISR-001 — Cálculo ISR

**ID:** ISR-001
**REQUISITO:** Cálculo determinista completo de enajenación/adquisición, IVA aplicable, múltiples contribuyentes, deducciones, exenciones, residencia/extranjeros, distribución informativa, fundamentos y reglas versionadas; máximo un cálculo ligado al expediente y UI contractual.
**STATUS:** `PARTIAL`

**CURRENT IMPLEMENTATION:** Existe motor determinista con `Decimal`, conjuntos/reglas/brackets versionados, snapshot, versiones, auditoría y propuestas IA sujetas a revisión humana. El alcance actual declara y valida principalmente ISR federal por enajenación de inmueble para persona física residente; rechaza casos fuera de alcance. La relación permite varios `CalculoISR` por expediente y la UI crea/lista múltiples. No existe maestro Predio que entregue copia.
**FILES:** `backend/prisma/schema.prisma`; `backend/src/domain/isrTaxEngine.ts`; `backend/src/services/isr.service.ts`; controladores/rutas ISR; `frontend/src/features/isr/`; `frontend/src/features/cases/components/tabs/ISRTab.tsx`.
**DB MODELS:** `CalculoISR`, `CalculoISRVersion`, `CalculoISRDocumento`, `CalculoISRPropuesta`, `FiscalRuleSet` y tablas/brackets/fundamentos relacionados.
**ROUTES/API:** `/api/isr`; operaciones de crear, calcular, versionar, documento y propuesta.
**FRONTEND COMPONENTS:** módulo global ISR y `ISRTab`; flujo actual no impone abrir el único vínculo ni reemplazar/cancelar.
**TESTS:** Suite amplia del motor/servicio/controladores y UI ISR; confiable para el alcance soportado, no prueba los casos contractuales faltantes.
**CONFLICT:** Un cálculo correcto de enajenación federal acotada no satisface el alcance completo. La cardinalidad actual contradice “máximo uno vinculado simultáneamente”.
**EXACT DELTA:** Añadir reglas/versiones/fundamentos y casos confiables para adquisición, IVA, múltiples contribuyentes, deducciones/exenciones, residencia/extranjeros y distribución cuando aplique; jurisdicción/vigencia; snapshot desde Predio/operación/personas sin escritura inversa; vínculo único activo con Reemplazar/Cancelar/Desvincular; UI en cuatro bloques, switch IVA, calcular separado de generar PDF. Mantener IA exclusivamente en extracción/sugerencia.
**MIGRATION REQUIRED:** Sí: vínculo activo único o entidad de enlace, estados de reemplazo, datos/rulesets adicionales y referencias Predio.
**RISK:** Muy alto. Dominio fiscal; cada regla nueva requiere fuente jurídica versionada, vigencia y casos de prueba revisados por especialista.
**IMPLEMENTATION PHASE:** F, después de PRD-001, EXP-002/003 y EXP-007.

### Casos explícitamente no soportados hoy por ISR

- ISR por adquisición.
- IVA integrado cuando aplique.
- Cálculo consolidado y distribución para múltiples contribuyentes.
- Catálogo completo de deducciones y exenciones.
- Tratamiento contractual de extranjeros/no residentes.
- Distribución informativa Estado/Federación cuando corresponda.
- Variantes por jurisdicción fuera del ruleset federal acotado actual.
- Vínculo máximo de un cálculo activo por expediente y reemplazo controlado.
- Entrada estructurada desde maestro Predio y comparecencias por acto.

## EXP-009 — Actividad

**ID:** EXP-009
**REQUISITO:** Actividad operativa separada de AuditLog, relevante, legible, con qué/cuándo/quién, cambios anterior→nuevo, deep links, notas manuales y filtros Todo/Operación/Documentos/Finanzas/Sistema.
**STATUS:** `PARTIAL`

**CURRENT IMPLEMENTATION:** `ExpedienteActividad` es independiente de `AuditLog`; apertura, conversión, transiciones, finanzas y documentos registran eventos. `ActivityTab` muestra un historial legible. No hay modelo/acción explícita de nota manual, taxonomía contractual de filtros, búsqueda por fecha ni deep link uniforme; la cobertura de cambios anterior→nuevo es parcial.
**FILES:** `backend/prisma/schema.prisma`; `backend/src/services/expedienteOpening.service.ts`; `backend/src/services/cotizacionConversion.service.ts`; `backend/src/services/financialMovement.service.ts`; controladores de expedientes/documentos; `frontend/src/features/cases/components/tabs/ActivityTab.tsx`.
**DB MODELS:** `ExpedienteActividad`, `AuditLog`, `User`, `Expediente`.
**ROUTES/API:** Eventos se producen desde varias rutas; falta API dedicada de consulta filtrada/notas/deep link validado.
**FRONTEND COMPONENTS:** `ActivityTab`; faltan controles contractuales y detalle expandible.
**TESTS:** Pruebas de apertura/conversión/finanzas y Expedientes comprueban eventos puntuales; falta suite de relevancia, categorías, notas y navegación.
**CONFLICT:** Ninguno estructural grave; no debe sustituirse `AuditLog` ni fusionarse con Actividad.
**EXACT DELTA:** Normalizar categoría, actor, resumen, antes/después, destino/deep link y metadatos; endpoint filtrado; notas manuales tipadas como actividad, no tarea; política de eventos relevantes, excluyendo clics/ruido.
**MIGRATION REQUIRED:** Probablemente sí: categoría/deep link/antes-después/tipo nota, salvo que se use metadato existente con contrato validado; se prefiere esquema explícito.
**RISK:** Medio. El backfill no debe fabricar actor ni significado; los eventos históricos pueden permanecer como “Sistema” con detalle original.
**IMPLEMENTATION PHASE:** E, después de definir eventos de EXP-007/008.

## CMP-001 — Comparecientes y documentos

**ID:** CMP-001
**REQUISITO:** Mantener ficha real; separar Vigentes/Históricos con mover/restaurar/sustituir; IA reextraíble sobre estructurados + vigentes, comparación por diferencia y decisión humana; residencia/migración; sincronizar hasta firma y congelar después.
**STATUS:** `PARTIAL`

**CURRENT IMPLEMENTATION:** Existe maestro robusto de persona física/moral, representación, documentación privada, procedencia IA, propuestas y confirmación humana. `ComparecienteDocumento.estatus` y `archived_at` soportan vigencia/inactividad; la IA excluye documentos no activos y no sobrescribe silenciosamente. La UI presenta una sola lista; documentos inactivos quedan fuera de la consulta corriente, sin pestaña histórica/restauración/sustitución. No existe sincronización/congelamiento contractual hacia expedientes.
**FILES:** `backend/prisma/schema.prisma`; `backend/src/services/compareciente.service.ts`; controladores/rutas comparecientes y documentos; `frontend/src/features/comparecientes/ComparecienteWorkspace.tsx`; `frontend/src/features/comparecientes/components/ComparecienteDocuments.tsx`.
**DB MODELS:** `Compareciente`, detalles física/moral, `ComparecienteDocumento`, `ComparecienteDatoFuente`, instrumentos/representantes, propuestas/uso IA.
**ROUTES/API:** `/api/comparecientes`; `/api/documentos`; faltan listar históricos, restaurar y decisión sustituir/mantener con semántica explícita.
**FRONTEND COMPONENTS:** `ComparecienteWorkspace`, `ComparecienteDocuments`; conservar la ficha aprobada y no agregar carpetas dentro del maestro.
**TESTS:** Suites backend/frontend de Comparecientes, alta, IA, documentos, RBAC e IDOR; faltan ciclo vigente/histórico y freeze.
**CONFLICT:** La arquitectura de propuesta humana es compatible. La ausencia de UX histórica y el filtrado que vuelve invisibles los inactivos hacen incompleto el ciclo documental.
**EXACT DELTA:** Endpoints/UI Vigentes–Históricos; mover/restaurar; al cargar posible duplicado preguntar sustituir/mantener; reextracción comparada por campo con Actualizar/Conservar; completar residencia/migración donde falte; servicio de sincronización hasta firma y snapshot posterior vía EXP-004.
**MIGRATION REQUIRED:** Posiblemente menor para reemplazo/procedencia/snapshot; el ciclo básico puede reutilizar `estatus`, `archived_at` y vínculos existentes.
**RISK:** Alto. Restaurar o sustituir debe ser tenant-safe, auditable y no eliminar blobs ni cambiar expedientes firmados.
**IMPLEMENTATION PHASE:** B, antes de EXP-003/004/006.

## MID-BASE — Fuentes para Mi Día

**ID:** MID-BASE
**REQUISITO:** Sin rediseñar Mi Día, verificar fuentes canónicas para Prospectos, Cotizaciones, Prefirma derivada de actividades/dependencias/tiempos/margen, Postfirma separada y pendientes administrativos de solicitudes/comprobantes.
**STATUS:** `PARTIAL`

**CURRENT IMPLEMENTATION:** `miDia.controller.ts` agrega tareas, agenda, expedientes, estados de cotización, documentos faltantes, bloqueos, pendientes cliente/notaría y cobros. El frontend de Mi Día ya existe y tiene pruebas. No consulta Prospectos como fuente canónica y no puede derivar Prefirma contractual porque CFG-001/EXP-005 carecen del grafo completo; tampoco existen aún solicitudes EXP-008 diferenciadas. Postfirma/tareas sí tienen base separada.
**FILES:** `backend/src/controllers/miDia.controller.ts`; `backend/src/routes/miDia.routes.ts`; `backend/src/services/expedienteProgress.service.ts`; `frontend/src/features/my-day/`; `frontend/src/tests/MyDay.test.tsx`.
**DB MODELS:** `Tarea`, `EventoAgenda`, `Expediente`, `ExpedienteEtapa`, `Cotizacion`, `Prospecto`, `MovimientoFinanciero`; faltan fuentes CFG-001/EXP-008 contractuales.
**ROUTES/API:** `/api/mi-dia`; consume fuentes actuales, no todas las aprobadas.
**FRONTEND COMPONENTS:** componentes de `frontend/src/features/my-day/`; no se audita ni propone rediseño visual.
**TESTS:** `frontend/src/tests/MyDay.test.tsx` y pruebas del controlador/progreso; no cubren las fuentes aún inexistentes.
**CONFLICT:** No hay que rehacer Mi Día ni inventar reglas de prioridad. Añadir atajos antes de crear fuentes canónicas duplicaría lógica.
**EXACT DELTA:** Después de A–F, exponer/adaptar consultas de lectura para siete etapas de Prospectos, estados de Cotización, actividades prefirma y bloqueos/fechas/márgenes, postfirma y solicitudes/comprobantes administrativos. Mantener presentación y priorización actuales hasta aprobación específica.
**MIGRATION REQUIRED:** No propia en principio; depende de migraciones de PRO-001, CFG-001/EXP-005 y EXP-008.
**RISK:** Medio. Riesgo principal: duplicar reglas o redefinir prioridades fuera del contrato.
**IMPLEMENTATION PHASE:** G, solo data readiness.

---

## Reglas transversales

### Folios

**Resultado:** `INCOMPATIBLE`.

| Entidad | Aprobado | Implementado |
|---|---|---|
| Prospecto | `PRO-####-AAAA` | Sin folio canónico |
| Cotización | `COT-####-AAAA` | `COT-AAAA-###` |
| Expediente | `EXP-####-AAAA` | `EXP-AAAA-####` |

Generadores relevantes: `backend/src/controllers/cotizaciones.controller.ts` y `backend/src/services/expedienteFolio.service.ts`. Hay fixtures y pruebas con el patrón anterior. La migración debe conservar folios antiguos como alias/referencia y aplicar unicidad por organización; no debe renombrar silenciosamente documentos históricos.

### Cadena Prospecto → Cotización → Expediente

**Resultado:** `INCOMPATIBLE`.

- Prospecto→Cotización tiene buena protección de duplicado en el controlador y una restricción única, pero el origen es nullable en DB y no depende de la fuente notarial aprobada.
- Cotización→Expediente tiene conversión transaccional, idempotente y 1:1 útil.
- Existe en paralelo creación directa de expediente con wizard y `cotizacion_id` nullable.
- La herencia documental evita duplicar blobs, pero aún no abarca Predios, relación por acto, snapshot compareciente/prefirma ni presupuesto contractual normalizado.

### Flujos duplicados o paralelos detectados

1. Apertura de expediente desde Cotización y apertura directa `source: DIRECTO` con wizard.
2. Solicitud/presupuesto de Notaría dentro de Cotización, mientras v0.4 la ubica en Prospecto como fuente aislada.
3. Presupuesto en `CotizacionVersion`, snapshot JSON del expediente y edición genérica del expediente, sin una única ficha contractual.
4. Documentos genéricos/requisitos JSON y futura ejecución CFG-002: deben converger sobre el sistema documental existente, no crear otro repositorio.

### Capacidades actuales que deben preservarse

- Autenticación, sesiones y protección de rutas.
- RBAC granular existente y segregación financiera.
- Multitenencia `organization_id`, contexto de actor y defensas IDOR.
- `AuditLog` canónico y `ExpedienteActividad` separado.
- Storage privado, acceso autenticado, preview/descarga y compensación.
- Documento canónico y enlaces por origen sin duplicación física.
- Conversión Cotización→Expediente transaccional/idempotente y bloqueo de doble conversión.
- Ledger financiero canónico, aplicación controlada, evidencia, cancelación/reversión.
- Motor ISR determinista/versionado, precisión Decimal y propuestas IA con revisión humana.
- PRAVIA IA, Assistant Tools, confirmación de escrituras sensibles y ledger de consumo IA.
- Maestro y ficha de Comparecientes, representación y procedencia por campo.
- Catálogo searchable de 38 actos/servicios y normalización de búsqueda.
- Workspaces, rutas y responsive ya aprobados que no contradigan v0.4.
- Agenda, Reportes, Cumplimiento, Finanzas central y Mi Día fuera de los deltas expresamente aprobados.

### Implementaciones incompatibles que deben reemplazarse de forma controlada

- Folios actuales y ausencia de folio PRO.
- Pipeline de Prospectos de cuatro columnas como estado canónico v0.4.
- Conversión de Prospecto sin cotización notarial recibida/fuente aislada.
- Workflow de Cotización centrado en enviar/recibir de Notaría.
- Wizards/drawers operativos posteriores en Prospectos/Cotizaciones y wizard directo de Expedientes.
- Múltiples versiones editables de Cotización como presupuesto vigente.
- Creación directa de Expediente y `cotizacion_id` opcional.
- Acto único rígido del Expediente.
- Cardinalidad de múltiples cálculos ISR vinculados simultáneamente.

### Funcionalidades faltantes

- CFG-001 completo de actividades, dependencias, tiempos, responsables y excepciones.
- CFG-002 normalizado de Plantillas/Formatos, carpetas, reglas y multiplicidad.
- Maestro Predio/Inmueble.
- Solicitud a Notaría y fuente de cotización notarial en Prospectos.
- Actos múltiples y comparecencias/predios por acto.
- Sincronización documental prefirma y snapshot de firma.
- Seguimiento por actividades derivado de CFG-001.
- Pendientes/generación/validación desde CFG-002.
- Presupuesto contractual del expediente.
- Solicitud financiera Abogado–Administración y recibo verificable.
- Cobertura fiscal ISR completa y vínculo único activo.
- Actividad con filtros, notas, cambios y deep links.
- Vigentes/Históricos y restauración/sustitución de documentos de Compareciente.
- Fuentes canónicas faltantes para MID-BASE.

### Migraciones probablemente necesarias

1. Folios tenant-aware y backfill/alias de PRO/COT/EXP.
2. CFG-001: plantillas, actividades, dependencias y excepciones versionadas.
3. CFG-002: tipos, carpetas, reglas, multiplicidad, relaciones a acto/notaría/institución.
4. Prospecto: estados contractuales, solicitud a notaría y fuente recibida.
5. Cotización: origen no-null, estado/presupuesto vigente/conceptos/distribución/PDF histórico.
6. Expediente: cotización no-null después de reconciliar legacy; `ExpedienteActo` y relaciones.
7. Predios, colindancias, documentos y vínculos por acto.
8. Snapshot/sincronización documental y ejecución de plantillas.
9. Presupuesto del expediente y solicitudes/recibos financieros.
10. ISR: vínculo activo único, reglas/campos y referencias a Predio/participantes.
11. Actividad enriquecida y, si procede, relación de reemplazo documental.

Ninguna migración debe reescribir migraciones históricas aplicadas. Cada cambio requiere expandir → backfill verificable → dual-read temporal cuando aplique → restricción → retirada posterior.

### Deltas de mayor riesgo

1. Reconciliar expedientes legacy sin cotización antes de imponer origen no-null.
2. Mapear pipeline/subestados actuales de Prospectos a siete etapas sin perder historia.
3. Convertir versiones/presupuestos actuales a una ficha única sin alterar montos o ledger.
4. Introducir actos múltiples y reasociar comparecientes/documentos/ISR sin inventar relaciones.
5. Crear Predios maestros a partir de datos JSON/documentales sin inferencia silenciosa.
6. Congelar documentos al firmar sin duplicar o perder blobs y sin incluir históricos.
7. Ampliar ISR fuera del alcance federal actual sin rulesets/fundamentos/casos jurídicamente validados.
8. Mantener aislamiento tenant, RBAC, auditoría e idempotencia en todas las nuevas relaciones.

## Pendientes controlados respetados

La auditoría no propone implementar en estas fases:

- diseño final ni reglas nuevas de priorización de Mi Día;
- rediseño central de Cumplimiento;
- conciliación, facturación o reportes globales fuera de EXP-008;
- paquetes Lite/Completa;
- matriz comercial definitiva de permisos;
- nueva política definitiva de retención/papelera.

Las capacidades compatibles existentes de esos módulos quedan explícitamente preservadas.

## Plan mínimo de implementación por dependencias

### Fase A — Fundaciones configurables

1. CFG-001 sobre `TipoActo`/flujos existentes, con versionado y ejecuciones congeladas.
2. CFG-002 sobre Storage/documentos existentes, reutilizando CFG-001, Notarías e instituciones.

### Fase B — Fuentes maestras

1. CMP-001: completar ciclo vigente/histórico y contratos de sincronización.
2. PRD-001: maestro Predio, documentos, propuesta IA y vínculo futuro por acto.

### Fase C — Cadena comercial y apertura

1. PRO-001: folio, siete etapas, solicitud y fuente notarial.
2. COT-001: ficha/presupuesto/estados contractuales y origen obligatorio.
3. EXP-001: selector de cotizaciones y herencia, retirando apertura directa.
4. EXP-002: multi-acto y preview de impacto.
5. EXP-003: persona/rol/participación/representación por acto.

Orden interno ajustado respecto de la preferencia conceptual: PRO-001 debe estabilizar la fuente notarial antes de COT-001; COT-001 debe estabilizar presupuesto/estado antes de imponer EXP-001. EXP-002 debe existir antes de completar EXP-003.

### Fase D — Operación documental y seguimiento

1. EXP-004: consolidación/sync/snapshot documental.
2. EXP-005: actividades/dependencias instanciadas desde CFG-001.
3. EXP-006: resolución de CFG-002 y pendientes por multiplicidad.

### Fase E — Presupuesto, administración y actividad

1. EXP-007: presupuesto vigente y PDFs históricos.
2. EXP-008: solicitudes y aplicación sobre ledger existente.
3. EXP-009: taxonomía/deep links/notas, incorporando eventos finales de 007/008.

### Fase F — Fiscal

ISR-001 después de Predios, comparecencias por acto y presupuesto, con revisión fiscal humana de rulesets y pruebas.

### Fase G — Mi Día, solo preparación de datos

Conectar las nuevas fuentes canónicas a `/api/mi-dia`; no rediseñar la UI ni inventar prioridades.

## Conclusión de preparación

El repositorio tiene fundaciones suficientes para comenzar Fase A sin crear sistemas paralelos. Antes de implementar debe aprobarse el tratamiento de datos legacy de folios, expedientes sin cotización, estados comerciales y versiones de presupuesto. La Fase A puede diseñarse de manera expansiva y backward-compatible sin tocar producción, conservando ejecuciones y documentos actuales.
