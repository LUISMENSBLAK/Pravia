# Correcciones 015, 016 y 017 + Jade — matriz forense previa a implementación

Fecha de auditoría: 2026-09-26
Base inspeccionada: `65d1277022d7e708492835b4b0de8d710ecc4341`
Rama: `codex/pravia-ia2-zantamar-e2e`

## Fuentes leídas completamente

- `PRAVIA_OS_Correccion_Post_Implementacion_015_Flujo_Integral_MultiNotaria_Actos_Procesos_Obligaciones.docx` — 9 páginas.
- `PRAVIA_OS_Correccion_Post_Implementacion_016_CMP-001_PRD-001_Documentos_IA_Estructura_PM_Historial_Predio.docx` — 6 páginas.
- `PRAVIA_OS_Correccion_Post_Implementacion_017_EXP-005_Seguimiento_Procesos_Dias_Restantes.docx` — 6 páginas.
- Jade: inventario de 556 archivos, 205 `.ISR`, 142 `.IMP`, 78 `.FAC`, 7 ayudas CHM, 3 CHW, 5 tutoriales WMV y catálogos TPS.
- Manual Jade completo (63 páginas), listado de campos, exportación/importación, DeclaraNot, tablas ISR 2016/2019 y guía DeclaraNot (22 páginas).
- Cinco tutoriales Jade: terreno, misma fecha, fechas distintas, múltiples vendedores y exención.

Estado: `VERIFICADO`. Los ejecutables propietarios no se ejecutaron; los contratos visibles, manuales, tutoriales y estructuras de archivos sí fueron inspeccionados.

## Clasificación

- `REUSE`: la implementación actual satisface el contrato y puede conservarse.
- `EXTEND`: existe una base correcta, pero faltan capacidades contractuales.
- `REPLACE`: la forma activa actual contradice el documento posterior.
- `LEGACY READ-ONLY`: conservar historia/datos, sin permitir nuevos writes por el flujo anterior.

## Corrección 015 — matriz de arquitectura y flujo integral

