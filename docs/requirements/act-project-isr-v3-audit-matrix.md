# Auditoría de prevalencia — Actos, machotes de Proyecto e ISR-001 v3

Fecha de cierre de auditoría previa a código: 2026-09-27
Rama: `codex/pravia-ia2-zantamar-e2e`
HEAD de partida: `65d1277022d7e708492835b4b0de8d710ecc4341`

## Fuentes y prevalencia

1. `PRAVIA_OS_Correccion_Integral_Actos_Plantillas_Proyeccion.docx` (5/5 páginas leídas y renderizadas).
2. `PRAVIA_OS_Correccion_Post_Implementacion_019_ISR-001_v3_Calculadora_Fiscal_Inmobiliaria.docx` (10/10 páginas leídas y renderizadas).
3. Contratos anteriores, únicamente en aquello que las dos fuentes nuevas no sustituyen expresamente.

La Corrección Integral sustituye el inventario activo inicial de Actos y machotes de Proyecto, pero conserva la arquitectura CFG-001/CFG-002 y el histórico. ISR-001 v3 sustituye la UX y el flujo ISR incompatible; conserva seguridad, persistencia, trazabilidad, motor Decimal, fuentes versionadas, integración documental e historial.

## Cierre de las diez pasadas

| PASADA | EVIDENCIA | RESULTADO |
|---|---|---|
| 1 | Documento Actos/Plantillas/Proyección completo y 5 páginas renderizadas | CERRADA |
| 2 | Cruce con Correction 015, CFG-001, CFG-002, EXP-010, Universal Viewer y Proyecto actual | CERRADA |
| 3 | Inventario SQL: 66 actos activos (38 globales, 28 tenant), referencias tabuladas en `/tmp/pravia-act-reference-audit.tsv` | CERRADA |
| 4 | Un único machote Project activo; los artefactos de Cotización, Presupuesto y Cuestionarios quedan fuera de la limpieza | CERRADA |
| 5 | Lifecycle Project auditado: resolución, instrucciones, versiones, upload manual, review y ausencia de validación/reapertura persistida completa | CERRADA |
| 6 | ISR-001 v3 completo y 10 páginas renderizadas | CERRADA |
| 7 | Cruce ISR pre-Jade, implementación vigente y v3 | CERRADA |
| 8 | Clasificación KEEP / REFACTOR / REPLACE UI / REMOVE / MIGRATE | CERRADA |
| 9 | Cruce de las 112 pruebas numéricas vigentes, detallado abajo | CERRADA |
| 10 | Matriz atómica DB/backend/frontend/tests cerrada | CERRADA |

## Inventario destructivo prohibido y estrategia cerrada

- Actos activos actuales: **66**. Referencias: `ConfiguracionActo=35`, `Expediente.tipo_acto_id=4`, `ExpedienteActo=18`, `ProspectoActo=52`, `CotizacionActo=39`, `CatalogoArtefactoActo=2`, `PlantillaDocumentalVersion=0`.
- Estrategia: retirar del catálogo activo mediante nueva migración correctiva (`activo=false`, `archived_at`), sin borrar filas ni referencias. Los snapshots y relaciones históricas continúan legibles. El seed deja de precargar Actos. Resultado de instalación/limpieza: **0 actos precargados activos**.
- Machote Project actual: artefacto `31100000-0000-4000-8000-000000000010`, organización `30000000-0000-4000-8000-000000000001`, acto `c50dd024-f365-4dee-8cb6-81d2f9dea8fd`. Se desactiva sólo su destino Project/asignación; el blob, versión e histórico se conservan.
- No se eliminan artefactos UIF, PLD, KYC, Cotización, Presupuesto, ISR, Finanzas, cuestionarios ni otros destinos CFG-002.
- La relación nueva de machote es estructural: `organization_id + act_id + artifact_id/current_version_id`. No se permite nombre, `LIKE`, keyword, embedding, LLM ni fallback genérico.

## Clasificación de componentes existentes

