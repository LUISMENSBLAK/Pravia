# Workers staging validation

Resultado: **PASS** en S2 local.

El E2E ejercitó reclamación atómica, lock, recuperación de lock obsoleto, éxito, fallo, backoff exponencial, límite terminal de cinco intentos e idempotencia por `(event_id, handler_name)`. Un evento sin handler quedó `FALLIDO` con `NO_HANDLER_REGISTERED:*` y nunca `PROCESADO`.

Consumidores fixture validaron exactamente un efecto para notificación, recordatorio y job IA/documento, sin llamar proveedor pagado. Storage compensation reclamó un job real, verificó ownership/prefijo, eliminó el archivo local, marcó carga y job como completados. Las pruebas unitarias cubren adicionalmente reintento, fallo terminal, referencia activa insegura, pérdida de claim, stale reclaim y apagado/health.

El filesystem local valida lifecycle, no Supabase Storage externo. Riesgo mantenido: `EXTERNAL_PROVIDER_VALIDATION_PENDING`.