| ID | Capacidad contractual | Estado actual comprobado | Clasificación | UI / backend / DB / regla / prueba requerida |
|---|---|---|---|---|
| 015-01 | Organización = Notaría, aislamiento integral | Existen `Organization`, membresías y `tenantPrisma`; 76 referencias core permiten `organization_id` nullable y falta certificación transversal | EXTEND | Hacer obligatorio el tenant donde sea seguro, backfill local preservando organización predeterminada, probar UI/API/búsqueda/exportación/IA/URL/documentos entre dos organizaciones |
| 015-02 | Catálogos globales + extensiones tenant | `TipoActo` admite global (`organization_id = null`) y tenant | REUSE/EXTEND | Certificar precedencia, clonación/adaptación y que tenant no muta maestro global |
| 015-03 | Mayúsculas operativas con exclusiones | Hay normalizadores locales, no política transversal demostrada | EXTEND | Centralizar normalización de texto humano; excluir correos, RFC/IDs técnicos, URLs, claves, contraseñas, contenido documental literal; pruebas de persistencia |
| 015-04 | Prospecto de Recepción a `SOLICITAR COTIZACIÓN`, una sola COT | Existe conversión idempotente del workflow previo, pero no está certificada contra todo el flujo 015 | EXTEND | Acción visible, herencia completa, notificación/apertura, concurrencia/idempotencia y auditoría |
| 015-05 | Suspender/cancelar/reactivar al estado operativo anterior | Suspensión/cancelación existen; reactivación con restauración demostrable no está completa | EXTEND | Persistir etapa previa, actor/fecha/causa y reactivar sin pérdida |
| 015-06 | Cotización por IA, ejemplo o manual sobre una sola estructura | Hay propuesta IA, importación y presupuesto estructurado | EXTEND | Unificar resultado `categoría/concepto/importe`, edición y reload; no duplicar modelo |
| 015-07 | Envío por correo o confirmación manual + días sin respuesta | Transición `ENVIAR_CLIENTE` existe; el cierre de draft/send/manual y contador necesita certificación E2E | EXTEND | Modelo/evento único de envío efectivo, contador desde hecho real, auditoría y reload |
| 015-08 | Documento agrupado por categoría; IVA dentro de Honorarios | Renderer estructurado existente | EXTEND | Verificar DOCX/PDF real, subtotales y total; prueba de varias categorías |
| 015-09 | Aceptación confirma actos y solicitante formal | Conversión actual no acredita la selección formal completa | EXTEND | Gate previo a aceptación/conversión, persistencia y trazabilidad |
| 015-10 | Acto base + variante desde fuente CFG-001 | Configuración V2 tiene actos/configuración operativa | EXTEND | Hacer explícita variante reutilizable por tenant y conservar maestro global |
| 015-11 | Crear acto desde Prospecto/Cotización/Expediente y volver con selección | Existen superficies de configuración, no round-trip certificado | EXTEND | `returnTo` firmado/validado, contexto persistente y selección del acto creado |
| 015-12 | Roles mínimos por acto | Reglas/configuración parcial | EXTEND | Compraventa y protocolización con validación backend + presentación útil |
| 015-13 | Vincular compareciente o crear maestro y regresar | Navegación/maestro existen | EXTEND | Retorno sin perder expediente/acto, object access y prueba real |
| 015-14 | Rol y porcentaje inline; roles tenant reutilizables | UI y relaciones existen parcialmente | EXTEND | Writes tenant-scoped, edición inline y persistencia |
| 015-15 | Validación de porcentajes sin inventar | Hay validaciones parciales | EXTEND | Totales por calidad/acto; advertencia exacta de 50% vs 100%; nunca autocompletar |
| 015-16 | PM sin representante produce advertencia | Relaciones y estructura PM existen | EXTEND | Derivar desde vínculos reales y retirar advertencia al vincular representante |
| 015-17 | Obligaciones pendientes, no documentos precreados | Motor versionado + CFG-002 existentes | REUSE/EXTEND | Resolver obligación→sujeto/contexto→formato; materializar sólo bajo `GENERAR`/`GENERAR TODOS` |
| 015-18 | Un motor Actos y tiempos; retirar Políticas y tiempos paralelo | `TimingPolicyRevision`/`TimingInterval` siguen activos y MID-BASE los consume | REPLACE/LEGACY READ-ONLY | Migrar lectores/escritores canónicos; preservar snapshots históricos; retirar navegación/writes paralelos sólo tras backfill validado |
| 015-19 | Catálogo general de procesos | Conceptos/actividades maestras ya existen, pero la UI aún usa términos mezclados | EXTEND | Identidad estable de proceso maestro, global/tenant, tipo HITO/ACTIVIDAD/SOLICITUD_ESPERA |
| 015-20 | Dependencias por selector, paralelismo, sin ciclos | Selector/grafo/ruta crítica existen | REUSE/EXTEND | Probar topología, ramas paralelas y mensajes humanos de ciclo |
| 015-21 | Proceso complementario | No se encontró relación canónica completa | EXTEND | Relación explícita sin duplicar proceso ni convertirla en dependencia implícita |
| 015-22 | Actividad vulnerable: propuesta IA + motor jurídico determinista versionado | Motor de cumplimiento versionado y revisiones existen | REUSE/EXTEND | IA sólo propone hechos; humano confirma; motor legal decide; reevaluación por cambios |
| 015-23 | `?` explica criterios sin panel técnico | Ayudas dispersas | EXTEND | Popover contextual simple y accesible, sin duplicar reglas |

Pruebas de aceptación 015: `23/23` obligatorias, una por cada paso enumerado en la fuente; ninguna se acreditará sólo con test estático.

## Corrección 016 — Comparecientes y Predios

