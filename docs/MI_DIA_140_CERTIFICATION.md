# Mi Día — certificación MD01–MD140

Fuente: matriz MD01–MD140 del prompt de cierre previo del usuario. Ledger de ejecución; un test existente no equivale a PASS hasta vincular evidencia reproducible del caso exacto.

Estado actual: **135 PASS + 5 N/A legítimos = 140/140 contabilizados; 0 FAIL; 0 pendientes**. Flujos integrados: **18/20 PASS + 2 clasificaciones justificadas sin simulación = 20/20 contabilizados; 0 FAIL; 0 pendientes**. X11 queda `NOT VERIFIED / N/A — NO APPROVED LEGAL DEFINITION ACTIVE IN QA`; X13 queda `NOT VERIFIED — PAC SANDBOX CREDENTIALS NOT AVAILABLE`. Evidencia adicional: gate final de navegador **27/27 Chrome local PASS**, incluidos cinco usuarios/RBAC, fuentes, 390/320, MD124 y X08; 92/92 unitarios focales y **11/11 pruebas PostgreSQL físicas con rollback**. Las regresiones globales del mismo estado quedan en backend 2221/2221 y frontend 471/471, con Prisma, builds y typecheck PASS.

| Caso | Escenario contractual | Resultado | Evidencia / razón N/A |
|---|---|---|---|
| MD01 | open Configurar notaría. | PASS | Chrome local `mi-dia-tenant-local.spec.ts`: Dirección abre el panel real y sus controles; recorrido 2/2 PASS. |
| MD02 | enable card. | PASS | Chrome local `mi-dia-certification-controls-local.spec.ts`: Dirección habilita Recordatorios, PUT 200, catálogo persistido; configuración QA restaurada. |
| MD03 | disable card. | PASS | Mismo Chrome: deshabilita, PUT 200, tarjeta desaparece de habilitadas; luego la rehabilita y restaura. |
| MD04 | initial board toggle. | PASS | Chrome marca tarjeta en tablero inicial, persiste defaultLayout y aparece tras reload. |
| MD05 | recommended toggle. | PASS | Chrome marca Recomendada, API confirma clave persistida; luego restaura. |
| MD06 | fixed toggle. | PASS | Chrome fija tarjeta, API `fixed=true` y tablero la muestra tras reload; restauración QA. |
| MD07 | change size. | PASS | Chrome cambia tamaño a opción permitida y API confirma valor tras guardar/reload. |
| MD08 | move order up/down. | PASS | Chrome mueve la tarjeta una posición arriba y API confirma índice; control bajar existe y servicio de orden conserva secuencia. |
| MD09 | save. | PASS | Chrome local: «Guardar configuración» persiste por API y las tarjetas habilitadas permanecen visibles. |
| MD10 | reload persists. | PASS | Chrome local: tras guardar configuración de notaría y recargar, «Citas próximas» y «Firmas de hoy» permanecen en el tablero. |
| MD11 | restore. | PASS | Chrome local usa «Restablecer», DELETE `/api/mi-dia/layout` 200, vuelve a los 8 IDs del tablero de notaría y persiste tras reload. |
| MD12 | tenant isolation. | PASS | Chrome/API local `mi-dia-cross-tenant-local.spec.ts` 1/1: dos notarías QA existentes mantienen layouts/tenantVersion independientes, registros propios separados y `setCardPermission` ajeno 404; PostgreSQL físico `miDiaScope` complementa. |
| MD13 | open Personalizar. | PASS | Chrome local: se abre el panel real «Personalizar Mi Día» y se usan sus controles para la tarjeta de Expedientes. |
| MD14 | live preview. | PASS | Chrome local: añadir Recordatorios muestra la tarjeta inmediatamente, antes de navegar, con PUT canónico 200. |
| MD15 | add card. | PASS | Chrome local añade tarjeta desde catálogo, API layout la persiste y recarga la conserva. |
| MD16 | remove card. | PASS | Chrome local usa «Quitar», PUT 200, encabezado desaparece y API ya no devuelve la clave. |
| MD17 | cannot remove fixed. | PASS | Chrome oculta «Quitar» para tarjeta fija; PUT directo que intenta excluirla devuelve 409 `MIDIA_FIXED_CARD_REQUIRED`. |
| MD18 | drag reorder. | PASS | Chrome local `mi-dia-certification-controls-local.spec.ts`: arrastre nativo entre tarjetas visibles, autosave PUT 200 y orden persistido en API; 1/1 PASS. |
| MD19 | accessible reorder. | PASS | Chrome local usa flechas «Mover arriba/abajo», API confirma índices −1 y regreso al índice anterior. |
| MD20 | resize. | PASS | Chrome local cambia tamaño permitido, autosave PUT 200 y API conserva el tamaño. |
| MD21 | parameter change. | PASS | Chrome local: el parámetro «Cantidad de Expedientes» cambia a 5, la API devuelve 200 y la tarjeta reduce la lista a cinco sin alterar el conteo inicial; se restaura el valor anterior. |
| MD22 | scope reduction. | PASS | Chrome local cambia Expedientes de ORGANIZATION a OWN, API layout confirma reducción tras reload y restaura ORGANIZATION; unitario de servidor niega ampliación superior al máximo. |
| MD23 | autosave. | PASS | Chrome local: cambiar el parámetro del layout dispara PUT `/api/mi-dia/layout` 200 sin botón adicional de guardado. |
| MD24 | reload persistence. | PASS | Chrome local: el parámetro de cinco elementos y las tarjetas añadidas permanecen tras recargar; se restaura el parámetro previo al concluir. |
| MD25 | reset current tenant default. | PASS | Chrome local restablece tablero personal; API `personalized=false` y claves coinciden exactamente con defaultLayout de notaría. |
| MD26 | NONE hides. | PASS | Chrome/API local `mi-dia-certification-revocation-local.spec.ts`: permiso de tarjeta `enabled=false` elimina CASES de catálogo/layout efectivo y respuesta de la tarjeta; sin scope implícito. |
| MD27 | OWN. | PASS | Chrome local selecciona y persiste OWN en Expedientes; backend unitario y PostgreSQL físico filtran por usuario efectivo/objeto. |
| MD28 | TEAM where supported. | N/A | No existe pertenencia de equipo canónica; configuración rechaza TEAM y no lo interpreta como toda la notaría (`miDiaConfiguration.service.test.ts`). |
| MD29 | ORGANIZATION. | PASS | Chrome local restaura y persiste ORGANIZATION para Dirección; backend/PG mantienen tenant como límite superior. |
| MD30 | Organization→Own live. | PASS | Chrome local cambia alcance en el editor y el autosave actualiza el tablero antes de recargar; API/reload confirman OWN sin ampliar otros permisos. |
| MD31 | access revoked live. | PASS | Chrome local: Dirección revoca CASES mientras Mi Día está abierto; reconsulta por foco sin recargar elimina la tarjeta. |
| MD32 | no stale data. | PASS | Chrome/API: después de revocar CASES, `operacion.recientes=[]`, tarjeta ausente incluso tras reload; PUT directo del layout obsoleto devuelve 403 `MIDIA_CARD_DENIED`. Defecto reproducido y corregido en controlador/hook. |
| MD33 | Mis Pendientes. | PASS | `mi-dia-process-cards-local.spec.ts` (Seguimiento): API=UI, enlace al proceso exacto, acción «Realizar» autorizada, respuesta 200, estado «Realizado» persistido tras reload y conteo `MY_PENDING` −1; Chrome local 1/1 PASS. Unitario y PostgreSQL físico previos cubren alcance/tenant y conteo independiente del límite. |
| MD34 | Procesos vencidos. | PASS | `miDiaProcessCards.postgresql.integration.test.ts` crea proceso vencido físico con rollback y valida alcance/tenant; `mi-dia-process-cards-local.spec.ts` concilia API/UI, lista/enlace, reload y 390/320. PostgreSQL 1/1, Chrome 1/1 PASS. |
| MD35 | Vencen hoy. | PASS | Mismo PostgreSQL físico cubre vencimiento hoy OWN/ORGANIZATION y excluye otro tenant; Chrome local compara conteo/filas de API con tarjeta y enlace exacto. |
| MD36 | Próximos vencimientos. | PASS | Unitario de ventana/fechas y PostgreSQL físico de EXP-005; Chrome local verifica API=UI, enlaces, reload y ausencia de overflow 390/320. |
| MD37 | Tareas urgentes. | PASS | Chrome local crea tarea de sistema real, verifica KPI API=UI, enlace a Seguimiento, sólo lectura, reload y cancelación; 24/24 suite. |
| MD38 | Expedientes. | PASS | Chrome local verifica lista real de expedientes recientes, límite 5 sin truncar universo y navegación; unitarios de scope y PostgreSQL tenant. |
| MD39 | Sin movimiento. | PASS | Chrome local concilia API/UI, vacío veraz o filas y enlace `#actividad`; unitario usa timeline de Actividad y PostgreSQL cubre positivos/tenant. |
| MD40 | Con retraso. | PASS | Chrome local API=UI/filas/enlace/reload; fuente EXP-005 con vencimientos reales, unitario y PostgreSQL físico. |
| MD41 | Bloqueados. | PASS | Chrome local API=UI/filas/enlace/reload; unitario exige bloqueo canónico y aislamiento OWN/tenant. |
| MD42 | Listos firma. | PASS | Chrome local API=UI para preflight H6, filas/enlace/reload y 390/320; PostgreSQL prueba listo/no listo. |
| MD43 | No listos firma. | PASS | Mismo test H6: ausencia de falso cero ante preflight y pendientes reales, API=UI/tenant/reload. |
| MD44 | Postfirma. | PASS | Chrome local API=UI/enlace/reload; PostgreSQL y unitario exigen proceso Postfirma pendiente tras firma efectiva. |
| MD45 | Catastro. | PASS | Chrome local API=UI y enlace al proceso; PostgreSQL/valor canónico `SOLVENCIA_*`, sin clasificar por nombre. |
| MD46 | RPP. | PASS | Chrome local API=UI/enlace; PostgreSQL/valor canónico `RPP_*`, tenant y alcance. |
| MD47 | Testimonios. | PASS | Chrome local API=UI/enlace; PostgreSQL exige `ARMADO_TESTIMONIO` operativo y excluye entregados/cancelados. |
| MD48 | Entregas. | PASS | Chrome local API=UI/enlace/reload; PostgreSQL exige LISTO_ENTREGA sin fecha de entrega. |
| MD49 | Prospectos activos. | PASS | `mi-dia-process-cards-local.spec.ts` (caso comercial): creación real local incrementa el conteo API, muestra el nuevo folio en la tarjeta y enlaza al Prospecto exacto; Chrome 1/1 PASS. |
| MD50 | Prospectos nuevos. | PASS | Mismo recorrido Chrome: creación dentro del periodo incrementa `PROSPECTS_NEW`, aparece en UI y enlaza al Prospecto exacto. |
| MD51 | Prospectos sin seguimiento. | PASS | Chrome local compara tarjeta/filas/importes con API, reload y enlace; PostgreSQL físico prueba predicado vigente/OWN/tenant y rollback. |
| MD52 | Listos cotizar. | PASS | Mismo recorrido Chrome: integración → listo con responsable; `PROSPECTS_READY` API +1, tarjeta visible tras navegación/reconsulta y enlace al Prospecto exacto. |
| MD53 | Cotizaciones activas. | PASS | Chrome local concilia tarjeta/API y enlace a Cotización; PostgreSQL físico de condiciones comerciales/tenant/periodo. |
| MD54 | Por enviar. | PASS | `mi-dia-process-cards-local.spec.ts` caso comercial: presupuesto estructurado en cotización elaborada incrementa la tarjeta API/UI; envío sintético local confirmado la retira. Unitario 7/7, PostgreSQL 1/1, Chrome 1/1 PASS. |
| MD55 | Sin respuesta. | PASS | Chrome local API=UI/filas/enlace; PostgreSQL físico exige envío real y ausencia de respuesta vigente. |
| MD56 | Seguimiento. | PASS | Chrome local API=UI/filas/enlace; PostgreSQL físico usa transición comercial persistida, no estado externo legacy. |
| MD57 | Aceptadas. | PASS | Mismo recorrido Chrome: seguimiento → aceptación con solicitante formal; `QUOTES_ACCEPTED` +1, tarjeta y enlace exactos. |
| MD58 | Conversión cotizaciones. | PASS | Mismo recorrido: envío y aceptación del mismo objeto aumentan numerador y cohorte en la API, con enlace a la Cotización exacta. |
| MD59 | Conversión EXP. | PASS | Mismo recorrido: conversión real a Expediente aumenta numerador y cohorte, Mi Día enlaza al nuevo Expediente y la Cotización conserva el vínculo tras navegación. |
| MD60 | Agenda día. | PASS | Chrome local crea cita QA, comprueba delta KPI y fila/enlace exactos, reload, 390/320 y cancelación; API 201/200. |
| MD61 | citas próximas. | PASS | `mi-dia-tenant-local.spec.ts`: cita sintética privada creada en Agenda incrementa KPI y aparece en «Citas próximas»; enlace exacto, reload y cancelación la retiran. Chrome local 2/2 PASS. |
| MD62 | firmas hoy. | PASS | Mismo test: firma sintética vinculada a expediente incrementa KPI y tarjeta, abre el evento exacto, persiste tras reload y desaparece al cancelarla. |
| MD63 | firmas próximas. | PASS | Chrome local cambia fecha estimada de firma de un expediente QA, KPI +1, enlace exacto, reload y restauración; 390/320. |
| MD64 | firmados hoy. | PASS | Chrome local API=UI/filas/enlace; PostgreSQL físico prueba fecha real de firma y límites de día local, tenant/OWN. |
| MD65 | firmados periodo. | PASS | Chrome local itera HOY/SEMANA/MES/TRIMESTRE/AÑO, persiste parámetro y concilia API/UI; PostgreSQL físico de fronteras locales. |
| MD66 | recordatorios. | PASS | Chrome local concilia recordatorios comerciales API/UI, conteo total separado de filas y ruta exacta; unitarios de fuentes. |
| MD67 | private negative. | PASS | `agenda-visibility-local.spec.ts`: cita PRIVATE de Adrián no aparece en lista Agenda ni en Mi Día de María; GET directo 404, incluso tras reload. Chrome local 1/1 PASS. |
| MD68 | organization visibility. | PASS | Misma cita pasa a ORGANIZATION y María la ve en Agenda por API/UI y tras reload; al volver a PRIVATE desaparece inmediatamente. Su Mi Día sigue OWN por RBAC y no filtra el evento ajeno. |
| MD69 | manual today. | PASS | `mi-dia-tenant-local.spec.ts`: Adrián crea una tarea manual desde «Agenda personal» para la fecha seleccionada, POST 200, UI visible y persistencia tras reload. Chrome local 1/1 PASS. |
| MD70 | tomorrow. | PASS | Chrome local crea tarea QA en Día siguiente y la recupera en esa fecha tras navegar. |
| MD71 | specific date. | PASS | Chrome local introduce la fecha futura explícita en «Fecha de la libreta» y muestra la tarea persistida correspondiente. |
| MD72 | future hidden Today. | PASS | Chrome local comprueba que la tarea futura desaparece al volver a Hoy, incluso tras reload. |
| MD73 | Upcoming. | PASS | Chrome local verifica la misma tarea en Próximas y su salida tras completarla. |
| MD74 | completion timestamp. | PASS | Chrome local verifica «Realizada:» e historial tras reload; PostgreSQL físico conserva `completed_at`. |
| MD75 | business-day carryover. | PASS | Chrome local `mi-dia-certification-controls-local.spec.ts` 1/1: pendiente del día anterior avanza a día hábil actual; PostgreSQL físico `miDiaNotebook.postgresql.integration.test.ts` 1/1: viernes 09→lunes 12, historial y AuditLog, rollback. |
| MD76 | original date preserved. | PASS | Chrome API/UI/reload comprueban `original_on` inmutable y leyenda «Programada originalmente»; PostgreSQL físico confirma viernes original tras arrastre al lunes. |
| MD77 | previous day. | PASS | Chrome local usa control «Día anterior», fecha seleccionada y tarea visibles desde historial canónico sin duplicación. |
| MD78 | next day. | PASS | Chrome local usa «Día siguiente» y recupera el pendiente arrastrado en la fecha actual; API y reload conservan la misma tarea. |
| MD79 | history. | PASS | Mismo recorrido Chrome: completar la tarea la retira de Día y la muestra en Historial; PostgreSQL físico 1/1 verifica `completed_at`, arrastre/auditoría y aislamiento con rollback. |
| MD80 | system-origin distinction. | PASS | Chrome local verifica tarea SYSTEM de sólo lectura, sin checkbox manual; unitario excluye copia a la libreta personal. |
| MD81 | source action. | PASS | Chrome local abre el expediente y proceso exactos desde tarea SYSTEM; cancelación en fuente la retira de Mi Día. |
| MD82 | missing documents. | PASS | Chrome local API=UI/enlace `#documentos`/reload; PostgreSQL prueba requisito vigente sin documento y aislamiento. |
| MD83 | review docs. | PASS | Chrome local API=UI/enlace; PostgreSQL exige documento vigente EN_REVISION ligado al expediente. |
| MD84 | expired docs. | PASS | Chrome local API=UI/enlace; PostgreSQL exige vigencia real vencida y vínculo activo. |
| MD85 | formats generate. | PASS | Chrome local API=UI/reload/enlace `#plantillas`; PostgreSQL/CFG-002 verifica artefacto pendiente vigente. |
| MD86 | formats signature. | PASS | Chrome local API=UI/reload/390/320; unitario cuenta formato generado sin firma real, no requisito histórico. |
| MD87 | inconsistencies. | PASS | Chrome local API=UI/enlace; unitario exige observación persistida del reporte/proyecto vigente. |
| MD88 | PLD incomplete. | PASS | Chrome local API=UI/enlace/reload; unitario usa estado H8 persistido y PostgreSQL prueba tenant/alcance. |
| MD89 | notices pending. | PASS | Chrome local API=UI/enlace; unitario/PG consumen obligación AVI CURRENT no cumplida de revisión vigente. |
| MD90 | notices expiring. | PASS | Chrome local API=UI/enlace; unitario/PG usan due_at canónico y ventana local de 3/7/15 días. |
| MD91 | notices expired. | PASS | Chrome local API=UI/enlace; unitario/PG excluyen cumplidos y revisiones obsoletas. |
| MD92 | collected income. | PASS | `miDiaFinanceCards.postgresql.integration.test.ts` valida ingresos reales, monto/tenant/alcance y rollback 2/2; Chrome `mi-dia-process-cards-local.spec.ts` concilia tarjeta/API con resumen Finanzas y filtra al movimiento exacto. |
| MD93 | scheduled collection. | PASS | Chrome local concilia tarjeta/API con Finanzas; PostgreSQL físico resta sólo cobros aplicados, OWN/tenant/rollback. |
| MD94 | honorarios scheduled signature. | PASS | PostgreSQL físico: firma programada del expediente produce 1/$1,000, enlace `#finanzas`, otro tenant aislado; Chrome compara tarjeta/API y enlace, 390/320. |
| MD95 | honorarios signed. | PASS | PostgreSQL físico: sólo firma real cuenta 1/$2,000 en periodo y OWN del otro responsable da cero real; Chrome compara tarjeta/API. |
| MD96 | receivable. | PASS | Chrome local concilia «Por cobrar» con resumen financiero canónico y enlace a cartera; PostgreSQL/OWN/tenant. |
| MD97 | collected today. | PASS | PostgreSQL físico: tres cobros/$600 con `limit=1`, conteo completo separado de filas, OWN y otro tenant; Chrome compara `COLLECTED_TODAY` API/UI. |
| MD98 | quotes active $. | PASS | Chrome local compara importe/filas/enlace de Cotizaciones activas con API; unitario reutiliza total_cliente y PostgreSQL tenant/alcance. |
| MD99 | quotes accepted $. | PASS | Mismo recorrido Chrome para aceptadas; unitario diferencia importe ausente de cero, periodo y fuente Cotizaciones. |
| MD100 | advances pending. | N/A | EXP-008 no persiste anticipo requerido explícito; lector/API/UI devuelven «Sin información» sin cero falso. Backend, frontend y Chrome local focal PASS. |
| MD101 | non-owned resources. | PASS | PostgreSQL físico: recursos de terceros 2/$400, límites/OWN/tenant; Chrome compara API/UI y enlaces a expediente. |
| MD102 | payments to make. | PASS | PostgreSQL físico: solicitudes pendientes 2/$800, OWN 1/$500, href a solicitud exacta; Chrome abre `payment_request_id` y enfoca el origen. |
| MD103 | payments evidence pending. | PASS | PostgreSQL físico diferencia pago sin comprobante (1/$700) de pago con comprobante; Chrome compara tarjeta/API. |
| MD104 | invoices pending. | PASS | PostgreSQL físico: saldo facturable 2/$500, OWN 1/$200, conciliación con lector de facturas y tenant ajeno; Chrome compara tarjeta/API. |
| MD105 | CFDI pending stamping/state truthful. | PASS | PostgreSQL físico: prefactura 1/$100 y leyenda «PAC no certificado», OWN/otro tenant; Chrome exige aviso de timbrado deshabilitado y valores API/UI sin CFDI falso. |
| MD106 | REP pending. | PASS | PostgreSQL físico: REP 2/$200, OWN 1/$80, enlace a CFDI exacto y aislamiento; Chrome compara tarjeta/API. |
| MD107 | my active EXP. | PASS | Chrome local API=UI/enlaces/reload/390/320; unitario/PG restringen al abogado responsable efectivo. |
| MD108 | signed EXP. | PASS | Chrome local API=UI/enlaces y periodo; PostgreSQL físico usa firma real, no programada, OWN/tenant. |
| MD109 | production value. | PASS | Honorarios de presupuestos de expedientes con firma real, responsable OWN, MES/AÑO, suma y detalle exactos; unitario, PostgreSQL 2/2 y Chrome local focal PASS. |
| MD110 | time to signature. | PASS | Chrome local muestra media real apertura→firma, API=UI; unitario excluye cronología imposible, PG positivo/OWN/tenant. |
| MD111 | process average. | PASS | Chrome local API=UI/periodo/unidad y enlace a proceso; unitario usa hechos completados y calendario canónico, PG rollback. |
| MD112 | workload. | PASS | Chrome local separa casos y procesos reales por usuario, API=UI; unitario/PG alcance organización y permisos. |
| MD113 | next escritura. | PASS | Chrome local compara Archivo.overview=Mi Día, reload/enlace/390/320; PG confirma misma secuencia y tenant. |
| MD114 | next folio. | PASS | Misma prueba Archivo=Mi Día, sin secuencia paralela ni valor inventado; PG tenant/rollback. |
| MD115 | current libro/tomo. | N/A | Archivo sólo conserva libro/tomo histórico y declara `libro_tomo_configured=false`; UI/API muestran «Sin información». Unitario y Chrome local focal PASS. |
| MD116 | remaining folios. | N/A | Archivo no tiene capacidad/rango final canónico; siguiente folio no equivale a restantes. UI/API muestran «Sin información». Unitario y Chrome local focal PASS. |
| MD117 | escrituras today. | PASS | Chrome local API=UI/enlace `#archivo`/reload; unitario/PG usan asignación Archivo del día local y tenant. |
| MD118 | appendix pending. | N/A | Archivo acredita presencia de apéndice, pero no tiene regla/flag de exigibilidad por instrumento. UI/API muestran «Sin información». Unitario y Chrome local focal PASS. |
| MD119 | Assistant. | PASS | Chrome local `mi-dia-assistant-card-local.spec.ts` 1/1: Dirección y abogada añaden la tarjeta real, abren chat contextual con prefill, persiste tras reload; acción financiera sólo habilitada con permiso financiero. No se atribuye una respuesta de modelo a esta prueba de tarjeta. |
| MD120 | What can advance. | PASS | Chrome local API=UI/acciones navegables de tareas EXP-005; unitario/PG requieren proceso editable sin bloqueo y permisos. |
| MD121 | Need attention. | PASS | Chrome local muestra sólo señales de tarjetas propias visibles; unitario excluye fuentes sin permiso y fallos se declaran. |
| MD122 | critical alerts. | PASS | Chrome local API=UI/enlace; PG prueba alerta CRITICA/ABIERTA de revisión H8 vigente con tenant/OWN. |
| MD123 | Daily summary. | PASS | Chrome local sólo compone tarjetas OWN visibles, reload/390/320; unitario de visibilidad y permisos. |
| MD124 | metric exact drilldown. | PASS | Endpoint canónico paginado `/api/mi-dia/cards/:key/detail`, con alcance/periodo/ventana tomados exclusivamente de la configuración persistida. PostgreSQL físico `miDiaCardDetail.postgresql.integration.test.ts` valida paginación, céntimos, OWN, otro tenant, permisos y rollback. Chrome real `mi-dia-md124-x08-local.spec.ts` recorre todas las páginas, exige IDs únicos y `COUNT(detalle)=KPI`/`SUM(detalle)=KPI`, conserva página tras reload y valida 390/320; 2/2 PASS junto con X08. |
| MD125 | financial exact reconciliation. | PASS | PostgreSQL físico `miDiaFinanceCards.postgresql.integration.test.ts` 2/2: 12 KPIs financieros con `limit=1` frente al detalle completo, `count=filas` y suma decimal exacta; Cobrado hoy se concilia además por IDs e importe con `movimiento_financiero` aplicado del tenant. Chrome local `mi-dia-process-cards-local.spec.ts` focal 1/1: Ingreso cobrado = resumen canónico de Finanzas, tarjeta/API y enlace al movimiento preciso. |
| MD126 | real zero. | PASS | Chrome local `mi-dia-error-states-local.spec.ts`: María, consulta API exitosa `operacion.recientes=[]` sin `errors.recentFiles`, UI «No hay expedientes recientes», reload igual; distinto de error. |
| MD127 | error != zero. | PASS | Chrome local inyecta fallo parcial y HTTP 503 general: widget muestra error, nunca 0 ni importe/lista antiguos; `useMyDay` limpia datos previos ante 503. Unitario de `settleMiDiaSource` conserva `ok:false`. |
| MD128 | no info. | PASS | Cuatro fuentes ausentes exponen `available=false`/valor nulo y explicación, distintas de cero y error; backend/frontend focal, Chrome reload/390/320 PASS. |
| MD129 | one-card 500. | PASS | Unitario `miDiaSourceSettlement.test.ts` 2/2: una fuente rechazada produce `ok:false` mientras la sana devuelve su cuenta/importe intactos; Chrome local inyecta error sólo en Ingreso cobrado y mantiene Expedientes/Por cobrar visibles, sin falso cero. |
| MD130 | one-card slow. | PASS | Unitario con reloj controlado: fuente colgada vence plazo de 15 s en el backend, la otra conserva datos; Chrome local verifica presentación aislada del error. No se afirma que el endpoint responda antes del plazo. |
| MD131 | deleted source record. | PASS | Chrome/API/DB local `mi-dia-source-deletion-local.spec.ts` 1/1: tarea QA creada canónicamente, visible en libreta; borrado físico sólo de ese ID QA en PostgreSQL aislado; API y reload ya no la muestran. |
| MD132 | two-tab autosave. | PASS | Chrome local `mi-dia-certification-concurrency-local.spec.ts` 1/1: dos pestañas cargan versión 0; primera guarda, segunda recibe 409 `MIDIA_LAYOUT_CHANGED` y «No guardado»; reload refleja sólo estado persistido; reintento 200. |
| MD133 | repeated autosave idempotent. | PASS | Mismo caso dispara dos PUT idénticos concurrentes con la misma versión: exactamente 200/409, una sola versión nueva y claves sin duplicar. |
| MD134 | configuration conflict. | PASS | Mismo caso dispara dos PUT tenant con versión simultánea: exactamente 200/409, versión +1, contenido QA restaurado; unitario `miDiaConfiguration.service.test.ts` valida error contractual. |
| MD135 | backend restart. | PASS | Reinicio manual controlado del backend QA en puerto 3003 (sin producción): layout versión 1 con Recordatorios guardado antes; health local API/DB/Storage 200 después; GET config conserva versión 1 y la tarjeta una vez; reset QA 200. La prueba automatizada que suponía auto-respawn se retiró al verificar que el supervisor local no respawnea tras SIGTERM externo. |
| MD136 | browser reload. | PASS | Recarga de las cinco tarjetas finales y de las tarjetas de fuentes en Chrome local, con persistencia de configuración QA y verificación API=UI. |
| MD137 | direct drilldown unauthorized. | PASS | Dos sesiones QA: GET directo a Expediente de otra notaría devuelve 404 según política de ocultación del objeto; no se abre desde tarjeta ni ruta forjada. |
| MD138 | cross-tenant layout. | PASS | Dirección A añade Recordatorios en su layout; GET config B conserva exactamente layout, versión personal y versión tenant; reset A, sin writes B. |
| MD139 | cross-tenant source records. | PASS | Mi Día A no incluye ID de expediente B y viceversa; cada uno sí ve su propio registro; GET directo cruzado denegado; PostgreSQL físico de scope/tenant previo. |
| MD140 | fixed card cannot bypass permission. | PASS | Chrome/API: CASES se fija en tablero de notaría, pero revocación personal la elimina del layout efectivo y deniega reinyectarla por PUT; configuración y grant QA restaurados. |

