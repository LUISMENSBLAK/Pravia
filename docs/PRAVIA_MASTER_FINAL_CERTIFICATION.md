# PRAVIA OS — certificación maestra final

Estado al 22-10-2026: **ABIERTA / NO-GO**. Este informe es un tablero de evidencias, no una aprobación de release. La autorización nueva permite desplegar automáticamente sólo después de superar los gates; no los convierte en PASS.

## Revalidación local del 22-10-2026

- Rama de trabajo aislada: `codex/staging-preview-20261022`, HEAD `b24534ec1ec1505944c7b720e0cf03647e28c005`; 195 entradas de worktree ya existentes antes de la corrección de guarda de preview. Staging de Git vacío; sin commit ni push.
- Las seis fuentes DOCX originales se releyeron y sus SHA-256 coinciden con `PRAVIA_MASTER_CLIENT_REQUIREMENTS.md`.
- Presupuesto: cálculo focalizado de $78,000 y $79,500 sin IVA de otro gasto; gasto gravado de test da $79,740 únicamente con tasa/fuente/versión explícitas. PostgreSQL QA físico `quoteBudgetCorrection.postgresql.integration.test.ts` 2/2 PASS en `pravia_six_corr_qa`; migraciones productivas NO aplicadas.
- Backend unitario: primera ejecución concurrente 2270/2272 con dos timeouts de 5 s; los dos archivos aislados 20/20 PASS; repetición completa con timeout de 15 s 2272/2272 PASS. Frontend unitario final después de los ajustes: 57 archivos y 486/486 PASS. Builds backend y frontend, Prisma validate y `git diff --check` PASS.
- Chrome local: `six-corrections-tenant-local.spec.ts` 1/1 PASS; Prospecto → Cotización con persistencia y sin reconversión 1/1 PASS; CFDI XML/PDF, descargas y fallback explícito sin PAC 1/1 PASS; responsive Finanzas CFDI 1440/1366/1024/768/390/320 1/1 PASS. Frontend `127.0.0.1:5176` con proxy explícito a backend QA `127.0.0.1:3001`. Un primer intento falló por ausencia de proxy local y sirvió HTML en `/api/health`; se corrigió el arranque del frontend y se repitió PASS. Health final de frontend/API/DB/Storage local: OK. Estos cuatro escenarios no certifican los otros casos pendientes de la matriz.
- Se cerró una ruta accidental a producción: builds `deploy-preview`/`branch-deploy` de Netlify exigen `VITE_DEPLOY_ENV=staging`, API HTTPS absoluta, host esperado y lista de hosts productivos. El host productivo actual `pravia-api.onrender.com` también se bloquea aun si la lista configurable está mal definida. La prueba negativa real de build sin esos valores falló con mensaje de configuración insegura; build normal pasó. No existe backend, PostgreSQL ni Storage de staging externos verificados; no se publicó preview.
- Auditoría estática de rutas frontend: una descarga de evidencia de Cumplimiento aún usaba `/api` directamente y habría seguido el redirect productivo en una preview. Ahora emplea `apiUrl` y el bearer de la sesión; test focalizado y suite global posterior 486/486 PASS, typecheck y build frontend PASS.
- Bloqueos de producción vigentes: certificación funcional completa, CFG-002 10 pendientes, integridad de 26 objetos no localizados, backup/restore independiente y staging externo aislado. PAC/billing reales continúan deshabilitados/no certificados; no se presentan como operativos.

| Gate | Estado comprobado | Falta para PASS |
|---|---|---|
| Fuentes originales | 6/6 DOCX disponibles y leídos, SHA-256 en `PRAVIA_MASTER_CLIENT_REQUIREMENTS.md` | Descomposición atómica total de todas las secciones y fuentes históricas |
| Seis correcciones | 226 casos mínimos registrados; 3 PASS y 223 NOT VERIFIED en la matriz anterior a esta intervención | Ejecutar y documentar los casos restantes; incorporar deltas originales |
| CFG-002 | 20 PASS / 10 NOT VERIFIED al inicio y al cierre de este corte; CFG2-13/18/27 tienen cuatro pruebas físicas PostgreSQL nuevas, aún parciales | Resolver CFG2-08, 09, 13, 18, 21, 22, 25, 26, 27 y 30 con evidencia completa |
| Cotización Word ADM-001 | Focalizado 5/5; render visual local de un DOCX sintético en la tabla original; backend build PASS | API/Chrome real, `OTRO GASTO`, cálculo y totalidad del contrato |
| Regresión unitarios/build | Backend 199/199 archivos y 2272/2272 pruebas con timeout de 15 s; frontend 57/57 y 486/486; builds backend/frontend, Prisma validate y `git diff --check` PASS | Integración PostgreSQL/Storage completa, Chrome E2E de toda la matriz, seguridad, responsive y accesibilidad del estado final; las suites limpias no certifican los requisitos pendientes |
| Dependencias externas | No resueltas | 26 objetos históricos, backup/restore independiente, PAC, billing y upload 50 MiB en hosting productivo |
| Entorno QA disponible | Frontend `http://127.0.0.1:5176/login` HTTP 200; backend `http://127.0.0.1:3001/health` informa API/DB/Storage `ok`, DB `127.0.0.1:55510/pravia_six_corr_qa` y Storage filesystem-local | Un HTTP saludable no sustituye login ni browser UAT de los casos pendientes |

LOCAL GATE: **FAIL — certificación incompleta**.

PRODUCTION RELEASE GATE: **NO-GO**.

READY FOR CLIENT USE: **NO CERTIFICADO**.

No se hizo commit, push, deploy ni escritura productiva en este corte. Los servicios QA locales deben verificarse al entregar; una respuesta HTTP 200 por sí sola no certifica el flujo completo.