| COMPONENTE | CLASIFICACIÓN | DECISIÓN |
|---|---|---|
| CFG-001 Acto/Variante/Procesos/Duración/Dependencias/Roles/Paralelismo | KEEP | Sin rediseño; únicamente retirar inventario precargado activo |
| Seed de 38 Actos | REMOVE | El seed no vuelve a poblar Actos |
| 66 filas Acto ya instaladas | MIGRATE | Archivar de forma no destructiva |
| CFG-002 artefactos/versiones/destinos/Storage | KEEP | Base canónica única |
| Resolución Project por destino genérico o ausencia de Acto | REFACTOR | Resolver exclusivamente asignación exacta org+act |
| Machote Project vigente | MIGRATE | Retirar asignación activa, preservar histórico |
| Versiones e instrucciones Project | KEEP/EXTEND | V1→V2→V3 y base=current; añadir validación/reapertura explícita |
| Upload manual Project | REFACTOR | One-off histórico por defecto; promoción a maestro sólo explícita |
| Review IA Project | KEEP/HARDEN | Analiza Word actual editado; observaciones, nunca mutación |
| Orden visual Project vigente | REPLACE UI | Machote → instrucciones → Proyectar con IA → Word |
| Ruta ISR `/calculo-isr` | KEEP | Única ruta canónica |
| Decimal, snapshots, references, rulesets, provenance | KEEP | Sin fórmulas en React |
| UI ISR actual de 4 bloques | REPLACE UI | Página continua de 7 bloques exactos |
| Paneles administrativos ISR permanentes | REMOVE UI | Fuera del flujo de cálculo principal |
| PF nacional venta | KEEP/REFACTOR | Se integra como una ruta del motor v3 por transmitente/capa |
| Bloqueo de PM, adquisición e IVA | REPLACE | Clasificación real, cálculo o estado PENDIENTE/NO APLICA |
| Campo libre de tasa extranjera | REFACTOR | Sólo regla oficial verificada/versionada |
| Acción “Generar PDF” | REFACTOR LABEL/API | Documento firmable CFG-002; alias compatible temporal sin renderer paralelo |
| IA fiscal | KEEP/HARDEN | Sólo sugerencias; cualquier escenario monetario vuelve al motor determinista |

## Matriz contractual atómica

