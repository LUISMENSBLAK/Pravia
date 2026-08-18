# Checklist de smoke productivo — PRAVIA OS

Estado inicial: **PREPARED ONLY**. No contiene credenciales ni autoriza ejecución.

## Gate 1 — backend antes del frontend

- [ ] El deploy de Render usa el commit aprobado exacto.
- [ ] `GET /health` devuelve HTTP 200, `api=ok`, `database=ok`, `storage=ok`, `environment=production` y `database_schema=pravia_os`.
- [ ] `GET /api/health` devuelve el mismo estado.
- [ ] El historial Prisma está limpio y contiene las 18 migraciones canónicas esperadas.
- [ ] No hay errores Prisma, DB, Storage ni 5xx sostenidos en logs.
- [ ] Auto-Deploy permanece apagado.

## Gate 2 — autenticación y tenant

Usar una cuenta autorizada existente; no registrar la contraseña.

- [ ] Login correcto y sin fallback.
- [ ] La respuesta de sesión expone la Organization bootstrap activa y su Membership.
- [ ] El rol efectivo coincide con la Membership; `DIRECCION` no se convierte en PlatformAdmin.
- [ ] `/auth/me`, refresh y logout funcionan.
- [ ] Un access token emitido antes del cutover, sin `org`, es rechazado de forma cerrada; el usuario puede iniciar sesión de nuevo.
- [ ] `session.organizationId`, `membershipId`, permisos y scope son coherentes.
- [ ] `GLOBAL` permanece organization-global, no platform-global.
- [ ] No existe selección silenciosa de primera/default Organization.

## Gate 3 — documentos y Storage

- [ ] El conteo y hash de metadata documental coinciden con S0.
- [ ] El inventario de objetos del bucket coincide con las referencias esperadas o toda diferencia está explicada antes de continuar.
- [ ] Un documento legacy controlado abre preview después de auth + tenant + RBAC.
- [ ] Su descarga usa URL firmada temporal y funciona.
- [ ] Una cuenta sin permiso documental no puede obtener preview, descarga ni signed URL.
- [ ] No se movieron blobs legacy durante el cutover.
- [ ] El worker de compensación sigue detenido hasta cerrar la reconciliación DB/Storage.

## Gate 4 — producto completo, preferentemente lectura

| Módulo | Lectura mínima | Escritura mínima si es imprescindible |
|---|---|---|
| Mi Día | KPIs, agenda, pendientes y accesos | Ninguna |
| Prospectos | Tarjetas, lista, filtros, detalle | Fixture reversible documentado |
| Cotizaciones | Lista, métricas y detalle | Ninguna |
| Expedientes | Lista, detalle, etapas y documentos | Ninguna |
| Notarías | Todos, Nayarit/Jalisco, detalle | Ninguna |
| Comparecientes | Lista, ficha, documentos | Ninguna |
| Finanzas | KPIs, movimientos, distribución, cuentas | Ninguna; no crear movimiento smoke |
| Agenda | Semana, filtros y detalle | Evento fixture reversible solo si se autoriza |
| Reportes | Resumen, filtros y export autorizado | Ninguna |
| ISR | Lista/estado y acceso RBAC | Ninguna |
| Riesgos/UIF | Lista, revisión y evidencias según permiso | Ninguna |
| Configuración | Perfil, usuarios y permisos visibles | Ninguna |

- [ ] Responsive básico en desktop y móvil.
- [ ] Favicon, PWA, redirects y headers correctos.
- [ ] No aparecen datos de otra Organization ni identificadores técnicos en errores.

## Gate 5 — PRAVIA IA persistente

Usar una conversación de smoke y un fixture no sensible; no usar documentos legales reales.

- [ ] Abre drawer y crea una conversación persistente.
- [ ] Consulta simple de lectura devuelve datos autorizados y fuentes reales.
- [ ] Follow-up conserva el contexto de la conversación.
- [ ] Una tool de lectura usa ActorContext y RBAC.
- [ ] Una acción sensible queda en PREPARE_ONLY/preview y exige confirmación humana; no se confirma en el smoke salvo autorización separada.
- [ ] AIUsage registra Organization, usuario, conversación, proveedor/modelo y uso disponible.
- [ ] Adjunto temporal no sensible respeta ownership y expiración.
- [ ] Adjunto oficial conserva la separación respecto al temporal.
- [ ] Transcripción corta con audio no sensible funciona si el proveedor está disponible.
- [ ] No hay markdown roto, pipes visibles, stack traces ni datos inventados.

## Gate 6 — conciliación y unfreeze

- [ ] Fingerprint S2/post-smoke comparado con S0.
- [ ] Toda diferencia corresponde exclusivamente a Organization, Memberships, ownership poblado, estructuras nuevas, conversación/AIUsage y auditoría de smoke documentados.
- [ ] Conteos e ID hashes de negocio preexistente coinciden.
- [ ] Conciliación financiera tiene diferencia exacta 0.00 en todas las métricas.
- [ ] Orphan tenant rows = 0.
- [ ] Cross-tenant invalid relationships = 0.
- [ ] Missing FK indexes = 0.
- [ ] Duplicate indexes = 0.
- [ ] Backend PASS, auth PASS, frontend PASS, documentos PASS, finanzas PASS y smoke PASS.
- [ ] Solo entonces reanudar tráfico/escrituras.

## Abort inmediato

Mantener freeze y activar el rollback documentado si falla cualquier gate, si aparece fuga tenant, el backup no es restaurable, cambia una suma financiera, falla auth/documentos, hay migración incompleta o aumentan los 5xx de forma sostenida.
