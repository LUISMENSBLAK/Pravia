# H8 — CUM-001 panel central de Cumplimiento

## Freeze mínimo

- Fuente contractual: `PRAVIA_OS_Documento_Maestro_Diseno_Funcional_v0.5_CUMPLIMIENTO_NOTARIA_APROBADO.docx`, CUM-001 y dependencias CUM-EST-001, CUM-LST-001, CUM-AVI-001 y CUM-CIE-001.
- Decisión: H8 es un read model derivado y global; no persiste estados, KPIs, prioridades ni resúmenes.
- Autoridades reutilizadas: `ExpedienteComplianceState`/H7, `ComplianceObligation`/H6, `ComplianceAlert` y su anticipación versionada, EXP-002, EXP-003, RBAC y `expedienteAccessWhere`.
- Datos: cero migraciones y cero fuentes de verdad nuevas.
- Consulta: dos consultas SQL agregadas/paginadas, una carga de detalle por lote y tres catálogos por lote; el número de consultas no crece con las filas.

## Matriz congelada y evidencia

Todos los atomics siguientes están `IMPLEMENTED+TESTED`. Las pruebas unitarias H8, las pruebas UI H8 y las regresiones citadas son evidencia reproducible.

| # | Atomic | Fuente / autoridad | Implementación y evidencia |
|---:|---|---|---|
| 1 | H8-PNL-001 sidebar | CUM-001 / AppShell | `Sidebar.tsx`; `Sidebar.test.tsx` |
| 2 | H8-PNL-002 ruta global | CUM-001 / router | `/cumplimiento`; `ComplianceH8.test.tsx` |
| 3 | H8-XINT-001 permiso | RBAC existente | middleware + UI; pruebas H8 |
| 4 | H8-PNL-003 KPI Pendientes | H7 | CTE compartido; servicio H8 |
| 5 | H8-PNL-004 KPI Avisos | H6 | CTE compartido; servicio H8 |
| 6 | H8-PNL-005 KPI Por vencer | alertas versionadas | alerta ADVERTENCIA abierta |
| 7 | H8-PNL-006 KPI Vencidos | H7/H6 deadlines | deadline vigente no resuelto |
| 8 | H8-PNL-007 KPI interactivo | CUM-001 | URL + consulta server-side; UI H8 |
| 9 | H8-LST-001 Todos | CUM-001 | filtro SQL `TODOS` |
| 10 | H8-LST-002 Incompletos | H7 | estados no terminales |
| 11 | H8-LST-003 Avisos pendientes | H6 | estados AVI actuales pendientes |
| 12 | H8-LST-004 Por vencer | alertas | bucket canónico ADVERTENCIA |
| 13 | H8-LST-005 Vencidos | H7/H6 | bucket vencido |
| 14 | H8-LST-006 Presentados | H6 | AVI `PRESENTADO` sin equiparar cumplimiento |
| 15 | H8-LST-007 Completos | H7 | estados terminales derivados |
| 16 | H8-LST-008 abogado | Expediente | filtro backend por `abogado_id` |
| 17 | H8-LST-009 acto | EXP-002 | filtro backend por acto activo |
| 18 | H8-LST-010 fechas | deadlines canónicos | rango backend sobre próximo plazo |
| 19 | H8-LST-011 notaría condicional | master Notaría | visible sólo con más de una accesible |
| 20 | H8-LST-012 búsqueda expediente | Expediente | `numero_pravia ILIKE` backend |
| 21 | H8-LST-013 búsqueda escritura | Expediente | número canónico/compatibilidad backend |
| 22 | H8-LST-014 búsqueda compareciente | EXP-003 | `nombre_busqueda` backend |
| 23 | H8-LST-015 una fila | CUM-001 | raíz `ExpedienteComplianceState` |
| 24 | H8-LST-016 N requirements | H7 | no join multiplicador |
| 25 | H8-LST-017 N avisos | H6 | LATERAL agregado |
| 26 | H8-LST-018 N actos | EXP-002 | lote + etiqueta `+N más` |
| 27 | H8-LST-019 principal | EXP-003 | `es_principal` antes de orden operativo |
| 28 | H8-LST-020 abogado canónico | Expediente | relación directa sin copia H8 |
| 29 | H8-LST-021 prefirma | CUM-001 | escritura nullable, fila conservada |
| 30 | H8-LST-022 Entregado pendiente | CUM-001 | sin exclusión por estado operativo |
| 31 | H8-XINT-002 estado H7 | CUM-EST/CUM-CIE | lectura de estado/pending_count persistido por H7 |
| 32 | H8-XINT-003 conteo pendiente | H7 | proyección exacta, sin recalcular frontend |
| 33 | H8-XINT-004 AVI 0 | H6 | “Sin aviso aplicable” |
| 34 | H8-XINT-005 AVI 1 | H6 | resumen humano singular |
| 35 | H8-XINT-006 AVI N | H6 | peor estado + conteo |
| 36 | H8-XINT-007 generated != presented | H6 | no se consulta producto generado como estado |
| 37 | H8-XINT-008 presented != fulfilled | H6 | `PRESENTADO` separado de `CUMPLIDO` |
| 38 | H8-LST-023 orden | CUM-001 | CASE SQL congelado |
| 39 | H8-LST-024 vencido | deadlines | antes del inicio del día |
| 40 | H8-LST-025 vence hoy | deadlines | ventana del día, sin umbral inventado |
| 41 | H8-LST-026 urgente | alertas | `CRITICA` abierta y activa |
| 42 | H8-LST-027 por vencer | alertas | `ADVERTENCIA` abierta y activa |
| 43 | H8-LST-028 sin defaults | contrato | no existen intervalos numéricos H8 |
| 44 | H8-XINT-009 deep-link | Expedientes | `/expedientes/:id#cumplimiento` |
| 45 | H8-XINT-010 consultar listas | CUM-LST/H3 | POST existente `/screening/free` |
| 46 | H8-XINT-011 PF libre | H3 | `tipo_persona=FISICA` |
| 47 | H8-XINT-012 PM libre | H3 | `tipo_persona=MORAL` |
| 48 | H8-XINT-013 no Compareciente | H3 | contrato explícito UI + servicio reutilizado |
| 49 | H8-XINT-014 no Expediente | H3 | contrato explícito UI + servicio reutilizado |
| 50 | H8-XINT-015 aproximada | H3 | revisión humana visible |
| 51 | H8-XINT-016 KPI/visibilidad | RBAC | mismo CTE y mismo scope |
| 52 | H8-XINT-017 cross-tenant | multitenancy | tenant en estado, expediente y agregados |
| 53 | H8-XINT-018 object access | `expedienteAccessWhere` | equivalencia SQL + catálogo Prisma |
| 54 | H8-LST-029 paginación | patrón global | LIMIT/OFFSET backend + meta |
| 55 | H8-LST-030 sin N+1 | performance | seis queries fijas; test de conteo |
| 56 | H8-PNL-008 loading | UI PRAVIA | skeleton finito |
| 57 | H8-PNL-009 error/retry | UI PRAVIA | mensaje humano y retry |
| 58 | H8-PNL-010 empty filtrado/global | CUM-001 | estados diferenciados |
| 59 | H8-PNL-011 responsive | layout | grids 320/390/768/desktop sin tabla ancha |
| 60 | H8-XINT-019 regresión H1–H7 | dependencias | suites dependientes y completas |

## Resultado del freeze

- Total: 60 atomics.
- Diseñables: 60.
- `IMPLEMENTED+TESTED`: 60/60.
- Parciales: 0.
- Faltantes: 0.