| REQUIREMENT | SOURCE | CURRENT IMPLEMENTATION | CONFLICT | ACTION | DB | BACKEND | FRONTEND | TEST | RESULT |
|---|---|---|---|---|---|---|---|---|---|
| Catálogo inicial Actos vacío | Actos §2/6 | Seed 38; DB 66 activos | Sí | REMOVE/MIGRATE | Archivar inventario vigente | Filtrar sólo activos | Empty state + crear | Clean DB = 0 | CLOSED |
| Preservar histórico de Actos | Actos §4/5 | FKs a 66 filas | Riesgo si delete | KEEP | Sin DELETE; snapshots intactos | Lectura histórica admite inactivo | Badge histórico | FK/reload | CLOSED |
| Usuario crea Acto nuevo | Actos §6 | Flujo CFG-001 existente | No | KEEP | IDs existentes | Reusar service | Reusar UX | CRUD/tenant | CLOSED |
| Inventario Project vacío | Actos §7/8 | 1 machote activo | Sí | MIGRATE | Desactivar destino/asignación | No resolver retirado | Empty state | Clean DB | CLOSED |
| Preservar otros CFG-002 | Actos §7/8 | Artefactos compartidos | Riesgo de barrido | KEEP | Predicate Project-only | Scope estricto | Sin cambio | Conteos antes/después | CLOSED |
| Asignación exacta org+act | Actos §9-11 | Act relation + fallback genérico | Sí | REFACTOR | Entidad estructurada | Resolver exacto | Mostrar Acto real | Similar names isolation | CLOSED |
| Máximo un default | Actos §12 | Sin unique cross-table | Sí | EXTEND | Unique org+act activo | Conflicto Cancelar/Reemplazar | Diálogo explícito | Concurrencia | CLOSED |
| Alta desde Project o CFG-002 | Actos §13 | Parcial | Parcial | EXTEND | Misma entidad | Mismo servicio | Dos entradas, un contrato | Ambos paths | CLOSED |
| One-off ≠ maestro | Actos §13 | Upload exclusivo ambiguo | Sí | REFACTOR | Metadata/promoción explícita | Default one-off | Checkbox/CTA explícito | No promoción implícita | CLOSED |
| Ver machote | Actos §14 | Universal Viewer disponible | No | KEEP | Sin cambio | Signed local URL | Reusar Viewer | View | CLOSED |
| Descargar machote | Actos §14 | Disponible | No | KEEP | Sin cambio | Permiso documental | Botón | Download | CLOSED |
| Reemplazar versionado | Actos §14 | Versiones CFG-002 | Parcial | EXTEND | Nueva versión, no overwrite | Confirmar + checksum | Confirm dialog | History preserved | CLOSED |
| Editar metadata/Acto | Actos §14 | Parcial | Parcial | EXTEND | Update assignment | Revalidar conflicto | Form scoped | Conflict | CLOSED |
| Eliminar asignación | Actos §14 | Delete puede ser ambiguo | Sí | REFACTOR | Soft deactivate | Histórico intacto | Confirmación | Generated docs remain | CLOSED |
| Orden Project exacto | Actos Project | CTA antes de machote | Sí | REPLACE UI | — | — | Orden contractual | DOM order | CLOSED |
| Versión actual como base | Actos Project | Casi compatible | Parcial | HARDEN | Current version ref | Lock/checksum | V1/V2/V3 | Iteration | CLOSED |
| Validación actor/fecha | Actos Project | Metadata parcial | Sí | EXTEND | Validation record | Actor/effective timestamp | Estado visible | Reload/audit | CLOSED |
| Validado no muta por IA | Actos Project | No bloqueo completo | Sí | EXTEND | Validation guard | Reject | CTA reopen | Backend enforcement | CLOSED |
| Reapertura explícita | Actos Project | Ausente | Sí | EXTEND | Reopen event/cycle | Nueva versión/ciclo | Confirmación | V after reopen | CLOSED |
| Review IA Word actual | Actos Project | Service usa current | Parcial | HARDEN | Snapshot checksum | Observaciones only | Review result | Manual edit then review | CLOSED |
| ISR una ruta canónica | ISR v3 | `/calculo-isr` único | No | KEEP | — | Un controller/service | Un workspace | Routing | CLOSED |
| Página vertical sin wizard | ISR v3 | Página pero 4 bloques | Sí | REPLACE UI | — | — | 7 secciones | No steps/tabs | CLOSED |
| 1 Acto | ISR v3 §orden | Campo textual/operación | Sí | EXTEND | `actTypeId` en snapshot JSON | Validar org/global+activo | Selector CFG-001 | IDOR/inactive | CLOSED |
| Clasificación fiscal interna | ISR v3 | Operation enum parcial | Parcial | REFACTOR | Snapshot versionado | Mapper determinista | Label/trace | Similar acts | CLOSED |
| “Otro” fallback | ISR v3 | Parcial | Parcial | EXTEND | Snapshot | Requiere confirmación | Campo condicional | Unknown act | CLOSED |
| 2 Inmueble | ISR v3 | Property snapshot | Compatible parcial | EXTEND | JSON snapshot | Tipos controlados | Bloque 2 | Conditional fields | CLOSED |
| 3 Valores/adquisición | ISR v3 | Componentes/adquisiciones | Compatible parcial | REFACTOR | Capas por vendedor | LISR/RLISR rules | Repeater por capa | 38 cases | CLOSED |
| Herencia/donación/cadena | ISR v3 | No completa | Sí | EXTEND | Layer provenance | No inferir ausentes | Campos condicionales | Chain cases | CLOSED |
| Construcción/mejoras | ISR v3 | Componentes existen | Parcial | EXTEND | Component/layer | RLISR 205 options | Captura trazable | Evidence alternatives | CLOSED |
| 4 IVA | ISR v3 | Utilidad bloqueada/ref-only | Sí | EXTEND | Result snapshot | LIVA 9 + tasa verificada | Bloque 4 | Land/house/mixed | CLOSED |
| 5 Partes | ISR v3 | Parties arrays | Compatible parcial | EXTEND | Snapshot por persona | Roles seller/buyer | Bloque 5 | 100%/tenant | CLOSED |
| Nacionalidad ≠ residencia | ISR v3 | Campos parciales | Riesgo | REFACTOR | Campos separados | Sin inferencia | Inputs separados | Mexican permanent resident | CLOSED |
| PF/PM primero | ISR v3 | PM bloqueada | Sí | REPLACE | Subject type snapshot | Route classification | Selector claro | PF/PM/foreign | CLOSED |
| PM sin fórmula PF | ISR v3 | Throw genérico | Sí | REPLACE | Status/result | NO_APLICA/PENDIENTE según ruta | Estado humano | PM seller/buyer | CLOSED |
| Extranjero LISR 160 | ISR v3 | Tratamiento manual | Sí | REFACTOR | Rule revision | 25% gross/option only verified | Sin tasa libre | Both routes | CLOSED |
| 6 Deducciones | ISR v3 | Deductions arrays | Compatible parcial | HARDEN | No duplicate source IDs | Validate allocation | Repeater dinámico | No double count | CLOSED |
| Exención casa habitación | ISR v3 | Exención genérica bloqueada | Sí | EXTEND | Evidence + UDI revision | 700k UDI sólo verificado | En bloque 6 | Missing UDI=PENDIENTE | CLOSED |
| 7 Resultados | ISR v3 | Total federal único | Sí | REPLACE UI/EXTEND | Immutable v3 output | seller/buyer/IVA/exempt/foreign | Result cards | Per subject | CLOSED |
| 0 / NO APLICA / PENDIENTE | ISR v3 | Error/total conflados | Sí | EXTEND | Status enum in JSON | Explicit statuses | Human chips | Distinction | CLOSED |
| Regla explicable `?` | ISR v3 | Trace parcial | Parcial | EXTEND | Official revision IDs | Structured trace | Accessible popover | Every result | CLOSED |
| Output determinista completo | ISR v3 | Decimal/traces parciales | Parcial | EXTEND | Snapshot | ruleId/ref/version/inputs/calc/result/explanation | Read-only | Determinism | CLOSED |
| Fuentes oficiales versionadas | ISR v3 | Infra presente | No | KEEP/HARDEN | Verified revisions only | Fecha jurídica | Fuente visible | Future/unverified rejected | CLOSED |
| No inventar regla | Prompt | Algunas rutas bloqueadas | Compatible | KEEP | Missing stays missing | PENDIENTE | Explicación | Absent references | CLOSED |
| IA sólo sugerencias | ISR v3 | Extraction no muta | Compatible | KEEP/HARDEN | Usage audit | No input write | CTA secundaria | Before/after equality | CLOSED |
| Escenario monetario vuelve al motor | ISR v3 | No completo | Sí | EXTEND | Versioned scenario | Recalculate | Compare UI | AI cannot set result | CLOSED |
| Documento final CFG-002 | ISR v3 | Renderer CFG-002 detrás de generatePdf | Naming conflict | REFACTOR | Same artifact/version | `generateDocument`; compatibility alias | “Generar documento” | Configured DOCX/PDF | CLOSED |
| Sin renderer paralelo | ISR v3 | Legacy file existe | Riesgo | REMOVE dead path | — | Una abstracción | — | Resolver test | CLOSED |
| Historial/provenance | ISR v3 | Versiones inmutables | Compatible | KEEP/EXTEND | Version/result/doc links | Audit | Timeline | Reload | CLOSED |
| RBAC/object/tenant | Vigente | Cubierto | No | KEEP | Org FK/scope | Backend enforcement | Hidden+errors | Cross tenant | CLOSED |
| Responsive 6 anchos | ISR v3 | No evidencia v3 | Sí | EXTEND | — | — | 1440/1366/1024/768/390/320 | Browser screenshots | CLOSED |
| Jade 5/5 | Prompt | Baseline PASS | No | REGRESSION | — | Preserve | Preserve | 5/5 | CLOSED |

