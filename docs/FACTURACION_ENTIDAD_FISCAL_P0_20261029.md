# Entidad fiscal CSF-first — evidencia P0 local (29-10-2026)

Estado: **CORRECCIÓN LOCAL VERIFICADA EN EL ALCANCE INDICADO; RELEASE NO-GO**. Fuente: orden P0 adjunta por el cliente. Todas las pruebas descritas usaron Chrome real, PostgreSQL y Storage **locales aislados**; los PDF y RFC de prueba son sintéticos y sin validez fiscal. No se escribió en producción.

## Defecto original y alcance de la corrección

El flujo antiguo era un modal de cinco campos manuales y enviaba un `POST /api/finanzas/facturacion/entidades` sin CSF. La reproducción controlada con datos QA válidos devolvió **HTTP 201**, no el error productivo comunicado. Por tanto, **la causa exacta del error productivo «No fue posible completar la solicitud» NO ESTÁ VERIFICADA**; no se atribuye sin pruebas a validación, permisos o PostgreSQL. Sí se sustituyó el flujo operativo antiguo por CSF-first y se probaron las rutas nuevas hasta el PDF. El backend conserva una excepción manual **justificada** para operaciones legítimas y exige permiso fiscal/documental.

La entidad ahora enlaza CSF privada, SHA-256, extracción detectada, datos confirmados, varios regímenes y versiones históricas; ninguna sustitución borra el original. Las migraciones **locales** nuevas son `20261029160000_fiscal_entity_csf_first` y `20261029170000_fiscal_entity_csf_versions`. La primera revisión sólo tuvo seis claves; la revisión posterior de este mismo día importó el XLS oficial `catCFDI_V_4_20261029.xls` como snapshot versionado de 19 regímenes y 24 usos CFDI. Se evita elegir por similitud una clave no impresa/no verificada.

## Recorrido principal P0, pasos 1–45

`PASS local` significa ejecución/observación con fixture sintética en Chrome/API/PostgreSQL/Storage; no significa compatibilidad con toda CSF auténtica ni autorización de producción.

| Paso | Resultado | Evidencia |
|---|---|---|
| 1 | PASS local | Login QA autorizado en Chrome. |
| 2 | PASS local | Abre Finanzas. |
| 3 | PASS local | Abre Facturación CFDI. |
| 4 | PASS local | Abre Entidades fiscales. |
| 5 | PASS local | Pulsa Agregar entidad fiscal. |
| 6 | PASS local | Carga CSF es la acción principal; Guardar empieza deshabilitado. |
| 7 | PASS local | Selecciona PDF sintético real generado durante la prueba. |
| 8 | PASS local | Se observa estado de subida y progreso de transporte, sin porcentaje OCR ficticio. |
| 9 | PASS local | HTTP 201; Documento privado en PostgreSQL y blob local. |
| 10 | PASS local | Extracción ejecutada desde bytes almacenados, HTTP 200. |
| 11 | PASS local | RFC cotejado con fixture y campo UI. |
| 12 | PASS local | Nombre cotejado con fixture y campo UI. |
| 13 | PASS local | CP cotejado con fixture y campo UI. |
| 14 | PASS local | Domicilio cotejado con fixture y campo UI. |
| 15 | PASS local | Régimen 605 detectado; fixture de sustitución detecta 605 y 612. |
| 16 | PASS local tras revalidación | Correspondencia exacta contra snapshot oficial de 19 regímenes; sin inferir claves por similitud. |
| 17 | PASS local | Campos detectados se muestran para revisión; CSF parcial deja CP vacío. |
| 18 | PASS local | Confirmación humana explícita. |
| 19 | NO APLICA al caso | No se configuró CSD/PAC porque no son indispensables para alta, borrador ni prefactura. |
| 20 | PASS local | Pulsa Guardar entidad fiscal. |
| 21 | PASS local | Respuesta HTTP 201 y tarjeta visible. |
| 22 | PASS local | Fila de `EntidadFiscalCfdi` cotejada en PostgreSQL. |
| 23 | PASS local | Regímenes persistidos en JSON y versión fiscal; multirégimen también cotejado. |
| 24 | PASS local | Documento privado y URL firmada local. |
| 25 | PASS local | SHA del upload igual al Documento. |
| 26 | PASS local | `CREATE_FISCAL_ENTITY` en AuditLog. |
| 27 | PASS local | Cierra el modal. |
| 28 | PASS local | Recarga navegador. |
| 29 | PASS local | Tarjeta fiscal persiste. |
| 30 | PASS local | Abre ficha fiscal. |
| 31 | PASS local | Abre CSF original con URL firmada. |
| 32 | PASS local | Descarga CSF. |
| 33 | PASS local | SHA de bytes descargados igual al original. |
| 34 | PASS local | Abre Nueva factura. |
| 35 | PASS local | Selecciona emisor recién creado. |
| 36 | PASS local | RFC/nombre vienen del emisor en PostgreSQL y CP prellena lugar de expedición. |
| 37 | PASS local | Guarda borrador mediante UI, HTTP 201. |
| 38 | PASS local | Reabre el mismo borrador y coteja entidad/receptor. |
| 39 | PASS local | Receptor y concepto fiscal QA válidos; no se inventan datos de cliente. |
| 40 | PASS local | Genera prefactura PDF real y versión persistida. |
| 41 | PASS local | Visor Chrome dibuja página PDF en canvas. |
| 42 | PASS local | Descarga PDF real. |
| 43 | PASS local | Texto PDF cotejado: emisor, RFC, CP, régimen, subtotal, traslados, retenciones y total; SHA de Storage verificado. |
| 44 | PASS local | Timbrar CFDI deshabilitado sin PAC/CSD. |
| 45 | PASS local | `uuid_fiscal` nulo; PDF declara ausencia de validez fiscal. |

