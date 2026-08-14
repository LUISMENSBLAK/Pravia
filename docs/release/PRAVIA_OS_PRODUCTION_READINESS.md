# PRAVIA OS — Production Readiness

Fecha de corte: 2026-08-14
Decisión: **NOT READY FOR PRODUCTION**

El código de Fase 14 quedó integrado y validado en una copia local real. No se desplegó, no se hizo push y no se aplicó ninguna migración a producción. La decisión permanece en rojo porque el historial remoto de Prisma está divergente, el secreto JWT remoto observado no cumple el mínimo, no hay staging real validado y faltan pruebas operativas sobre infraestructura productiva.

## Actualización Fase 15D

Fase 15C reconcilió el historial y produjo S2 reproducible, pero Fase 15D termina **YELLOW — INFRASTRUCTURE ACTION REQUIRED**: no existe un Supabase PRAVIA staging accesible ni sesiones/servicios staging verificables en Render y Netlify. Las huellas productivas inicial y final siguen siendo S0 exacto en sesiones read-only. No hubo producción write/deploy/migration ni push.

Se reforzó la validación JWT contra placeholders/repetición y el build frontend bloquea localhost/HTTP y cruces de host staging. Las suites quedan backend 211/211 y frontend 127/127; auditorías y secret scan están limpios. Estos resultados no sustituyen Auth, RBAC, E2E, Storage, workers, PWA, backup/restore, performance y accessibility sobre HTTPS staging real.

## Arquitectura final

- **Frontend:** React 18 + TypeScript + Vite, router con módulos lazy, API layer central, Error Boundary, UI responsive y PWA mínima.
- **Backend:** Express + TypeScript, controladores/servicios Prisma, middleware de autenticación, RBAC, object scope y auditoría.
- **Datos:** PostgreSQL/Supabase, esquema canónico `pravia_os`; ledger y snapshots son fuentes de verdad especializadas.
- **Storage:** proveedor cloud Supabase o local aislado según contrato. Documento maestro + vínculos; signed URLs efímeros y autorizados por objeto padre.
- **Auth:** access token solo en memoria; refresh HttpOnly con rotación/revocación. Cookie de sesión 12 h o persistente 7 días si “recordarme”.
- **IA:** drawer global contextual, backend revalida contexto/scope; acciones sensibles conservan preview/confirmación. La prueba de proveedor pagado real queda pendiente.
- **Workers:** Outbox y compensación Storage existentes; activación mediante entorno, claims/retry/backoff. Deben validarse en el servicio real antes de producción.
- **PWA:** manifest, iconos, offline honesto, network-first para navegación, API sin cache y actualización V1→V2 mediante prompt.

## Semáforo

| Área | Estado | Evidencia / razón |
|---|---|---|
| Código, builds y unit tests | VERDE | frontend 123/123; backend 203/203; builds correctos |
| Copia DB aislada | VERDE | PostgreSQL 16, 22 migraciones, integración 8/8, 0 FK sin índice |
| Producción DB/migraciones | ROJO | 7 pendientes y 2 IDs remotos ausentes localmente; no se aplicó nada |
| Auth local integrado | VERDE | 7 bloques E2E: login, refresh, cookies, activation, recovery, suspend/revoke |
| Auth producción | ROJO | secreto JWT observado no alcanza 32 caracteres; secrets finales no verificados |
| RBAC/object scope/IDOR local | VERDE | 7 bloques API directos aprobados |
| Flujo crítico local | VERDE | 20 pasos hasta documentos, finanzas, firma, postfirma y entrega |
| Finanzas | AMARILLO | ledger y dry run verdes; backfill real y conciliación productiva pendientes |
| Compliance | AMARILLO | snapshots/rules versionados en local; migración y prueba staging pendientes |
| Storage | AMARILLO | guard de project ref y health remoto de solo lectura; worker/restore cloud no probado |
| PWA | VERDE | prueba V1→V2 con pestaña abierta y 0 errores MIME |
| Responsive/visual | VERDE | evidencia autenticada y matriz de breakpoints; tabla Notarías acotada |
| Accessibility | AMARILLO | keyboard/dialog/focus/reduced motion manual; auditoría WCAG automatizada integral pendiente |
| Seguridad de dependencias | VERDE | npm audit frontend/backend: 0 vulnerabilidades; secret scan 780 archivos, 0 hallazgos |
| Observabilidad/operación | AMARILLO | health/logging presentes; dashboards/alertas del proveedor no verificados |
| Staging/deploy | ROJO | no existe staging validado ni configuración de servicios inspeccionada end-to-end |
| Backups | AMARILLO | restore drill local correcto; backup/restore administrado productivo pendiente |