| ID | Capacidad contractual | Estado actual comprobado | Clasificación | UI / backend / DB / regla / prueba requerida |
|---|---|---|---|---|
| 016-C01 | Upload PDF real, storage privado, metadata, ver/descargar | Flujo documental real existente | REUSE | Certificar PDF con texto y escaneado, persistencia, permisos y URL autenticada |
| 016-C02 | Extracción PDF/imagen/DOCX sin fallback falso | Responses API usa `input_file`/`input_image`; errores preservan campos | REUSE | Pruebas de proveedor fallido, archivo vacío/incompatible y cero writes maestros |
| 016-C03 | Campos faltantes = vacío + aviso `DATO NO ENCONTRADO` | El esquema general omite faltantes y la UI no recibe inventario completo | EXTEND | Lista canónica por PF/PM; faltante fuera del input, nunca como valor; resumen visible |
| 016-C04 | Reextracción no pisa dato confirmado | Se guardan propuestas/fuentes y decisiones humanas | EXTEND | Comparación actual/propuesta y estados ACTUALIZAR/CONSERVAR para todos los campos aplicables |
| 016-C05 | PF/PM separados | Formularios separados existen | REUSE/EXTEND | Eliminar visual/requerimiento PF en PM y probar ambos tipos |
| 016-C06 | PM: generales desde documento | Extractor general sólo permite `razon_social`, RFC y campos PF; insuficiente | EXTEND | Perfil PM con constitución, denominación, régimen, domicilio, datos registrales y faltantes |
| 016-C07 | PM: cuadro accionario/estructura vigente | Editor y grafo canónico existen; propuesta documental separada existe | REUSE/EXTEND | Integrar entrada clara desde documento vigente y revisión ACTUALIZAR/CONSERVAR |
| 016-C08 | PM: consejo o administrador único + personas a identificar | Editor contiene modos de gobierno/roles | REUSE/EXTEND | Propuesta documental, persistencia y señal de identidad incompleta sin autocrear comparecientes |
| 016-C09 | PM: beneficiario/control chain sin inventar | Motor/grafo BC versionado, fuentes y confirmación humana existen | REUSE | Probar cadena incompleta, evidencia, no auto-persona y tenant |
| 016-C10 | Documentos vigentes solamente | Compareciente y Predio filtran `VIGENTE` | REUSE | Probar que históricos no participan salvo acción expresa |
| 016-C11 | Auditoría de extracción/aplicación/error | AuditLog para propuesta/aplicación; fallo IA sólo en ledger técnico | EXTEND | Evento humano compacto con resultado: propuestas/faltantes/error, sin secretos/contenido técnico innecesario |
| 016-C12 | Persistencia + aislamiento | Modelos tenant-scoped; recarga no certificada en este lote | EXTEND | E2E reload y cross-tenant |
| 016-P01 | Maestro Predio con campos completos | Modelo/UI cubren catastral, predial, registral, superficies, valores, ubicación | REUSE/EXTEND | Verificar todos los campos de fuente 016 y etiquetas humanas |
| 016-P02 | Clave catastral ≠ cuenta predial | Campos separados y prompt explícito | REUSE | Fixture con ambos valores y aserción de no cruce |
| 016-P03 | Colindancias variables, >4, no cardinales fijos | Lista variable persistida | REUSE | Prueba de seis tramos y referencias no cardinales |
| 016-P04 | Extracción real desde documento vigente | Implementada por documento, con evidencia | REUSE/EXTEND | Añadir faltantes explícitos y prueba PDF escaneado |
| 016-P05 | Antecedente principal/histórico | Clasificación vigente/histórico/principal existe | REUSE | Probar mover/restaurar y consistencia del principal |
| 016-P06 | Historial `ÚLTIMOS MOVIMIENTOS` persistente | AuditLog se escribe, pero `get()` no proyecta movimientos a la ficha | EXTEND | Read model desde auditoría canónica con actor/fecha/acción; no bitácora paralela |
| 016-P07 | Actividad de IA con propuestas/faltantes/errores | Propuesta y aceptación auditadas; faltantes/error no proyectados | EXTEND | Registrar/proyectar resultado mínimo y útil |
| 016-P08 | Vínculo Predio↔Expediente sin duplicar | Importa relación por referencia, `blob_copies: 0` | REUSE | Probar ida/vuelta e idempotencia |
| 016-P09 | Carga/movimiento/eliminación/restauración auditables | Carga/clasificación/link auditados; restauración/retirada completa por probar | EXTEND | Completar acciones reversibles y read model de movimientos |
| 016-P10 | Decisión campo por campo | `ACCEPT`/`KEEP` obligatorio | REUSE | Probar conflictos, stale version y persistencia |
| 016-P11 | Reload íntegro | Datos/documentos persisten | EXTEND | E2E real de reload y navegación global |
| 016-P12 | Aislamiento entre Notarías | Filtros tenant/object access presentes | EXTEND | PostgreSQL + API + navegador con tenant B |

