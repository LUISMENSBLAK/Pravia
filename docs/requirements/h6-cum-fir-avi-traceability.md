# H6 · CUM-FIR-001 + CUM-AVI-001 · matriz congelada

Base contractual: `6bf9cfb5f3df5786a7d377c29c71dbc792f9d4b3`.

Estados permitidos en esta matriz: `IMPLEMENTED+TESTED`, `DEFERRED`, `BLOCKED LEGAL DATA` y `BLOCKED OFFICIAL FORMAT DATA`. Las filas bloqueadas conservan infraestructura fail-closed, sin datos jurídicos ni formatos reales inventados.

| Atomic | Estado | Evidencia funcional |
| --- | --- | --- |
| H6-FIR-001 | IMPLEMENTED+TESTED | Autoridad única de transición EXP-004 |
| H6-FIR-002 | IMPLEMENTED+TESTED | Fecha programada y fecha real separadas |
| H6-FIR-003 | IMPLEMENTED+TESTED | Clasificación PRE_FIRMA |
| H6-FIR-004 | IMPLEMENTED+TESTED | Clasificación POST_FIRMA |
| H6-FIR-005 | IMPLEMENTED+TESTED | Clasificación CONTINUA |
| H6-FIR-006 | IMPLEMENTED+TESTED | Preview de firma read-only |
| H6-FIR-007 | IMPLEMENTED+TESTED | Lista y acciones exactas |
| H6-FIR-008 | IMPLEMENTED+TESTED | Hash semántico de preflight |
| H6-FIR-009 | IMPLEMENTED+TESTED | Confirmación con recomputación |
| H6-FIR-010 | IMPLEMENTED+TESTED | Conflicto 409 con nuevo preflight |
| H6-FIR-011 | IMPLEMENTED+TESTED | Control de versión y tenant |
| H6-FIR-012 | IMPLEMENTED+TESTED | Transacción única de firma |
| H6-FIR-013 | IMPLEMENTED+TESTED | Snapshot documental EXP-004 |
| H6-FIR-014 | IMPLEMENTED+TESTED | Seguimiento EXP-005 |
| H6-FIR-015 | IMPLEMENTED+TESTED | Actividad EXP-009 |
| H6-FIR-016 | IMPLEMENTED+TESTED | Audit y outbox canónicos |
| H6-FIR-017 | IMPLEMENTED+TESTED | Retry idempotente |
| H6-FIR-018 | IMPLEMENTED+TESTED | Listo para firma derivado |
| H6-FIR-019 | IMPLEMENTED+TESTED | Orquestación de formatos EXP-006/H2 |
| H6-FIR-020 | IMPLEMENTED+TESTED | Seis resultados cerrados de generación |
| H6-FIR-021 | IMPLEMENTED+TESTED | Paquete con selección explícita |
| H6-FIR-022 | IMPLEMENTED+TESTED | Consolidación PDF o ZIP real |
| H6-FIR-023 | IMPLEMENTED+TESTED | Producto generado distinto de firmado |
| H6-FIR-024 | IMPLEMENTED+TESTED | Proyecto y escritura definitiva |
| H6-FIR-025 | IMPLEMENTED+TESTED | Handler independiente ExpedienteFirmado |
| H6-AVI-001 | IMPLEMENTED+TESTED | ComplianceObligation como master estable |
| H6-AVI-002 | IMPLEMENTED+TESTED | Legal obligation key versionada |
| H6-AVI-003 | IMPLEMENTED+TESTED | Identidad estable tenant-aware |
| H6-AVI-004 | IMPLEMENTED+TESTED | Serializer cerrado de scope |
| H6-AVI-005 | IMPLEMENTED+TESTED | Multi-act por ACT_SET |
| H6-AVI-006 | IMPLEMENTED+TESTED | Multi-rule por triggers N:M |
| H6-AVI-007 | IMPLEMENTED+TESTED | Semántica reversible NO_APLICA |
| H6-AVI-008 | BLOCKED LEGAL DATA | Plazos reales no inventados |
| H6-AVI-009 | BLOCKED LEGAL DATA | Canales/agrupaciones reales no inventados |
| H6-AVI-010 | BLOCKED LEGAL DATA | Política real de evidencia no inventada |
| H6-AVI-011 | IMPLEMENTED+TESTED | Ocho estados AVI exactos |
| H6-AVI-012 | IMPLEMENTED+TESTED | Freshness CURRENT/STALE separada |
| H6-AVI-013 | IMPLEMENTED+TESTED | review_needed post-presentación |
| H6-AVI-014 | IMPLEMENTED+TESTED | Requirement AVI estable |
| H6-AVI-015 | IMPLEMENTED+TESTED | CUM-EST derivado |
| H6-AVI-016 | IMPLEMENTED+TESTED | Fiche draft con concurrencia optimista |
| H6-AVI-017 | IMPLEMENTED+TESTED | Fiche validada inmutable |
| H6-AVI-018 | IMPLEMENTED+TESTED | Nueva draft basada en validada |
| H6-AVI-019 | IMPLEMENTED+TESTED | MASTER_SOURCE read-only |
| H6-AVI-020 | IMPLEMENTED+TESTED | NOTICE_LOCAL_FIELD editable |
| H6-AVI-021 | IMPLEMENTED+TESTED | Source manifest consumido |
| H6-AVI-022 | IMPLEMENTED+TESTED | Fingerprint semántico relevante |
| H6-AVI-023 | IMPLEMENTED+TESTED | Reuso de pagos H5 |
| H6-AVI-024 | IMPLEMENTED+TESTED | Reuso de BC H4 |
| H6-AVI-025 | IMPLEMENTED+TESTED | Reuso de ISR canónico |
| H6-AVI-026 | IMPLEMENTED+TESTED | Reuso de Predios PRD |
| H6-AVI-027 | IMPLEMENTED+TESTED | Reuso de Comparecientes EXP-003 |
| H6-AVI-028 | IMPLEMENTED+TESTED | Reuso de Actos EXP-002 |
| H6-AVI-029 | IMPLEMENTED+TESTED | Documento como único master de bytes |
| H6-AVI-030 | IMPLEMENTED+TESTED | Productos append-only |
| H6-AVI-031 | IMPLEMENTED+TESTED | Regeneración preserva historia |
| H6-AVI-032 | IMPLEMENTED+TESTED | Presentaciones append-only |
| H6-AVI-033 | IMPLEMENTED+TESTED | Normal/complementaria/corrección y lineage |
| H6-AVI-034 | IMPLEMENTED+TESTED | Generado distinto de presentado |
| H6-AVI-035 | IMPLEMENTED+TESTED | Presentado distinto de cumplido |
| H6-AVI-036 | IMPLEMENTED+TESTED | Acuses 1:N |
| H6-AVI-037 | IMPLEMENTED+TESTED | Propuesta IA separada y confirmación humana |
| H6-AVI-038 | IMPLEMENTED+TESTED | UI 0/1/N dentro de Cumplimiento |
| H6-OFF-001 | IMPLEMENTED+TESTED | Master institucional estable |
| H6-OFF-002 | IMPLEMENTED+TESTED | Revisión oficial append-only |
| H6-OFF-003 | IMPLEMENTED+TESTED | Activación explícita por organización |
| H6-OFF-004 | IMPLEMENTED+TESTED | Selector determinista 0/1/N |
| H6-OFF-005 | IMPLEMENTED+TESTED | Base de fecha cerrada |
| H6-OFF-006 | BLOCKED OFFICIAL FORMAT DATA | Layout SPPLD real no inventado |
| H6-OFF-007 | BLOCKED OFFICIAL FORMAT DATA | Layout DeclaraNOT real no inventado |
| H6-OFF-008 | BLOCKED OFFICIAL FORMAT DATA | Catálogos/columnas reales no inventados |
| H6-OFF-009 | BLOCKED OFFICIAL FORMAT DATA | Transformaciones/adapters reales no inventados |
| H6-OFF-010 | IMPLEMENTED+TESTED | Registro técnico cerrado de adapters |
| H6-OFF-011 | IMPLEMENTED+TESTED | Lifecycle DRAFT/VERIFIED/RETIRED |
| H6-OFF-012 | IMPLEMENTED+TESTED | Definición faltante fail-closed |
| H6-OFF-013 | DEFERRED | Sin crawler o detección automática de Internet |
| H6-OFF-014 | DEFERRED | Sin protocolos/APIs futuras |
| H6-OFF-015 | IMPLEMENTED+TESTED | Sin datos oficiales productivos sembrados |
| H6-XINT-001 | IMPLEMENTED+TESTED | Writer legacy retirado |
| H6-XINT-002 | IMPLEMENTED+TESTED | external_* sólo compatibilidad histórica |
| H6-XINT-003 | IMPLEMENTED+TESTED | Cutover sin dual-write |
| H6-XINT-004 | IMPLEMENTED+TESTED | Backfill conservador A-D |
| H6-XINT-005 | IMPLEMENTED+TESTED | Legacy loss cero |
| H6-XINT-006 | IMPLEMENTED+TESTED | ordinaryNoticeDeadline fuera de H6 productivo |
| H6-XINT-007 | IMPLEMENTED+TESTED | RBAC/auditoría existentes reutilizados |
| H6-XINT-008 | IMPLEMENTED+TESTED | UI responsive 320/390/768/desktop |

