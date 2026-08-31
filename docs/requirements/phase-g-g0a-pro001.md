# G0-A — PRO-001: matriz previa y decisiones de implementación

Base: `23d7b9318aa6b7f2907263359c4c44d97b8bbfec`, rama `codex/phase-b-expedientes`.
Contrato releído: v0.4 y v0.5, PRO-001 pp. 65–67, MID-BASE pp. 68–69.
Los párrafos PRO-001/MID-BASE son literalmente iguales entre ambas versiones.
Estado inicial de esta matriz: PENDIENTE DE IMPLEMENTACIÓN / VERIFICACIÓN. Ninguna fila presume PASS.

## Auditoría anterior al cambio

- `backend/prisma/schema.prisma`: Prospecto, ProspectoSeguimiento, ProspectoEtapaCatalogo,
  ProspectoServicioCatalogo, Notaria, Cotizacion, Documento, ProspectoDocumento,
  CotizacionDocumento, OrganizationMembership y AuditLog.
- `backend/src/domain/prospectCatalog.ts`: tres etapas documentales
  PROSPECTO_RECIBIDO, ANTECEDENTES_SOLICITADOS, ANTECEDENTES_RECIBIDOS; 38 servicios.
- `backend/src/domain/prospectQuery.ts`: estado filtra subestado; etapa filtra catálogo documental.
- `backend/src/controllers/prospectos.controller.ts`: creación y edición sin eventos contractuales;
  seguimientos libres, sin significado de transición. No existe notaría asignada al Prospecto ni folio persistido.
- Subestados conservados: NUEVO, INFO_PENDIENTE, DOCS_RECIBIDOS, EN_REVISION,
  COTIZACION_SOLICITADA, COTIZACION_ENVIADA, SEGUIMIENTO, ACEPTADO, PERDIDO, CANCELADO, ARCHIVADO.
- `frontend/src/features/prospects/prospects.types.ts`: pipeline visual Nuevo / En proceso /
  Cotización / Convertido, agrupado por los subestados anteriores. No equivale a etapa contractual.
- `frontend/src/features/prospects/{ProspectDetailPage.tsx,prospects.service.ts,components/}`:
  ficha con drawer de edición, creación de cotización prematura, documentos generales.
- `backend/src/controllers/cotizaciones.controller.ts`, `domain/cotizacionWorkflow.ts`:
  creación desde Prospecto antes de respuesta notarial; solicitud/preparación/envío/recepción en Cotización;
  plazos legacy de cinco días. Conversión única por prospecto_id ya tiene unique.
- `backend/src/services/cotizacionConversion.service.ts`: conversión a Expediente e herencia documental;
  se conserva sin cambios funcionales.
- `backend/src/{auth/actorContext.ts,auth/permissions.ts,config/tenantPrisma.ts,
  services/objectAccess.service.ts,middleware/objectAccess.middleware.ts}`:
  autoridad canónica de actor, tenant, permisos y alcance por objeto. Reutilizar, no duplicar.
- `backend/src/controllers/documentos.controller.ts`, `storage/storage.service.ts`:
  Documento maestro, vínculos, storage privado, URL autenticada y desvinculación sin borrar blob.
- `backend/src/utils/auditLogger.ts`, `services/expedienteFinance.service.ts`:
  AuditLog existente; patrón transaccional directo disponible, independiente de transición.
- No transporte de correo operativo encontrado en backend. Copiar/preparar + registrar envío externo
  confirmado satisface el mínimo contractual sin simular entrega por proveedor.

## Decisiones

1. Nuevo campo contractual nullable: no recodificar `estado` ni `etapa_operativa_codigo` históricos.
2. Un registro de transición por hecho, distinto de nota libre y de AuditLog. El envío produce
   Listo → En espera, con hito intermedio Solicitud enviada en el MISMO evento/instante.
3. `stageEnteredAt` se lee del evento actual, no de timestamps genéricos. Los históricos sin evento
   siguen desconocidos; una confirmación humana actual no reconstruye su pasado.
4. Fuente notarial versionada referencia Documento existente. Primera recepción inmutable;
   sustituir fuente no vuelve a entrar a Cotización recibida. Sin copiar blobs.
5. Lock por prospecto + versión esperada + idempotency key y hash de contenido. Auditoría en la
   misma transacción que evento y estado. Un reintento no vuelve a ejecutar hechos posteriores.
6. Cotizaciones nuevas sólo nacen mediante la conversión canónica de Prospecto; la ruta antigua
   delega en ella. Nacen en BORRADOR con fuente explícita; una adaptación mínima permite pasar
   a revisión sin solicitar otra vez Notaría. Las cotizaciones históricas sin fuente canónica
   conservan su workflow temporal. No G0-B, no nuevos estados COT, no cambios financieros.
7. Migración siguiente disponible: `20260831020000_create_pro001_source_prerequisites`.
   Aditiva; ningún UPDATE para inferir fechas/etapas; ningún evento histórico fabricado.