Pruebas de aceptación 016: Comparecientes `12/12`; Predios `12/12`.

## Corrección 017 — Seguimiento EXP-005

| ID | Capacidad contractual | Estado actual comprobado | Clasificación | UI / backend / DB / regla / prueba requerida |
|---|---|---|---|---|
| 017-01 | Una lista vertical continua | UI agrupa Acto→Etapa→tarjetas | REPLACE | Tabla/lista responsive única |
| 017-02 | Sólo cinco columnas contractuales | UI muestra ruta crítica, proyección, márgenes, dependencias, notas y acciones extra | REPLACE | `PROCESO`, `DÍAS RESTANTES`, `FECHA DE CUMPLIMIENTO`, `RESPONSABLE`, `ESTATUS` solamente |
| 017-03 | Bloqueado = `—` / `PENDIENTE` | Estado interno existe, presentación no contractual | EXTEND | Derivar de dependencias reales |
| 017-04 | Habilitado = `REALIZAR` | UI usa Iniciar/Completar y modal | REPLACE | Acción directa, sin modal ni nota |
| 017-05 | Completado = fecha / `✓ REALIZADO` | Datos reales existen | EXTEND | Presentación exacta y reload |
| 017-06 | Cumplimiento atómico real | Servicio soporta transición, pero normalmente exige flujo previo | EXTEND | `NO_INICIADO/HABILITADO → COMPLETADO` transaccional, actor/hora/responsable |
| 017-07 | Bitácora/Actividad/Auditoría | Historial, AuditLog y actividad general ya se escriben | REUSE/EXTEND | Un solo evento causal; ocultar historial de esta pantalla |
| 017-08 | Desbloqueo y recálculo | Motor ya recalcula y actualiza bloqueos | REUSE/EXTEND | Ajustarlo a fila canónica y probar sólo dependientes satisfechos |
| 017-09 | Lunes–viernes, sin festivos por ahora | Motor admite `HABILES` y `NATURALES` | REPLACE en este read model | Días restantes 017 siempre hábiles Mon–Fri desde el mismo motor, sin segundo motor |
| 017-10 | HOY / vencido sin autocumplir | Hay cálculos temporales, presentación distinta | EXTEND | Formatter determinista, prueba viernes/fin de semana/off-by-one |
| 017-11 | Dedupe por `process_id` maestro | Persistencia/identidad actual incluye `expediente_acto_id`; duplica por acto | REPLACE | Identidad canónica expediente+proceso y asociaciones de actos origen |
| 017-12 | Duración MAX, no suma | Proyección paralela usa MAX, materialización compartida no agrega por maestro | EXTEND | Snapshot de duración por acto + duración resultante MAX |
| 017-13 | Unión de dependencias | Dependencias se crean por instancia de acto | EXTEND | Unionizar por proceso maestro y rechazar ciclos del grafo combinado |
| 017-14 | Preservar completado al agregar acto | Flujo incremental puede crear otra fila pendiente | REPLACE | Incorporar sólo orígenes/config faltante; no reabrir proceso canónico cumplido |
| 017-15 | Orden topológico/configurado | Orden actual depende de etapa/orden por acto | EXTEND | Orden estable derivado del grafo combinado, no alfabético |
| 017-16 | Mantener proyecciones internas | Baseline/proyección/ruta crítica existen y otros lectores las consumen | REUSE | Ocultar sólo en UI; conservar read models para Mi Día/Reportes |
| 017-17 | Mi Día actualizado | Lee actividades/dependencias persistidas directamente | EXTEND | Adaptar a identidad canónica sin duplicar hechos |
| 017-18 | Reportes/estadística estructurada | Listado y artefactos leen actividades persistidas | EXTEND | Conservar proceso, orígenes, duración por acto/MAX, fechas, actor/responsable y atraso |
| 017-19 | Responsable persistente/auditable | Campo y acciones existen parcialmente | EXTEND | Si se expone cambio, usar acción separada auditada y actualizar Mi Día |
| 017-20 | Tenant/RBAC/reload | Scopes presentes | EXTEND | Prueba multi-Notaría, reload y reconstrucción histórica |

Pruebas de aceptación 017: `20/20`.

## ISR — paridad funcional Jade y objetivo PRAVIA

