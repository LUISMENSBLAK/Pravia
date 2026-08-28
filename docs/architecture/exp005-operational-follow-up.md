# EXP-005 — Seguimiento operativo, prefirma y postfirma

## Decisión arquitectónica

EXP-005 reutiliza el expediente, sus actos, CFG-001, RBAC, auditoría y el
orquestador canónico de transiciones. No introduce un segundo workflow ni
modifica la configuración maestra durante la operación.

Cada acto activo del expediente materializa una copia operativa inmutable de
las etapas y actividades CFG-001 aplicables. La copia conserva identificadores
de procedencia, revisión, duración, tipo de días, margen, responsabilidad y la
excepción CFG-001 resuelta. Los cambios posteriores de CFG-001 no se reaplican
automáticamente a expedientes abiertos.

Una excepción particular del expediente se registra sobre la copia operativa,
requiere motivo y queda auditada. Nunca escribe de regreso en CFG-001.

## Estados y dependencias

Los únicos estados operativos son `NO_INICIADO`, `EN_PROCESO`,
`EN_ESPERA_EXTERNA`, `COMPLETADO`, `BLOQUEADO` y `NO_APLICA`.

- Una dependencia bloqueante solo queda satisfecha con `COMPLETADO`.
- `NO_APLICA` no satisface dependencias y exige una decisión explícita.
- Un nodo sin avance se bloquea y desbloquea automáticamente.
- Si una dependencia se reabre, el avance posterior nunca se borra: se conserva
  y queda marcado para revisión humana.
- La materialización rechaza ciclos; no intenta resolverlos silenciosamente.

La concurrencia se protege con bloqueo transaccional, versión esperada e
idempotencia por `(organization_id, expediente_acto_id,
actividad_maestra_id)`.

## Tiempo

Los días naturales usan diferencia calendario. Los días hábiles excluyen
sábados y domingos. Esta fase no inventa un calendario oficial de festivos;
cuando exista un calendario canónico se integrará mediante una evolución
contractual separada. El margen se muestra y se mide sin alterar la duración
base congelada.

## Prefirma, firma, postfirma y entrega

La fecha prevista de firma sigue siendo manual. La firma efectiva sigue siendo
la transición canónica existente y congela EXP-004. Dentro de la misma
transacción, EXP-005 actualiza las actividades de firma que procedan; si no
puede hacerlo con certeza las marca para revisión y conserva el avance.

Postfirma se deriva de las etapas configuradas por CFG-001. No existe una lista
hardcodeada de trámites. La entrega al cliente sigue siendo la transición
canónica existente: al entregarse se detienen las alertas operativas normales,
pero se preservan actividades e historial.

## Clasificación de estructuras preexistentes

| Estructura | Clasificación | Tratamiento |
| --- | --- | --- |
| `ExpedienteEtapa` | `REFERENCE_ONLY` | Hitos macro contractuales; no es la actividad operativa por acto. |
| `ChecklistItem` / `ExpedienteRequisitoDoc` | `REFERENCE_ONLY` | Checklist documental; no se convierte en avance EXP-005. |
| `TareaExterna` / `PostfirmaPanel` | `AMBIGUOUS` por defecto | Solo es `SAFE_TO_MIGRATE` si existe procedencia inequívoca hacia acto y actividad CFG-001. En caso contrario se conserva como referencia. |
| Colecciones sin registros | `EMPTY` | No requieren backfill. |

El backfill inicial crea copias operativas sin inventar estados, responsables,
fechas ni progreso. Los registros ambiguos permanecen accesibles para auditoría
y no se eliminan.

## Tenant, autorización y auditoría

Todas las lecturas y escrituras incluyen `organization_id`, verificación de
acceso al expediente y permisos `expedientes.read` / `expedientes.write`. Un
responsable debe pertenecer activamente a la organización. Cada mutación genera
historial operativo, `AuditLog` y actividad visible del expediente, con actor,
sesión, correlación y versión.

## Dry-run y validaciones

El ensayo de migración debe ejecutarse en PostgreSQL aislado aplicando la cadena
completa. Antes y después se comparan, como mínimo, expedientes, actos,
comparecientes, predios, documentos, finanzas, CFG-001 y CFG-002. El resultado
aceptable exige:

- conteos funcionales preexistentes sin pérdida;
- cero huérfanos y cero cruces de tenant;
- cero progreso histórico fabricado;
- dependencias sin ciclos;
- reejecución idempotente;
- migración de reversa estructural verificada solo sobre una copia aislada.

## Rollback

Antes del cutover se conserva el backup canónico. Si EXP-005 falla antes de
aceptar escritura productiva, se revierte la aplicación y se eliminan las tres
tablas nuevas mediante una migración de reversa controlada. Si ya existen
escrituras EXP-005, primero se exportan sus tres tablas con identificadores de
tenant, expediente, acto y configuración; nunca se ejecuta un rollback que las
descarte silenciosamente. Ninguna tabla histórica se modifica o elimina.