## Cruce explícito de las 112 pruebas numéricas ISR

El baseline numérico real se compone de `isrFiscalUtilities.test.ts` **21**, `isrTaxEngine.advanced.test.ts` **40** e `isrTaxEngine.test.ts` **51**: **112**. Los 27 tests de servicio son regresión adicional y no se cuentan dentro de esos 112.

| GRUPO BASELINE | CONTEO | DECISIÓN v3 | CONFLICTO / AMPLIACIÓN |
|---|---:|---|---|
| Valor referido, precisión y HALF_UP | 6 | KEEP | Sigue siendo Decimal y snapshot |
| Recargos y referencias mensuales | 3 | KEEP | Sólo fuentes vigentes verificadas |
| Tasas adicionales/perfiles/exportación sin fabricar datos | 12 | KEEP | Se separa de la UX principal |
| Escenarios terreno/construcción/fechas/capas | 8 | KEEP/EXTEND | Capas quedan asociadas por vendedor |
| Validaciones de componentes/adquisición/INPC/factor | 7 | KEEP | Sin defaults inventados |
| Distribución y depreciación | 7 | KEEP | Trazabilidad por regla |
| Vendedores/compradores y 100% | 6 | KEEP/EXTEND | Resultado individual vendedor/comprador |
| Extranjero | 2 | REFACTOR | Elimina tasa libre; LISR 160 versionado |
| Exención/área y liquidaciones | 8 | KEEP/EXTEND | Añade casa habitación + UDI vigente |
| Inmutabilidad avanzada | 2 | KEEP | Snapshot nunca mutado |
| Goldens y límites de tarifa | 25 | KEEP | Tarifa versionada oficial |
| Procedencia, artículos 121/124, 20 años | 8 | KEEP | Integra traza v3 |
| Centavos, mutación, fechas/importes/datos/ruleset | 10 | KEEP | Sin cambio semántico |
| Deducciones/ganancia/pérdida/exenciones/copropiedad | 7 | KEEP/EXTEND | Estados PENDIENTE/NO APLICA explícitos |
| “bloquea personas morales” | 1 | REPLACE | Clasifica PM; jamás aplica PF por comodidad |
| Códigos humanos | 1 | KEEP | Se amplía a resultados v3 |
| **TOTAL** | **112** | **111 preservadas/refactorizadas + 1 reemplazada con contrato nuevo** | **Cruce cerrado** |

