# PRAVIA OS — certificación maestra final

## Colaboración organizacional (28-10-2026)

La corrección transversal de visibilidad compartida, escritura controlada y folios por organización tiene seguimiento individual en [COL01–COL70](PRAVIA_ORGANIZATION_COLLABORATION_CERTIFICATION.md). Estado actual de esa matriz: **67 PASS, 3 PARCIAL y 0 NO VERIFICADO**. COL35 (Prospecto sin responsable) y COL46 (serie EXP alternativa) pasaron pruebas dirigidas en Chrome, API y PostgreSQL QA. COL45 incorporó reconciliación física de contadores con histórico sintético, COL56 registró rechazos 403 autenticados y COL67 ejecutó carga/confirmación/sustitución de CSF sintética con lectura local, SHA, aislamiento y ausencia de doble extracción/cargo en Chrome/PostgreSQL/Storage; permanecen PARCIAL por las brechas detalladas en la matriz. En el estado de este corte pasaron backend completo 2.308/2.308, frontend completo 494/494, builds backend/frontend, Prisma validate/generate y E2E COL67 ampliado 1/1. La evidencia parcial no constituye 70/70 ni levanta los bloqueos previos de Facturación/Extracción/backup/release. **Producción: NO-GO** mientras cualquier gate obligatorio siga sin certificarse.

Estado al 23-10-2026: **ABIERTA / NO-GO**. Este informe es un tablero de evidencias, no una aprobación de release. La autorización nueva permite desplegar automáticamente sólo después de superar los gates; no los convierte en PASS.

## Revalidación local del 22-10-2026

- Rama de trabajo aislada: `codex/staging-preview-20261022`, commit funcional `447496ff7231acb08fb49d8801dde6aca6e20ee1`, publicado en `origin/codex/staging-preview-20261022`. `origin/main` permanece en `b24534ec1ec1505944c7b720e0cf03647e28c005`; no se hizo merge ni se modificó producción.
- Las seis fuentes DOCX originales se releyeron y sus SHA-256 coinciden con `PRAVIA_MASTER_CLIENT_REQUIREMENTS.md`.
- Presupuesto: cálculo focalizado de $78,000 y $79,500 sin IVA de otro gasto; gasto gravado de test da $79,740 únicamente con tasa/fuente/versión explícitas. PostgreSQL QA físico `quoteBudgetCorrection.postgresql.integration.test.ts` 2/2 PASS en `pravia_six_corr_qa`; migraciones productivas NO aplicadas.
- Backend unitario: primera ejecución concurrente 2270/2272 con dos timeouts de 5 s; los dos archivos aislados 20/20 PASS; repetición completa final con timeout de 15 s 2277/2277 PASS, incluyendo 10/10 del guard de staging. Frontend unitario final después de los ajustes: 57 archivos y 486/486 PASS. Builds backend y frontend, Prisma validate y `git diff --check` PASS.
- Chrome local: `six-corrections-tenant-local.spec.ts` 1/1 PASS; Prospecto → Cotización con persistencia y sin reconversión 1/1 PASS; CFDI XML/PDF, descargas y fallback explícito sin PAC 1/1 PASS; responsive Finanzas CFDI 1440/1366/1024/768/390/320 1/1 PASS. Frontend `127.0.0.1:5176` con proxy explícito a backend QA `127.0.0.1:3001`. Un primer intento falló por ausencia de proxy local y sirvió HTML en `/api/health`; se corrigió el arranque del frontend y se repitió PASS. Health final de frontend/API/DB/Storage local: OK. Estos cuatro escenarios no certifican los otros casos pendientes de la matriz.
- Se cerró una ruta accidental a producción: builds `deploy-preview`/`branch-deploy` de Netlify exigen `VITE_DEPLOY_ENV=staging`, API HTTPS absoluta, host esperado y lista de hosts productivos. El host productivo actual `pravia-api.onrender.com` también se bloquea aun si la lista configurable está mal definida. La prueba negativa real de build sin esos valores falló con mensaje de configuración insegura; build normal pasó. No existe backend, PostgreSQL ni Storage de staging externos verificados; no se publicó preview.
- Inspección externa sólo lectura: Render contiene únicamente el entorno `Production`; Netlify no creó branch deploy al publicar la rama; Supabase muestra `NOTARYPROY` productivo y otro proyecto pausado no autorizado, sin proyecto staging utilizable. El backend ahora también rechaza su propio arranque cuando `PRAVIA_ENV=staging` no coincide exactamente con las huellas DB/direct URL/Storage esperadas o coincide con producción. Sin infraestructura aislada no se activó ningún preview parcial.
- Auditoría estática de rutas frontend: una descarga de evidencia de Cumplimiento aún usaba `/api` directamente y habría seguido el redirect productivo en una preview. Ahora emplea `apiUrl` y el bearer de la sesión; test focalizado y suite global posterior 486/486 PASS, typecheck y build frontend PASS.
- Bloqueos de producción vigentes: certificación funcional completa, CFG-002 10 pendientes, integridad de 26 objetos no localizados, backup/restore independiente y staging externo aislado. PAC/billing reales continúan deshabilitados/no certificados; no se presentan como operativos.