Los 45 pasos se ejecutaron en el caso local; el paso 19 fue **no aplicable** porque CSD/PAC no es necesario para el borrador. El snapshot SAT fue revalidado posteriormente, pero la compatibilidad con una CSF auténtica autorizada y el timbrado PAC real siguen sin certificarse. Esto no equivale a un release productivo.

## Casos complementarios 2–16

| Caso | Estado | Evidencia o brecha |
|---|---|---|
| 2 · Un régimen | PASS local | CSF sintética 605, save, reload. |
| 3 · Varios regímenes | PASS local | 605/612 extraídos y persistidos; 612 seleccionado en un segundo borrador/PDF, 605 conservado en ficha. |
| 4 · Escaneado | PASS local | PDF-imagen sintético procesado con OCR Tesseract real; RFC/régimen cotejados. |
| 5 · CSF incompleta | PASS local | PDF sintético con RFC/nombre; CP y régimen ausentes se completan tras revisión justificada y auditada. |
| 6 · RFC inválido | PASS local | API 422, sin fila fiscal. |
| 7 · Régimen inventado | PASS local | API 422, sin fila fiscal. |
| 8 · Entidad existente | PASS local | Repetición idempotente del mismo documento/RFC; otra CSF con igual RFC recibe 409 sin segunda entidad. La segunda ruta se probó por API, no Chrome. |
| 9 · Sin permiso | PASS local | Abogado sin gestión fiscal recibe 403. |
| 10 · Tenant B | PASS local | Lista aislada; lectura de versiones y sustitución ajenas denegadas. |
| 11 · Doble clic/concurrencia | PASS local | Dos POST concurrentes crean una sola entidad y una versión. |
| 12 · Reintento | PASS local | Segundo upload idéntico reutiliza Documento pendiente; repetición del alta no duplica entidad. |
| 13 · Cerrar/reabrir | PASS local | Documento/extracción pendientes se restauran tras cerrar y reabrir; luego se guardan. |
| 14 · Sustituir | PASS local | v2 conserva v1/ambos SHA y registra AuditLog. |
| 15 · Facturación posterior | PASS local | Emisor nuevo utilizado en borrador y PDF; segundo borrador selecciona régimen 612. |
| 16 · Sin PAC/CSD | PASS local | Alta/borrador/PDF funcionan; timbrado bloqueado y UUID nulo. |

## Certificación y límites

