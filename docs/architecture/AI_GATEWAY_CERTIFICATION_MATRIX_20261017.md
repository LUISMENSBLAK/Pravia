# AI Gateway — matriz de certificación local

Fecha: 2026-10-17
Base: `b24534ec1ec1505944c7b720e0cf03647e28c005`
Alcance: repositorio y PostgreSQL local aislado; sin proveedor real, producción, commit, push ni deploy.

Esta matriz separa el cumplimiento verificable local de la activación comercial. `PASS LOCAL` significa que el contrato fue probado con adaptadores sintéticos y, cuando corresponde, con PostgreSQL físico. No significa que existan catálogos productivos de modelos, costos, FX, precios o routing.

| ID | Contrato | Evidencia ejecutable | Resultado |
|---|---|---|---|
| AIG01 | Inventario completo de llamadas externas | `AI_PROVIDER_CALL_INVENTORY.md`: 11 operaciones activas | PASS LOCAL |
| AIG02 | Cero proveedor/credencial en frontend | `aiProviderBoundary.test.ts` y búsqueda estática | PASS LOCAL |
| AIG03 | Cero bypass backend | `aiProviderBoundary.test.ts`; red sólo en `openaiResponsesGateway.adapter.ts` | PASS LOCAL |
| AIG04 | Chat y transcripción usan gateway | `assistantChat.service.test.ts`, `assistantTranscription.service.test.ts` | PASS LOCAL |
| AIG05 | Extracción documental usa gateway | tests de `openaiDocument.service` y el inventario de call sites | PASS LOCAL |
| AIG06 | Resumen generativo usa gateway | síntesis opcional en `assistantChat.service.test.ts` | PASS LOCAL |
| AIG07 | Clasificación con proveedor usa gateway | `DOCUMENT_STRUCTURED_EXTRACTION` en inventario y tests documentales | PASS LOCAL |
| AIG08 | IA en procesos de fondo conserva clasificación económica | contexto económico obligatorio en servicios de extracción/revisión | PASS LOCAL |
| AIG09 | Mi Día no cobra reglas determinísticas; su chat generativo usa `ASSISTANT_CHAT` | tests de asistente con contexto de módulo; política aprobada | PASS LOCAL |
| AIG10 | `CUSTOMER_WALLET` debita el cargo liquidado | `controlPlaneAccounting.postgresql.integration.test.ts` | PASS LOCAL |
| AIG11 | Reserva antes de invocar proveedor | integración PostgreSQL física | PASS LOCAL |
| AIG12 | Concurrencia no permite saldo negativo | integración PostgreSQL física | PASS LOCAL |
| AIG13 | Saldo insuficiente impide llamar al proveedor | integración PostgreSQL física | PASS LOCAL |
| AIG14 | Falla de proveedor libera reserva y no debita | integración PostgreSQL física | PASS LOCAL |
| AIG15 | Retry/idempotencia no duplica uso ni cargo | integración PostgreSQL física y tests del adaptador | PASS LOCAL |
| AIG16 | Tenant isolation en wallet, eventos y jobs | integración PostgreSQL física con negativos cross-tenant | PASS LOCAL |
| AIG17 | Capability/RBAC se exige antes de proveedor | `aiGateway.routing.test.ts` | PASS LOCAL |
| AIG18 | Costo proveedor y unidades quedan registrados | integración PostgreSQL física y tests del adaptador | PASS LOCAL |
| AIG19 | Cargo comercial proviene de pricing versionado | integración PostgreSQL física; piso 2× y override auditado | PASS LOCAL |
| AIG20 | `MIGRATION_INCLUDED` exige job/cost center y no toca wallet | integración PostgreSQL física | PASS LOCAL |
| AIG21 | `PLATFORM_INCLUDED` exige administrador de plataforma y conserva COGS | integración PostgreSQL física y routing unitario | PASS LOCAL |
| AIG22 | Ruta `ECONOMY` usa candidato versionado | `aiGateway.routing.test.ts` | PASS LOCAL |
| AIG23 | Ruta `STANDARD` usa candidato versionado | `aiGateway.routing.test.ts` | PASS LOCAL |
| AIG24 | Ruta `PREMIUM` usa candidato versionado | `aiGateway.routing.test.ts` | PASS LOCAL |
| AIG25 | Proveedor/ruta deshabilitados fallan cerrado | `aiGateway.routing.test.ts` | PASS LOCAL |

## Resultado

- Contratos localmente aplicables: **25/25 PASS LOCAL**.
- Operaciones externas inventariadas: **11**.
- Operaciones externas detrás del gateway económico: **11**.
- Bypass backend: **0**.
- Bypass frontend: **0**.
- Tarifas monetarias inventadas/hardcodeadas: **0**.
- `PLAN_INCLUDED`: preparado pero inactivo sin entitlement explícito.
- Catálogos productivos de provider/model/costo/FX/pricing/routing: **CONFIGURATION PENDING**.
- E2E contra proveedor real con facturación real: **NOT EXECUTED**.
- Certificación de producción: **BLOCKED** hasta configurar esos catálogos y repetir el gate en un entorno autorizado.

## Evidencia de regresión

- Backend completo: 198 archivos / 2,251 tests PASS (2026-10-18).
- Frontend completo: 56 archivos / 477 tests PASS (2026-10-18).
- PostgreSQL físico del control plane: 29/29 PASS (2026-10-18).
- Prisma validate/generate: PASS.
- Backend build/typecheck: PASS.
- Frontend build/typecheck: PASS.
- `git diff --check`: PASS.

Los totales deben revalidarse si cambia código después de esta matriz.