Criterio: sólo `PASS` con evidencia local reproducible, o `N/A` con una razón exacta ligada a una capacidad canónica inexistente. `FAIL` y omisiones bloquean el release.

## Flujos integrados X01–X20

Los recorridos focales anteriores no sustituyen estas secuencias completas. Cada flujo requiere resultado propio y evidencia del cambio en el módulo fuente y en Mi Día.

| Flujo | Secuencia exigida | Resultado | Evidencia |
|---|---|---|---|
| X01 | Seguimiento pendiente → Mi Día → Realizar → recálculo | PASS | Chrome local `mi-dia-process-cards-local.spec.ts`: tarjeta/API enlazan al proceso exacto; «Realizar» devuelve 200, queda «Realizado» tras reload y `MY_PENDING` disminuye exactamente en uno. Sólo datos QA aislados. |
| X02 | Crear Prospecto → tarjeta activo | PASS | Chrome local, `mi-dia-process-cards-local.spec.ts` caso comercial: creación en UI, delta API +1, tarjeta «Prospectos activos» muestra el folio y `href` exacto. |
| X03 | Prospecto listo para cotizar → tarjeta | PASS | Mismo test: transición real con responsable, delta API +1 y tarjeta «Listos para cotizar» persistida tras reconsulta, con navegación al mismo registro. |
| X04 | Enviar Cotización → actualización «Por enviar» | PASS | Chrome local: presupuesto estructurado genera estado «Por enviar»; registro manual sintético QA del envío retira exactamente esa Cotización de la tarjeta. No hubo envío a cliente real. |
| X05 | Aceptar Cotización → tarjeta aceptadas | PASS | Chrome local: seguimiento y aceptación contractual con solicitante formal; delta API/UI +1 y enlace al objeto exacto. |
| X06 | Convertir Cotización → métrica y Expediente | PASS | Chrome local: conversión contractual crea Expediente real en PostgreSQL QA; numerador/cohorte +1, tarjeta enlaza al nuevo Expediente y origen persiste en Cotización. |
| X07 | Firma futura → próxima firma | PASS | Chrome local `mi-dia-process-cards-local.spec.ts`: PATCH canónico de fecha estimada en expediente QA, API `firmas_proximas` +1, tarjeta/enlace exactos, reload, restauración de fecha y 390/320. |
| X08 | Firma real → firmados hoy/periodo | PASS | Acción humana explícita «Confirmar datos revisados» ejecutada en Chrome sobre expediente sintético PostgreSQL. Antes de validar, programar firma devuelve 400 por datos no validados; después, la transición canónica programa la firma, el diálogo real registra la firma efectiva y congela el apéndice, persiste tras reload y el mismo expediente aparece en `SIGNED_TODAY`. AuditLog exactamente uno; Finanzas denegada 403 y objeto de otro tenant 403/404. `mi-dia-md124-x08-local.spec.ts` X08 1/1 PASS. |
| X09 | Documento faltante → tarjeta | PASS | Chrome local `mi-dia-document-requirement-flow-local.spec.ts` 1/1: requisito obligatorio sintético insertado sólo en PostgreSQL QA aislado, fuente/API +1, tarjeta muestra expediente y documento exactos; enlace y reload correctos. Fixture retirado al finalizar. |
| X10 | Cargar documento requerido → pendiente resuelto | PASS | Mismo recorrido Chrome: desde el enlace de Mi Día, carga mediante la acción explícita del requisito; POST documental 201 con `requisito_id`, vínculo activo confirmado en PostgreSQL, estado «Recibido», fuente/API −1 y tarjeta se actualiza tras reload. No se contó una carga genérica. |
| X11 | Aviso de Cumplimiento → tarjetas correctas | NOT VERIFIED / N/A — NO APPROVED LEGAL DEFINITION ACTIVE IN QA | PostgreSQL QA: 0 definiciones oficiales, 0 revisiones oficiales verificadas, 0 activaciones vigentes, 0 reglas/revisiones legales activas, 0 obligaciones y 0 alertas abiertas. El lector consume sólo estado persistido y devuelve cero seguro; no recalcula ley ni fabrica avisos. Unitarios de tarjetas/motor/H10 y Chrome MD124 de cero seguro PASS. |
| X12 | Ingreso financiero → ingresos cobrados | PASS | Chrome local `mi-dia-finance-income-flow-local.spec.ts` 1/1: reportar comprobante en EXP-008 no altera KPI; validación/aplicación humana crea movimiento canónico, API Finanzas lo confirma, Mi Día sube exactamente 1/$123.45, enlace al movimiento persiste tras reload. QA aislado. |
| X13 | Facturación parcial → saldo restante | NOT VERIFIED — PAC SANDBOX CREDENTIALS NOT AVAILABLE | El proveedor runtime permanece `DisabledCfdiProvider`, sin credenciales PAC. Las pruebas de dominio, servicio y PostgreSQL validan receptor, parcialidad, saldo, no sobrefacturación, concurrencia, idempotencia, acceso de objeto/tenant y carga manual; 53/53 focales X11/X13 PASS. No se presenta prefactura, UUID o XML sintético como timbrado real. |
| X14 | Crear prefactura → tarjeta CFDI | PASS | Chrome local `mi-dia-finance-income-flow-local.spec.ts` 1/1: perfil fiscal confirmado con RFC canónico, prefactura real de $50 guardada, `CFDI_TO_STAMP` +1, saldo `INVOICES_PENDING` −$50, `INCOME_COLLECTED` intacto; reload conserva el borrador. QA aislado, sin timbrado. |
| X15 | Cancelar/eliminar borrador → recálculo | PASS | Mismo recorrido Chrome: DELETE canónico de la prefactura tras reload; `CFDI_TO_STAMP` y saldo facturable regresan exactamente al valor anterior, sin alterar el movimiento de ingreso aplicado. |
| X16 | Asignación Archivo → siguientes números | PASS | Chrome local `mi-dia-archive-assignment-flow-local.spec.ts` 1/1: asignación desde UI de expediente QA sin escritura, POST 201, Archivo incrementa escritura y folio +1, Mi Día coincide con overview canónico y muestra la asignación de hoy; reload conserva valores. |
| X17 | Agenda privada → sólo propietario | PASS | Chrome local `agenda-visibility-local.spec.ts`: Adrián ve su cita privada en Agenda/Mi Día; María no la ve ni puede abrirla por GET; regreso a PRIVATE y reload vuelven a ocultarla. Fixture cancelado al final. |
| X18 | Agenda organización → usuarios autorizados del tenant | PASS | Misma cita pasa a ORGANIZATION; María la ve por API y UI Agenda tras reload. Mi Día de María conserva alcance OWN, sin filtración de cita ajena; vuelta a PRIVATE revoca acceso. |
| X19 | Libreta personal → sólo propietario | PASS | Chrome local `mi-dia-tenant-local.spec.ts`: tarea creada en UI por Adrián persiste tras reload; María no la ve, API propia no incluye el ID y PATCH directo ajeno devuelve 404; Adrián la completa y aparece en Historial. PostgreSQL físico 1/1 confirma tenant/owner/rollback. |
| X20 | Revocar permiso → desaparecen tarjeta y datos | PASS | Chrome real `mi-dia-certification-revocation-local.spec.ts`: tarjeta fija con datos → revocación `enabled=false` → API deja de devolver lista → foco reconsulta y oculta tarjeta sin reload → PUT forjado 403 → reload conserva revocación; cleanup QA. |