Resumen congelado: **86 total = 77 IMPLEMENTED+TESTED + 2 DEFERRED + 3 BLOCKED LEGAL DATA + 4 BLOCKED OFFICIAL FORMAT DATA**.

## Cobertura atómica implementada

Los rangos siguientes particionan exactamente las 77 filas `IMPLEMENTED+TESTED`. Para cada rango se identifica la autoridad de implementación y las familias conductuales que la verifican; las nueve filas no diseñables permanecen fuera de esta cobertura.

| Atómicos | Evidencia de implementación | Evidencia de prueba |
| --- | --- | --- |
| H6-FIR-001..005 | `complianceH6.ts` y `complianceH6.service.ts`: transición canónica y clasificación de fases | H6-TF-006, H6-TF-029 y suites EXP-004/005/009 |
| H6-FIR-006..013 | `complianceH6.service.ts`: preview, snapshot semántico, confirmación transaccional, versión y tenant | H6-TF-007..012, H6-TF-028, H6-TF-031 |
| H6-FIR-014..018 | `complianceH6EventHandlers.ts` y servicios EXP: seguimiento, actividad, audit/outbox, retry y estado derivado | H6-TF-028, H6-TF-046 y suites EXP-005/009/outbox |
| H6-FIR-019..024 | `complianceH6.service.ts`: orquestación, paquete PDF/ZIP, productos y escritura canónica | H6-TF-013..018, H6-TF-025, H6-TF-037..040 |
| `H6-FIR-025` | `complianceH6EventHandlers.ts`: consumidor independiente `ExpedienteFirmado` | H6-TF-046 |
| H6-AVI-001..007 | schema/migración H6 y `complianceH6.service.ts`: master, identidad, scope y triggers N:M | H6-TF-002..004, H6-TF-026..035 |
| H6-AVI-011..015 | `complianceH6.ts` y motor H1: estados, freshness, review y requirements | H6-TF-004, H6-TF-029, H6-TF-046 |
| H6-AVI-016..022 | `complianceH6.service.ts`: lifecycle de ficha, autoridades de campo, manifest y fingerprint | H6-TF-007..012, H6-TF-036, H6-TF-039 |
| H6-AVI-023..029 | `sourceContext` y resolvers canónicos H5/H4/ISR/PRD/EXP-002/003/Documento | H6-TF-034, H6-TF-036..038 y suites de dependencia correspondientes |
| H6-AVI-030..038 | schema/servicio H6 y `H6NoticeWorkspace.tsx`: historia append-only, acuses, IA preparada y UI 0/1/N | H6-TF-040..041, H6-TF-047..055 |
| H6-OFF-001..005 | schema/servicio H6: master, revisiones, activación, selector y fecha | H6-TF-005, H6-TF-027, H6-TF-039 |
| H6-OFF-010..012 | `complianceH6.service.ts`: registro de adapters, lifecycle y fail-closed | H6-TF-027, H6-TF-039, H6-TF-041 |
| `H6-OFF-015` | migración H6 sin seeds jurídicos/oficiales | H6-TF-027, H6-TF-056..057 |
| H6-XINT-001..008 | migración/servicios/UI H6: cutover único, backfill A-D, pérdida cero, permisos y responsive | H6-TF-042..046, H6-TF-055..057 |