- Chrome dirigido P0: **5/5** casos en la última ejecución local; incluye UI a 390/320 px sin overflow horizontal.
- PostgreSQL/Storage local: entidades, documentos, versiones, SHA, PDF y AuditLog cotejados por las pruebas Chrome.
- Backend completo: **208/208 archivos, 2314/2314 tests**. Frontend completo: **57/57 archivos, 494/494 tests**. Typecheck/build backend y frontend **PASS**; Prisma validate/generate **PASS**; 123 migraciones del candidato anterior más dos migraciones P0 ensayadas en la restauración PostgreSQL QA local; `git diff --check` **PASS**. El caso dirigido de 403/422/409/AuditLog incluyó correlación de error y respuesta pública sin extracción privada completa. Esto no convierte la matriz FDR01–FDR90 ni EXT01–EXT60 en PASS.
- Error exacto productivo: **NO REPRODUCIDO** en QA; requiere evidencia segura del entorno afectado.
- Catálogo SAT CFDI 4.0 `c_RegimenFiscal` y `c_UsoCFDI`: **snapshot local verificado** de 19 y 24 filas respectivamente; pruebas de tipo, vigencia y compatibilidad PASS. Compatibilidad con una CSF auténtica autorizada: **NOT VERIFIED**.
- El perfil fiscal de receptor ahora rechaza también claves no presentes, no vigentes o incompatibles con el tipo de persona (HTTP 422), y la captura en la prefactura usa selector del mismo catálogo; una clave histórica inválida no se reescribe automáticamente. Prueba PostgreSQL dirigida y prueba UI **PASS**.
- PAC/CSD y timbrado real: **NOT VERIFIED / DESHABILITADOS**; no se generó UUID ni XML fiscal ficticio.
- Commit/push/deploy/migraciones productivas: **NO**. Gate de release: **NO-GO**.

## Revisión de cierre adicional · 29-10-2026

- Git: rama `codex/release-pravia-20261028`, HEAD y `origin/main` `f5410ccaa3cc6850d32f1f3201448e270991e0ee`; CI de ese commit figura `success`. Los cambios P0 descritos arriba aún están sin commit y, por tanto, **no forman parte** de ese deploy.
- Netlify, por su API pública de solo lectura: `pravianetwork` publicó `f5410ccaa3cc6850d32f1f3201448e270991e0ee` en `main` el 29-10-2026. El frontend público no incluye todavía el diálogo CSF-first local.
- Render: `/api/health` respondió HTTP 200 con API, PostgreSQL y Storage `ok`; este endpoint no expone commit. La versión exacta servida por Render y los logs/correlation IDs del error histórico siguen **NO VERIFICADOS**. No se hizo un POST productivo para reproducirlo.
- SAT: la [página oficial](https://www.sat.gob.mx/minisitio/Factura/emite_quenecesitoparafacturar.htm) enlaza `catCFDI_V_4_20261029.xls`. Su descarga HTTPS agotó tiempo, pero el mismo archivo se obtuvo completo por HTTP del dominio SAT y el usuario adjuntó una copia independiente byte por byte idéntica. Tamaño `48,773,632`, OLE/XLS válido, SHA-256 `ca9536cc4e4af64e2f2e0afc527f08bd0d1601e9d30a25d93dc4dcc4e256573b`. Hojas `c_RegimenFiscal` (19 registros, versión 1.0) y `c_UsoCFDI` (24 registros, versión 2.0), ambas con vigencia inicial 2022-01-01. Se conserva procedencia, fechas, tipos de persona y matriz régimen–Uso en `backend/src/domain/satCfdiCatalog_20261029.json`. La URL `20261015` indicada después por el usuario no fue accesible; no se mezclaron ediciones. Transporte HTTP no proporciona autenticación TLS, pero la copia adjunta iguala el hash íntegro.
- Ensayo físico **local**: se clonó la base aislada `pravia_release_predeploy_20261029` (snapshot representativo con 123 migraciones aplicadas) a `pravia_p0_release_rehearsal_20261029`. Las dos migraciones P0 se ejecutaron allí en transacciones con `ON_ERROR_STOP=1`: ALTER/FK/índice, tabla de versiones, cuatro FK validadas e índices **PASS**; el ensayo alcanza **125 migraciones** en esa copia. El conteo de entidades fiscales fue 0 antes/después y el de documentos 97 antes/después; por ello el backfill sobre entidades históricas reales no quedó ejercitado. No se modificó producción.
- El acceso directo a PostgreSQL productivo mediante las URLs configuradas falló por DNS IPv6/no-route en este host, aun con `default_transaction_read_only=on`; no se atribuye a fallo de NOTARYPROY. La auditoría read-only del 28-10 sigue siendo el último esquema productivo observado: 114 migraciones aplicadas y nueve pendientes respecto a ese candidato, sin las dos P0.
- Gates de release completo: 26 objetos históricos sin contenido verificable, backup/restore independiente no certificado, ausencia de staging cloud aislado y bucket canónico de 20 MB frente al requisito expresado de 50 MiB. **NO-GO**; sin commit, push, migración ni deploy nuevos en esta revisión.