Casos v3 nuevos obligatorios que no se dan por cubiertos por el baseline: ISR adquisición por comprador; IVA suelo/casa/mixto; PF/PM/foreign classification; nacionalidad-residencia-migración independientes; casa habitación con UDI/evidencia; herencia/donación/cadena; resultado individual; estados 0/NO APLICA/PENDIENTE; Acto CFG-001 exacto; documento final CFG-002. Se implementan como las 38 pruebas oficiales nuevas más 5 E2E, sin retirar la regresión 112/112.

## Reglas legales verificadas para el diseño

- LISR 119, 121, 124, 130, 132 y 160.
- RLISR 200, 201, 205 y 217.
- LIVA 9.
- LISR 93 fracción XIX (umbral casa habitación en UDI).
- Tarifa anual oficial desde Anexo 8 RMF 2026.

Ningún valor temporal (UDI, INPC, tarifa, tasa o vigencia) se inventa. Una referencia ausente/no verificada/futura produce `PENDIENTE`, no un número supuesto.

## Gate de salida planificado

Migración clean + incremental PostgreSQL; Prisma validate/generate; Project 14/14; ISR oficial 38/38; ISR navegador 5/5; Jade 5/5; baseline 015/016/017/Projection/KNOW/COT-IA; ISR previo 112/112; integración ≥220; backend/frontend full, typecheck y build; Chrome real y seis viewports; `git diff --check`; producción intacta; sin commit/push/deploy; servicios locales saludables y abiertos.

## Evidencia final de implementación local

- PostgreSQL temporal: cadena de **82 migraciones al día**; `20260928010000_act_project_template_correction` aplicada; tabla de asignación presente; **0** Actos precargados activos y **0** destinos Project heredados activos.
- Proyecto/CFG-002 dirigido: **38/38** pruebas en cinco archivos; los 14 requisitos oficiales quedan cubiertos por servicio, UI y el recorrido maestro real.
- ISR dirigido: **181/181** (`112/112` numéricas previas + motor v3 y servicio); los 38 casos oficiales requeridos quedan cubiertos y el archivo v3 contiene 41 casos por tres regresiones adicionales.
- Navegador Chrome real: ISR **5/5**; flujo maestro **224/224** pasos explícitos, sin HTTP 500 ni errores de consola.
- Responsive ISR: **1440 / 1366 / 1024 / 768 / 390 / 320 PASS**, sin overflow horizontal y con el launcher de PRAVIA IA fuera de tarjetas, controles, filas y navegación.
- Regresión completa: backend **161 archivos / 1980 pruebas**; frontend **47 archivos / 412 pruebas**.
- Prisma validate/generate, backend build, frontend typecheck/build y `git diff --check`: **PASS**.
- Datos sintéticos creados por el E2E retirados de los inventarios activos mediante archivado/desactivación local; histórico preservado.
- Producción, staging, commit, push y deploy: **NO TOCADOS**.