## Evidencia de las 57 familias congeladas

Cada fila identifica una prueba o validación ejecutable y la aserción conductual que cubre. Las validaciones PostgreSQL usan exclusivamente los destinos locales H6 A/B.

| Familia | Prueba/validación | Aserción conductual |
| --- | --- | --- |
| H6-TF-001 | `complianceH6.test.ts` · serializa y hashea objetos | JSON y hash independientes del orden |
| H6-TF-002 | `complianceH6.test.ts` · serializa cuatro scopes | scopes cerrados, UUID, orden y deduplicación |
| H6-TF-003 | `complianceH6.test.ts` · identidad estable | hash sin review, fecha ni label |
| H6-TF-004 | `complianceH6.test.ts` · ocho estados AVI | tabla completa de derivación |
| H6-TF-005 | `complianceH6.test.ts` · selector oficial | selección 0/1/N fail-closed |
| H6-TF-006 | `complianceH6.test.ts` · preflight PRE_FIRMA | excluye POST_FIRMA y deriva faltantes |
| H6-TF-007 | `complianceH6.test.ts` · hash semántico | cambio de label/timestamp no altera hash |
| H6-TF-008 | `complianceH6.test.ts` · hash semántico | reemplazo de documento altera hash |
| H6-TF-009 | `complianceH6.test.ts` · hash semántico | cambio de checksum altera hash |
| H6-TF-010 | `complianceH6.test.ts` · hash semántico | estado/checksum de evidencia altera hash |
| H6-TF-011 | `complianceH6.test.ts` · hash semántico | revisión/producto EXP-006 altera hash |
| H6-TF-012 | `complianceH6.test.ts` · hash semántico | versión snapshot EXP-004 altera hash |
| H6-TF-013 | `complianceH6.test.ts` · clasificación firmable | propósito FIR vigente incluido |
| H6-TF-014 | `complianceH6.test.ts` · clasificación firmable | general/no obligatorio/fuera de alcance excluido |
| H6-TF-015 | `complianceH6.test.ts` · escritura canónica | borrador único permitido |
| H6-TF-016 | `complianceH6.test.ts` · escritura canónica | definitiva única permitida |
| H6-TF-017 | `complianceH6.test.ts` · escritura canónica | definitiva gana ante borrador |
| H6-TF-018 | `complianceH6.test.ts` · escritura canónica | ambigüedad draft/definitiva rechazada |
| H6-TF-019 | `complianceH6.test.ts` · invalidación | stable ID exacto no sobrealcanza null/otro ID |
| H6-TF-020 | `complianceH6.test.ts` · invalidación | invalidación por tipo conserva alcance amplio explícito |
| H6-TF-021 | `complianceH6.test.ts` · lineage | NORMAL sin previous permitido y con previous rechazado |
| H6-TF-022 | `complianceH6.test.ts` · lineage | complementaria/corrección sin previous permitida |
| H6-TF-023 | `complianceH6.test.ts` · lineage | autorreferencia rechazada |
| H6-TF-024 | `complianceH6.test.ts` · fingerprint | normalización independiente del orden |
| H6-TF-025 | `complianceH6.test.ts` · package kind | PDF homogéneo, ZIP mixto, vacío rechazado |
| H6-TF-026 | `complianceH6.contract.test.ts` · matriz | 86 IDs y particiones exactas |
| H6-TF-027 | `complianceH6.contract.test.ts` · persistencia | ocho modelos y una migración H6 |
| H6-TF-028 | `complianceH6.contract.test.ts` · FIR | preview/confirm, versión, tenant, transacción e idempotencia |
| H6-TF-029 | `complianceH6.contract.test.ts` · fases | PRE_FIRMA/POST_FIRMA/CONTINUA y ocho estados |
| H6-TF-030 | `complianceH6.contract.test.ts` · triggers | identidad estable y provenance N:M |
| H6-TF-031 | `complianceH6.remediation.test.ts` · acceso | expediente inaccesible rechazado antes de persistir |
| H6-TF-032 | `complianceH6.remediation.test.ts` · scope | acto ausente/ajeno rechazado antes de identidad |
| H6-TF-033 | `complianceH6.remediation.test.ts` · ACT_SET | multi-act válido y retry sin trigger duplicado |
| H6-TF-034 | `complianceH6.contract.test.ts` · scope | subject/instrument/case usan pertenencia transaccional |
| H6-TF-035 | `complianceH6.postgresql.integration.test.ts` · lineage | cuatro FKs físicas de trigger presentes |
| H6-TF-036 | `complianceH6.contract.test.ts` · fuentes | tx propagado a selector, manifest y fingerprint |
| H6-TF-037 | `complianceH6.contract.test.ts` · paquete | requirement PRE_FIRMA firmable, aplicable y validado |
| H6-TF-038 | `complianceH6.contract.test.ts` · paquete | artefacto current firmable; generales/históricos excluidos |
| H6-TF-039 | `complianceH6.contract.test.ts` · inmutabilidad | fiche validada y revisión verificada protegidas |
| H6-TF-040 | `complianceH6.contract.test.ts` · historia | producto/presentación/acuse append-only |
| H6-TF-041 | `complianceH6.contract.test.ts` · IA | acuse PREPARE_ONLY y confirmación humana separada |
| H6-TF-042 | `complianceH6.contract.test.ts` · cutover | writer anterior retirado y sin dual-write |
| H6-TF-043 | `complianceH6.postgresql.integration.test.ts` · legacy A | presentación + acuse materializados |
| H6-TF-044 | `complianceH6.postgresql.integration.test.ts` · legacy B | sólo presentación materializada |
| H6-TF-045 | `complianceH6.postgresql.integration.test.ts` · legacy C/D | ambos preservados sin derivados ni pérdida |
| H6-TF-046 | `complianceH6.contract.test.ts` · postfirma | handler independiente reutiliza motor H1 |
| H6-TF-047 | `ComplianceH6.test.tsx` · vacío | 0 obligaciones sin acción inventada |
| H6-TF-048 | `ComplianceH6.test.tsx` · etiquetas | una obligación, provenance y enum no visible |
| H6-TF-049 | `ComplianceH6.test.tsx` · cardinalidad | N obligaciones y revisión post-presentación |
| H6-TF-050 | `ComplianceH6.test.tsx` · presentación | acción humana explícita requerida |
| H6-TF-051 | `ComplianceH6.test.tsx` · ficha | sólo campos locales editables |
| H6-TF-052 | `ComplianceH6.test.tsx` · acuse | vínculo a presentación exacta |
| H6-TF-053 | `ComplianceH6.test.tsx` · historial | normal + complementaria + corrección completas |
| H6-TF-054 | `ComplianceH6.test.tsx` · lineage UI | selector previous y nueva acción permanecen disponibles |
| H6-TF-055 | `ComplianceH6.test.tsx` + `complianceH6.contract.test.ts` · responsive | historial y acciones alcanzables conductualmente a 320/390/768/desktop, breakpoints y targets 44px |
| H6-TF-056 | `complianceH6.postgresql.integration.test.ts` · DB A | bootstrap 52/52 y fingerprint canónico |
| H6-TF-057 | `complianceH6.postgresql.integration.test.ts` · DB B | H5→H6, A/B/C/D y paridad de fingerprint |

Self-review histórico: **PREVIOUS SELF-REVIEW NOT RECONSTRUCTIBLE**. No se inventaron once hallazgos retrospectivos; los doce hallazgos forenses H6-F-001..H6-F-012 quedan vinculados arriba a símbolos, correcciones y pruebas actuales reproducibles.