8. Folios nuevos PRO-####-AAAA y COT-####-AAAA reservados transaccionalmente. Folios antiguos intactos.
9. UI necesaria dentro de ficha inline; mismos tokens/componentes. El pipeline visual deriva de
   `etapa_contractual` cuando existe y sólo usa el subestado histórico cuando la etapa canónica es
   desconocida. No existe una segunda autoridad de etapa.

## Matriz atómica (96 requisitos; identificadores estables)

### A1 — Etapas e identificación

| ID | Verificación |
|---|---|
| G001 | Catálogo canónico contiene exactamente las siete etapas contractuales. |
| G002 | Labels humanos canónicos, sin enums técnicos en superficies afectadas. |
| G003 | Etapa contractual separada del subestado histórico. |
| G004 | Etapa contractual separada del catálogo documental histórico. |
| G005 | Pipeline visual y filtros derivan de la etapa contractual; sólo los registros sin etapa canónica usan compatibilidad legacy explícita. |
| G006 | Creación mínima permite nombre sin exigir datos aún desconocidos. |
| G007 | Nuevo prospecto recibe folio PRO-####-AAAA sin pedir fecha ni folio. |
| G008 | Reserva de folios concurrente no produce colisiones. |
| G009 | Nueva creación siempre inicia en Nuevo; no admite etapa inyectada. |
| G010 | Campos operativos se editan inline, sin wizard nuevo. |
| G011 | Notaría y responsable válidos, activos y de la organización; sin ampliar permisos. |
| G012 | Histórico no obtiene folio, etapa ni fecha contractual inventados. |

### A2 — Transiciones, autoridad y atomicidad

| ID | Verificación |
|---|---|
| G013 | Evento incluye prospecto y organización autenticada. |
| G014 | Evento incluye etapa anterior y nueva. |
| G015 | Evento incluye fecha efectiva y timestamp técnico independientes. |
| G016 | Evento incluye actor, acción/causa y procedencia. |
| G017 | Estado y evento se persisten en la misma transacción. |
| G018 | Fallo de evento o auditoría revierte la operación completa. |
| G019 | stageEnteredAt procede de la transición actual válida. |
| G020 | Edición, nota o documento no cambia stageEnteredAt. |
| G021 | Evento inicial se crea atómicamente con Prospecto. |
| G022 | Retry de creación no duplica Prospecto ni evento. |
| G023 | Recabando requiere acción explícita; subir archivo no basta. |
| G024 | Listo requiere confirmación humana; no umbral de documentos/campos. |
| G025 | Transiciones no permitidas se rechazan. |
| G026 | Escritura genérica no permite alterar etapa, evento, fecha, folio ni versión. |
| G027 | No se admiten fechas inválidas/futuras ni cronología inversa. |
| G028 | Stale version no sobrescribe cambios posteriores. |
| G029 | Retry del mismo key/payload devuelve resultado sin nuevo hecho. |
| G030 | Mismo key con payload diferente se rechaza. |
| G031 | Carreras listo/envío y listo/recabando tienen resultado seguro. |
| G032 | AuditLog separado, actor/org y before/after; no EXP-009 pre-expediente. |

### A3 — Solicitud y espera de Notaría

| ID | Verificación |
|---|---|
| G033 | Preparación usa datos existentes del Prospecto y Notaría. |
| G034 | Texto revisable por humano antes de registrar envío. |
| G035 | Adjuntos son seleccionados explícitamente; ninguno por defecto. |
| G036 | Sólo adjuntos autorizados y vinculados al Prospecto. |
| G037 | Preparación/copia/descarga/apertura no crea transición ni envío. |
| G038 | Copiar contenido permite trabajar sin transporte de correo. |
| G039 | Registro externo exige confirmación, canal, destinatario y evidencia/resumen. |
| G040 | Registro conserva fecha efectiva, notaría, contenido y adjuntos seleccionados. |
| G041 | Hito Solicitud enviada e inicio En espera comparten un hecho y fecha. |
| G042 | No se crea intervalo falso entre envío y espera. |
| G043 | Retry/doble envío no reinicia espera ni duplica transición. |
| G044 | Recepción concurrente con envío no pierde recepción ni reinicia espera. |
| G045 | Espera expone cliente/interna/notaría sin calcular SLA. |
| G046 | Cotización nueva no puede crear otro hecho notarial por ruta alternativa. |

### A4 — Fuente notarial y documentos

| ID | Verificación |
|---|---|
| G047 | Recepción explícita exige confirmación humana y fecha efectiva. |
| G048 | Fuente tipificada referencia Documento canónico válido. |
| G049 | Fuente conserva Prospecto, organización, notaría, origen y actor. |
| G050 | Documento genérico/clasificación automática no marca recepción. |
| G051 | Primera recepción genera una transición a Cotización recibida. |
| G052 | Fuente se presenta separada de documentos generales. |
| G053 | Sustitución conserva versión anterior y motivo/procedencia. |
| G054 | Sustitución no modifica primera fecha receivedAt ni stageEnteredAt. |
| G055 | Retry de recepción/sustitución no crea versiones equivalentes. |
| G056 | Dos recepciones simultáneas no sobrescriben fuente silenciosamente. |
| G057 | Fuente no puede apuntar a documento/notaría de otro tenant. |
| G058 | Sin segundo storage/visor/sistema documental ni copia innecesaria de blobs. |
| G059 | Documentos generales conservan ver/descargar/desvincular según permisos. |
| G060 | Fuente histórica conserva referencia aunque se desvincule un documento general. |