| Gate | Estado comprobado | Falta para PASS |
|---|---|---|
| Fuentes originales | 6/6 DOCX disponibles y leídos, SHA-256 en `PRAVIA_MASTER_CLIENT_REQUIREMENTS.md` | Descomposición atómica total de todas las secciones y fuentes históricas |
| Seis correcciones | 226 casos mínimos registrados; 3 PASS y 223 NOT VERIFIED en la matriz anterior a esta intervención | Ejecutar y documentar los casos restantes; incorporar deltas originales |
| CFG-002 | 20 PASS / 10 NOT VERIFIED al inicio y al cierre de este corte; CFG2-13/18/27 tienen cuatro pruebas físicas PostgreSQL nuevas, aún parciales | Resolver CFG2-08, 09, 13, 18, 21, 22, 25, 26, 27 y 30 con evidencia completa |
| Cotización Word ADM-001 | Focalizado 5/5; render visual local de un DOCX sintético en la tabla original; backend build PASS | API/Chrome real, `OTRO GASTO`, cálculo y totalidad del contrato |
| Regresión unitarios/build | Backend 199/199 archivos y 2277/2277 pruebas con timeout de 15 s; frontend 57/57 y 486/486; builds backend/frontend, Prisma validate y `git diff --check` PASS | Integración PostgreSQL/Storage completa, Chrome E2E de toda la matriz, seguridad, responsive y accesibilidad del estado final; las suites limpias no certifican los requisitos pendientes |
| Dependencias externas | No resueltas | 26 objetos históricos, backup/restore independiente, PAC, billing y upload 50 MiB en hosting productivo |
| Entorno QA disponible | Frontend `http://127.0.0.1:5176/login` HTTP 200; backend `http://127.0.0.1:3001/health` informa API/DB/Storage `ok`, DB `127.0.0.1:55510/pravia_six_corr_qa` y Storage filesystem-local | Un HTTP saludable no sustituye login ni browser UAT de los casos pendientes |

LOCAL GATE: **FAIL — certificación incompleta**.

PRODUCTION RELEASE GATE: **NO-GO**.

READY FOR CLIENT USE: **NO CERTIFICADO**.

Se hizo commit y push únicamente a la rama aislada; no hubo deploy, merge, migración ni escritura productiva. Al entregar, frontend QA local responde 200 y backend informa API/DB/Storage `ok`; una respuesta HTTP saludable no certifica por sí sola los flujos pendientes.

## Actualización 27-10-2026 — extracción universal y facturación