## Integraciones y dominios

### Documentos y Storage

La carga de documento de expediente acepta y valida `requisito_id`, crea el vínculo y marca el requisito como recibido. El middleware de objeto propaga errores sin terminar el proceso. Las URLs firmadas no se persisten. La eliminación física solo se permite tras verificar referencias; el compensation worker queda como mecanismo de consistencia eventual. `LOCAL_LEGACY` permanece deliberadamente como lector histórico.

### Finanzas y reportes

`MovimientoFinanciero` es la fuente canónica para efectivo nuevo. `Pago` es legacy y no se suma sin reconciliación. El dry run aislado clasificó seis pagos (MXN 6,000) como `MIGRACION_SEGURA`, con fecha, referencia, destino y razón; no escribió movimientos. `valor_operacion` no alimenta honorarios, cartera ni facturación; su uso remanente es legal/proyecto y debe conservar esa etiqueta.

### Cumplimiento

RuleSets y revisiones versionados, evidencia y decisiones/snapshots inmutables. PEP no se infiere por IA. UIF e ISR permanecen separados y la UI no afirma presentación ante autoridad sin evidencia.

### Autorización

La API, no la UI, decide acceso. El error corregido `creado_por_id`→`creador_id` restablece el scope real de expedientes. Seeds ya no eligen “primer admin”: requieren `PRAVIA_SEED_ACTOR_USER_ID`.

## PWA y performance

- Main JS: 238.44 kB (78.15 kB gzip).
- CSS principal: 31.60 kB (7.06 kB gzip).
- Mayor chunk lazy: Finanzas 55.42 kB (13.95 kB gzip).
- Mi Día: 20.38 kB (6.25 kB gzip).
- Login no carga las rutas pesadas; Reportes, Finanzas, Expedientes, Comparecientes, Agenda, Compliance y Configuración están separados.
- El Service Worker no cachea `/api`, usa assets hashed de Vite y nunca responde HTML a una petición JS.

## Evidencia visual

Las 26 capturas autenticadas están en `docs/release/screenshots/` y no forman parte del bundle. Cubren los 16 estados desktop 1440×900 y diez móviles 390×844 solicitados.

## Riesgos abiertos y checklist de producción

- [ ] Reconciliar checksums/IDs de `_prisma_migrations` remoto y probar toda la secuencia en staging real.
- [ ] Rotar/configurar `AUTH_JWT_SECRET` con 32+ caracteres y verificar CORS/orígenes HTTPS exactos.
- [ ] Confirmar Netlify/Render existentes, comandos, Node, health, variables, workers y alertas.
- [ ] Ejecutar backup administrado y restore drill fuera del mismo clúster.
- [ ] Clonar objetos Storage representativos y probar compensation worker sin tocar objetos reales.
- [ ] Ejecutar backfill financiero primero en staging y reconciliar antes/después.
- [ ] Ejecutar IA con proveedor real, fuentes y acciones confirmadas bajo varios roles.
- [ ] Completar auditoría automatizada WCAG y rate limits distribuidos para recovery/activation/IA/uploads/search.
- [ ] Obtener autorización separada para migrar, desplegar backend y desplegar frontend.

## Rollback

Consultar [ROLLBACK_PLAN.md](./ROLLBACK_PLAN.md). Aplicación se revierte a release anterior; datos usan forward-fix y movimientos compensatorios. No se eliminan Storage, ledger, auditoría ni snapshots.