### A5 — Conversión y frontera mínima

| ID | Verificación |
|---|---|
| G061 | Sólo convierte con recepción y fuente notarial válidas. |
| G062 | Conversión exige permiso de Prospectos y Cotizaciones y acceso al objeto. |
| G063 | Cotización resultante conserva relación única con Prospecto. |
| G064 | Estado Convertido y evento son atómicos con la nueva Cotización. |
| G065 | Dos conversiones/retries no crean una segunda Cotización. |
| G066 | Nuevo folio COT-####-AAAA; históricos no se recodifican. |
| G067 | Datos/notaría/fuente se heredan sin copiar blobs. |
| G068 | Documentos generales siguen disponibles en Cotización/Expediente. |
| G069 | Ruta compartida antigua no permite bypass de fuente ni origen. |
| G070 | Cotizaciones históricas preservan compatibilidad explícita, sin dos autoridades para nuevas. |
| G071 | Fuente heredada se expone aislada; ninguna mutación completa COT-001. |
| G072 | Controles de aceptación/versión/anticipo/conversión a Expediente no se alteran. |

### A6 — Históricos, seguridad, migración y presentación

| ID | Verificación |
|---|---|
| G073 | UNKNOWN_LEGACY distinguible de KNOWN y NOT_APPLICABLE. |
| G074 | No backfill desde created_at/updated_at/notas/documentos/auditoría aproximada. |
| G075 | NULL no se convierte en hoy, cero días ni sin atraso. |
| G076 | Conteos e históricos completos antes/después; pérdida cero. |
| G077 | Cotización/Expediente/documentos/seguimientos existentes mantienen relaciones. |
| G078 | Migración aditiva cronológica; históricas intactas. |
| G079 | FKs tenant-aware, índices útiles y constraints de integridad. |
| G080 | Dry-run baseline canónico → latest en PostgreSQL aislado. |
| G081 | Dry-run legacy representativo, idempotencia y comprobaciones post migración. |
| G082 | Permisos existentes verificados por backend, no sólo UI. |
| G083 | Acceso por objeto rechaza otro usuario sin alcance incluso mismo tenant. |
| G084 | Cross-tenant rechaza Prospecto, transición, fuente y conversión por IDs válidos. |
| G085 | Mass assignment de tenant/actor/hitos/procedencia bloqueado. |
| G086 | Errores humanos sin stack trace, secretos ni códigos visibles. |
| G087 | UI muestra estado, fecha real/desconocida, acciones y conversión. |
| G088 | UI nuevo/legacy/sin notaría/sin documentos/sin fuente distinguibles. |
| G089 | Loading/error/retry de carga, envío y conversión utilizables. |
| G090 | Responsive 1536, 1366, 1024, 768, 390 y 320 sin overflow global. |
| G091 | Teclado Tab/Shift+Tab/Enter/Space/Escape donde aplique; foco visible. |
| G092 | Labels/aria/error asociados y targets táctiles accesibles. |
| G093 | Sin G0-B, G0-C, G1, SLA hardcoded ni Cumplimiento v0.5. |
| G094 | Sin regresión contractual en CFG-001/002, EXP-001…009, PRD-001 e ISR-001. |
| G095 | Focused/full suites, builds/typecheck/Prisma y diff/secret scan ejecutados. |
| G096 | Sin staging/commit/push/deploy/escritura productiva; evidencias iniciales preservadas. |

## Validación y rollback

Resultado final: G001–G096 verificados; contrato G0-A **96/96 PASS**.

Evidencia ejecutada:

- 66/66 pruebas backend focales, incluidas 41/41 sobre PostgreSQL 16 aislado.
- 49/49 pruebas frontend focales de Prospectos, workflow y Cotizaciones.
- 1114/1114 pruebas backend y 276/276 pruebas frontend.
- Builds backend/frontend, typecheck, `prisma validate`, `prisma generate`, dry-run y controles de diff/secretos en PASS.
- Recorrido real local: alta mínima, transiciones explícitas, preparación sin envío, envío externo, espera, recepción, sustitución versionada y conversión única.
- Responsive validado en 1536, 1366, 1024, 768, 390 y 320 sin overflow horizontal global.

El dry-run usa exclusivamente PostgreSQL local `pravia_g0a` con dataset legacy sintético y 30 migraciones canónicas desde baseline.
Rollback operativo: no desplegar código antiguo sobre hechos nuevos sin conservar sus tablas.
No se autoriza ejecutar DROP productivo; la migración aditiva permite mantener datos nuevos en reserva.