| Área | Jade comprobado | PRAVIA actual | Decisión |
|---|---|---|---|
| Workspace único + cabecera persistente | Sí | Workspace único, jerarquía comprimida y utilidades ocultas | REPLACE UX, REUSE dominio |
| Resumen y cálculo detallado | Sí | Resultado/desglose existentes | EXTEND presentación |
| Operación | Fechas, valores, tipo y escritura | Existe snapshot estructurado | REUSE/EXTEND |
| Inmueble | Terreno/construcción y valores | Componentes soportados | REUSE/EXTEND |
| Sólo terreno / sólo construcción | Sí | Dominio soporta componentes | Añadir pruebas visibles y numéricas |
| Misma fecha / fechas distintas / múltiples adquisiciones | Sí | Dominio avanzado soporta N adquisiciones | Añadir escenarios tutorial exactos |
| N vendedores / N compradores y porcentajes | Sí | Partes múltiples soportadas | EXTEND UX y pruebas |
| Deducciones por componente | Sí | Soportadas con procedencia/versionado | REUSE/EXTEND |
| Exenciones por vendedor y terreno | Sí | Soportadas | REUSE/EXTEND |
| Resultados intermedios/traza | Sí | `calculationTrace` y resultados avanzados | EXTEND presentación |
| Tablas/criterios/versiones | Sí | Fuentes y rulesets versionados | REUSE |
| Utilidades de valor referido, recargos, impuestos | Sí | Existen, hoy relegadas a `details` | REPLACE UX |
| Salidas/formatos/declaraciones | 1A/15C/retención/hoja/DeclaraNot | PDF/perfiles fiscales parciales | EXTEND; no inventar formatos no configurados |
| Guardar/abrir/historial | Sí | Versiones inmutables e historial | REUSE |
| Importación legacy | Sí | No certificada | LEGACY READ-ONLY; sólo importar si hay parser seguro y verificable |
| Ayuda/fuentes/criterios | Sí | Normativa y fuentes estructuradas | EXTEND presentación |

Conteo actual localizado: 67 pruebas de dominio numérico (`24 + 30 + 13`), 27 de servicio y 18 de frontend. El test de PDF no es una prueba numérica. Faltan al menos seis pruebas numéricas independientes para alcanzar `73/73`, además de cinco flujos tutoriales E2E diferenciados.

## Dependencias y estrategia de cambio

1. No retirar `TimingPolicyRevision`/`TimingInterval` hasta migrar sus consumidores de Prospectos, Finanzas y MID-BASE y preservar snapshots históricos.
2. EXP-005 requiere una identidad canónica por `organization_id + expediente_id + process_id`; los actos de origen y sus duraciones deben ser relaciones/snapshots, no filas operativas duplicadas.
3. Mi Día, listado de Expedientes, generación de artefactos y cambio de actos consumen directamente las tablas de seguimiento; se adaptarán en el mismo cambio y tendrán regresión específica.
4. Corrección 016 reutilizará `AuditLog`; no se creará otra bitácora.
5. La extracción PM general y la propuesta de estructura/BC seguirán siendo capacidades distintas pero coordinadas: generales actualizan sólo tras revisión, la estructura usa su grafo canónico y jamás autocrea comparecientes.
6. ISR conservará motor, snapshots, RBAC, auditoría e integraciones válidas; se reemplazará la organización visual y se completarán pruebas/paridad, no se reescribirá el cálculo desde cero.

## Orden de implementación congelado

1. Corrección 017: persistencia canónica, agregación, read model, acción `REALIZAR`, UI y consumidores.
2. Corrección 016: faltantes explícitos, perfil PM, historial Predio/IA y E2E de documentos.
3. Corrección 015: multi-Notaría, workflow punta a punta, catálogo/proceso complementario y retiro seguro de sistema paralelo.
4. ISR/Jade: seis o más escenarios numéricos faltantes, cinco tutoriales, workspace materialmente reorganizado y salidas configuradas.
5. Integración ≥180 pruebas explícitas, PostgreSQL local aislado, browser E2E y responsive; sin producción.

Esta matriz no concede `PASS`: congela el alcance y documenta qué se reutiliza, extiende o reemplaza antes de modificar funcionalidad.
