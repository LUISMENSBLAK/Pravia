# PRAVIA IA — política inicial de clasificación y cobro

Aprobada por el cliente el 2026-10-17. Esta política decide **quién soporta el costo**; no asigna tarifas monetarias por operación ni modelos concretos. Toda llamada externa debe tener `operationCode`, `billingClass` y evidencia de costo/estado.

| Clase | Uso | Wallet del tenant |
|---|---|---|
| `CUSTOMER_WALLET` | Función IA solicitada por el usuario o ejecutada para beneficio operativo directo de su notaría: chat, extracción con proveedor, OCR IA de pago, revisión, resúmenes, generación, Mi Día generativo, etc. | Reserva atómica antes de la llamada y liquidación idempotente después. Saldo cero bloquea sólo esta clase. |
| `MIGRATION_INCLUDED` | IA de un job de migración contratado/autorizado; registra `migration_job_id` y centro de costo. | Sin débito. No cobrar simultáneamente tarifa de migración y saldo IA salvo cambio comercial expreso. |
| `PLATFORM_INCLUDED` | Routing, guardrails, abuso, health y evaluación técnica estrictamente internos. | Sin débito; el costo proveedor sigue en COGS. |
| `PLAN_INCLUDED` | Capacidad futura condicionada a entitlement explícito. | **Inactiva** actualmente; no existe franquicia mensual inferida. |

- La promoción inicial es **$3,000 MXN comerciales** por nueva notaría, una sola acreditación idempotente sin vencimiento temporal actual. No es costo real ni revenue. Después se usan recargas prepago.
- Las operaciones determinísticas/locales sin proveedor IA no descuentan saldo, aunque se invoquen desde el chat.
- Cada ejecución elige provider/model por `operationCode` y routing policy vigente, obtiene costo real del proveedor y FX snapshot, resuelve precio comercial desde catálogo versionado, reserva un máximo configurado, liquida el cargo final y libera el remanente.
- `commercial_price >= real_cost × 2`; excepciones requieren aprobación expresa y auditada de Platform Super Admin. El catálogo puede fijar objetivos 2,5×/3×; no se impone 2,5× universalmente.
- No hay tarifa fija aprobada por resumen/clasificación/análisis, ni límite diario monetario fijo. Los máximos por solicitud/modelo, input/output, concurrencia, timeout, retries, circuit breaker y techo diario opcional son configurables; el techo diario permanece desactivado si no hay cifra aprobada.
- El mismo `idempotencyKey` no reejecuta proveedor ni crea un segundo débito. Una falla de proveedor libera la reserva y deja un evento de costo no verificado si el proveedor no informó el consumo.
- Registrar tenant, usuario cuando aplique, operación, clase, provider/model, unidades, costo y moneda, FX, precio/cargo, débito wallet, job de migración, versión de pricing, latencia, estado/error, traza/idempotencia y fecha. Los costos/markup/COGS son internos, no visibles al cliente.
- Esta aprobación **no certifica por sí sola** el gateway total. Los 11 call sites externos activos ya figuran migrados en [AI_PROVIDER_CALL_INVENTORY.md](./AI_PROVIDER_CALL_INVENTORY.md) y no quedan bypasses de red; la certificación aún exige configurar catálogos reales y ejecutar la matriz E2E completa.
