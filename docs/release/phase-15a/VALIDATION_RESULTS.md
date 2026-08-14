# Resultados de validación — Fase 15A

Fecha: 2026-08-13. Ninguna prueba de este documento apuntó a producción.

## Guardas

- `stagingGuard.test.ts` + guard previo existente: 2 archivos, 7/7 tests verdes.
- Caso real con identidad productiva: rechazado con `REFUSED_PRODUCTION_WRITE` antes de invocar Prisma.
- Project ref de DB y Storage productivos: `mkiwijbampubccrpvgga`, revalidado mediante lecturas.

## Prisma y builds

- `prisma validate`: PASS.
- `prisma generate`: PASS, Prisma Client 5.22.0.
- Backend `tsc`: PASS.
- Frontend `tsc -b && vite build`: PASS, 1,825 módulos.
- Secret scan: PASS, 805 archivos del worktree, 0 hallazgos.
- `git diff --check`: PASS.

## Tests locales

- Backend unit/component: PASS, 45 archivos y 208/208 tests.
- Frontend: PASS, 16 archivos y 123/123 tests con un worker y timeout de 15 s. La corrida paralela estándar fue inestable por lazy-loading/timeouts (41 fallos bajo carga; segunda corrida 8); las 32 pruebas de los tres archivos afectados pasaron aisladas y la suite completa serial pasó. Esta inestabilidad queda como riesgo de CI, no se oculta.
- DB integration read-only contra referencia Docker local: PASS, 8/8.
- Auth E2E, RBAC/IDOR, flujo comercial y E2E crítico sobre staging: BLOCKED porque no existen tablas de aplicación.
- PRAVIA IA sobre staging: BLOCKED por la misma causa. Sus unit tests forman parte de la suite backend verde, pero no sustituyen E2E staging.

## Staging DB

- `migrate deploy`: FAIL esperado/real, `P3018`, SQLSTATE `42704`, falta tipo `DocCategoria`.
- `migrate status` final: exit 1, 22 carpetas detectadas; una migración registrada fallida y 21 todavía no aplicadas.
- Inventario read-only: una fila parcial; 0 tablas de aplicación; transacción del DDL fallido revertida.
- No se usó `migrate resolve`, `db push`, reset ni edición de `_prisma_migrations`.

## Staging Storage

- Guard de pertenencia: PASS para ruta local explícita de staging y separación de producción.
- Upload controlado: PASS.
- Read/content check: PASS.
- Signed URL + firma: PASS.
- Unlink/delete del único objeto sintético: PASS; se verificó su ausencia.
- Compensation worker/retry/ownership DB: BLOCKED porque la tabla de jobs no llegó a crearse. No se ejecutó worker productivo.

## Observabilidad mínima

| Señal | Resultado staging |
|---|---|
| DB health | RED: migración parcial detectada inmediatamente por status/inventario. |
| Storage health | GREEN para proveedor local staging. |
| Auth health | BLOCKED: schema de auth ausente. |
| Worker status | BLOCKED: tablas ausentes. |
| Migration status | RED, exit 1 y logs Prisma preservados. |
| Error logs | Disponibles en `staging-readonly.json`, con migration name, P3018 y SQLSTATE. |
| Correlation IDs | No generados: backend staging no se inició. Los contratos unitarios existentes sí pasaron. |

## Criterio

El build y las suites locales sanas no compensan el fallo de reconstrucción, el staging externo ausente ni los E2E bloqueados. Resultado global: **FASE 15A = NO READY / RED**.