Se añadió la matriz `PRAVIA_UNIVERSAL_EXTRACTION_CERTIFICATION.md` (EXT01–EXT60) y el inventario transversal de puntos de extracción. El parser CSF tabular local se corrigió y se probó con fixture sintética y el PDF privado aportado: los campos de identidad/domicilio/fechas se detectan, pero el régimen documental carece de clave SAT explícita y exige revisión. Chrome local confirmó la carga privada, el aviso y el bloqueo de selección/guardado cuando no hay clave; una petición API directa con clave no detectada devolvió 422. La CURP sólo tiene validación sintáctica local; el OCR de la INE no alcanza confianza suficiente. Los PDF privados no se incluyen en Git. Regresión final de este corte: backend **2.289/2.289**, frontend **493/493**, Chrome de Facturación **5/5**, PostgreSQL/Storage físico **1/1**, builds/Prisma PASS. **EXT: 0/60 PASS integral; FDR: 15/90 PASS de alcance puntual, 75/90 NOT VERIFIED; recorrido Chrome 31/31: no certificado.** Los gates local integral, extracción universal, demo y producción permanecen **NO-GO**. Esta actualización no constituye commit, push ni deploy.

## Continuación local 27-10-2026 — CURP documentada y categorización de carga

- El parser CURP PDF determinístico lee etiquetas espaciales y conserva original/SHA, página, bloque, fragmento, nombre literal, folio, entidad, fecha de inscripción y leyenda de certificación; no inventa apellidos ni fecha de emisión y no equivale a verificación RENAPO. El PDF privado se procesó sólo en memoria local sin publicar sus valores.
- La carga de Comparecientes ahora permite elegir explícitamente CURP; anteriormente enviaba toda carga como `OTROS`, impidiendo activar el parser. La ficha existente guarda propuestas sin tocar identidad maestra, página/fragmento y metadatos pendientes. Chrome real con PDF **sintético** realizó carga, extracción, revisión y reload 1/1; PostgreSQL/Storage QA sintéticos verificaron original, propuestas, AuditLog y aislamiento 1/1.
- La CSF privada permite detectar actividad económica tabular con página, además de los campos ya probados; no se asignó una clave SAT no impresa. El esquema XSD de claves se obtuvo del SAT, pero su catálogo XLS descriptivo/versionado no respondió desde este entorno; mapeo oficial de nombres y compatibilidad Uso CFDI siguen **NOT VERIFIED**.
- Regresión de este estado: backend **2.292/2.292**, frontend **493/493**, backend/frontend build PASS, frontend typecheck PASS, Prisma validate/generate PASS, `git diff --check` PASS. Los tests dirigidos del extractor pasaron 18/18. Estos resultados no elevan EXT ni FDR a certificación integral: **EXT 0/60 PASS integral; FDR 15/90 PASS de alcance puntual; recorrido principal 31 pasos no certificado**.

## Continuación local 27-10-2026 — borrador incompleto desde ingreso EXP-008

- Un ingreso de expediente puede iniciar un borrador fiscal de total cero aun cuando falten perfil receptor, emisor o conceptos. El backend no crea cuenta ni reserva saldo ni permite PDF con datos incompletos. PostgreSQL QA confirmó idempotencia, finalización posterior con receptor confirmado, emisor, concepto y reserva exacta, más liberación al eliminar.
- Chrome local comprobó guardar, recargar, reabrir y eliminar ese borrador sin alterar el ingreso; la suite de Facturación pasó **6/6** incluyendo PDF real, descarga, versiones y responsive. Una carrera de selección de borrador se protegió en la UI; la prueba ahora espera el selector cargado antes de actuar.
- La repetición secuencial pasó backend **2.292/2.292** y frontend **494/494**. La primera ejecución simultánea se descartó por timeouts de OCR/Agenda bajo saturación. Esto no certifica 31 pasos, SAT completo, INE, PAC ni los gates de producción: **NO-GO**, sin commit, push ni deploy en este corte.
- Producción **NO-GO**: faltan SAT XLS oficial/compatibilidad, INE confiable, flujo principal Chrome y segunda auditoría, integridad de 26 objetos históricos y backup/restore. No hubo commit, push, deploy ni escrituras productivas en esta continuación.
