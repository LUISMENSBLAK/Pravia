# COL56 — cobertura física de auditoría

Estado: **PARCIAL**. Entorno: PostgreSQL/Storage QA local y Chrome real; no se ejecutaron escrituras productivas. Una acción sólo figura como `PASS` aquí si el test comprobó HTTP, efecto físico o ausencia de mutación, y fila de AuditLog con la identidad pertinente. Un evento existente en código sin esa comprobación es `PENDIENTE`.

| Módulo | Acción y rol QA | HTTP / DB | AuditLog / sesión / tenant | Resultado |
|---|---|---|---|---|
| Prospectos | Edición/asignación de prospecto sin responsable por Dirección y Alejandro | 200; responsable y cambios persistidos | `PRO001_EDITAR_FICHA`, tenant y objeto comprobados; falta sesión en esta prueba | PARCIAL |
| Prospectos | Creación, reasignación, revocación y transición; roles variados | Mutaciones probadas en COL01, COL13–16, COL35 y COL57 | Matriz física de cada evento/sesión pendiente | PENDIENTE |
| Cotizaciones | Creación, presupuesto, versión, aceptación, asignación, revocación y conversión | Rutas y persistencia probadas en COL02, COL17–19, COL37–43 y COL58 | Matriz física de cada evento/sesión pendiente | PENDIENTE |
| Expedientes | Edición de cabecera por Alejandro | 200; PostgreSQL actualizado | `UPDATE_EXPEDIENTE_HEADER`, actor, tenant, objeto, correlación y sesión en `collaboration-case-local.spec.ts` | PASS |
| Expedientes | Alta/revocación de colaborador por Dirección | 200 y relaciones persistidas/revocadas | `COLLABORATOR_ASSIGNED` / `COLLABORATOR_REVOKED` comprobados; faltan todos los campos y sesión por evento | PARCIAL |
| Expedientes | Creación, cambio de estado, relaciones de maestros, documento y finanzas | Flujos funcionales QA existentes | Reconciliación exhaustiva HTTP/DB/evento pendiente | PENDIENTE |
| Comparecientes | Edición por Javier de ficha de Alejandro | 200; dato maestro persistido | `EDITAR_COMPARECIENTE`, actor, tenant, objeto y sesión en `collaboration-csf-local.spec.ts` | PASS |
| Comparecientes | Extracción CSF local por Alejandro | 200; fuentes/sha persistidos | Dos `EXTRAER_DATOS_COMPARECIENTE_IA` para dos acciones explícitas; mismo idempotency key no duplicó evento. Falta matriz completa de payload/sesión | PARCIAL |
| Comparecientes | Alta, corrección/confirmación de dato y conflicto concurrente | HTTP/DB QA dirigidos; RFC confirmado en COL67 | Fila por cada acción y todos los campos/sesión pendiente | PENDIENTE |
| Predios | Edición por Alejandro de predio de Javier | 200; cambio persistido | `UPDATE_PROPERTY_MASTER` con actor, tenant y objeto; falta sesión en esta prueba | PARCIAL |
| Predios | Alta, vinculación, corrección documental y conflicto concurrente | Flujos funcionales QA existentes | Matriz de cada evento pendiente | PENDIENTE |
| Documentos | Carga, sustitución y lectura privada CSF | 201/200; dos binarios y SHA persistidos | Fila específica por carga/sustitución/descarga pendiente de verificar | PENDIENTE |
| Facturación / Finanzas | Rosa reporta y aplica ingreso | HTTP/DB QA en `collaboration-finance-local.spec.ts` | Actor y tenant comprobados; sesión/resultado por movimiento pendientes | PARCIAL |
| Facturación / Finanzas | Borrador, reserva/liberación, prefactura y regeneración | Flujos FDR puntuales existentes | Matriz física de auditoría todavía pendiente | PENDIENTE |
| Seguridad | Javier intenta autoasignarse a Expediente | 403; ninguna relación creada | `ACTION_DENIED`, actor, tenant, sesión, objeto y código saneado; sin token/cuerpo/query, Chrome/API/PostgreSQL 1/1 | PASS |
| Seguridad | Acceso cross-tenant y API directa sin permiso en demás módulos | Denegación funcional en varios tests COL | Fila de denegación por ruta/rol/tenant aún no cubierta exhaustivamente | PENDIENTE |

Política observada: el middleware de denegaciones registra sólo `403` autenticados de rutas sensibles como `ACTION_DENIED`; no convierte errores de validación `400/422`, fallos `5xx` o lecturas rutinarias en una modificación exitosa. Deduplica ráfagas idénticas durante cinco segundos. El registro se realiza tras responder y, si falla la DB, no convierte la denegación en éxito; la durabilidad absoluta del evento ante caída de DB no está certificada. No se guardan body, query, cookie, token ni documento completo.

Pendiente para PASS: ejecutar la matriz obligatoria completa de acciones y roles, cotejar cada HTTP con mutación real, evento, tenant, actor, sesión y ausencia de secretos; cerrar brechas críticas antes de elevar COL56.
