# Resultados E2E staging

Backend real en `127.0.0.1:3015`, PostgreSQL local reconstruido, JWT aleatorio sólo de la sesión y Storage filesystem temporal.

- Seeds base: PASS; segunda ejecución idempotente. Notarías sintéticas añadidas.
- Auth: PASS, siete checks (login, refresh, rotación, logout, revocación, invitación/activación, recuperación/cambio, recordarme y sesiones).
- RBAC/IDOR: PASS, siete checks; Abogado A/B, Recepción, Gestoría y Consulta; IDs propios, ajenos e inexistentes.
- Flujo crítico: PASS en la corrida estable, 20 pasos desde prospecto hasta entrega, incluido movimiento financiero y Storage privado.
- Compliance staging: BLOCKED; la extensión E2E no completó antes del límite y no creó revisión. Las suites unitarias de dominio/snapshot/decisión sí pasaron.
- Storage: PASS upload/read/signed URL/unlink; health `storage=ok` tras crear el directorio temporal. Proveedor Supabase staging externo no fue probado.
- Worker de compensación: arrancó y health reportó `status=ok`; siete tests unitarios de claim/retry/fail/idempotencia pasaron. Outbox, notificaciones y AI jobs no tuvieron una suite staging integral; IA pagada se omitió explícitamente.
- DB integration: 7/8 PASS; falla por 16 FK sin índice.

El staging demostró operación extensa, pero no satisface todos los criterios GREEN.
