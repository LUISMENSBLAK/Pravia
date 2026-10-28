# PRAVIA OS — certificación de las seis correcciones

Estado: **EN CURSO / NO-GO**. Esta matriz transcribe los 226 casos mínimos del prompt maestro; no sustituye la descomposición adicional de los seis DOCX ni demuestra una prueba por sí sola. `NOT VERIFIED` significa que falta ejecución y evidencia, aunque haya código o pruebas unitarias relacionadas.

Fuentes: los seis DOCX aportados por el cliente y el prompt maestro del 20-10-2026. El corte actual usa local/QA aislado. La orden del 22-10-2026 autoriza commit, push y deploy sólo después de sus gates respectivos; no autoriza declarar aprobados casos sin evidencia ni omitir aislamiento, backup o recuperación. No hubo escrituras productivas en este corte.

## Vista previa documental — corrección visual local · 20-10-2026

La captura del cliente reprodujo un defecto real: el visor convertía `COMPRAVENTA.docx` a HTML semántico con Mammoth y lo mostraba como un solo flujo de texto, perdiendo la maquetación de Word. El visor compartido usa ahora un renderizador DOCX que conserva medidas de página, márgenes, estilos, tablas, imágenes, encabezados/pies y saltos registrados. El original privado no se modifica ni se envía a un servicio externo. PDF continúa renderizándose por páginas con PDF.js; `.DOC` antiguo mantiene el aviso de formato no interpretable y la descarga manual.

Evidencia local: Chrome QA abrió el `COMPRAVENTA.docx` de 41.229 bytes desde CFG-002, mostró hojas separadas, negritas, resaltado y márgenes; a 390/320 px el visor ajustó al ancho sin overflow horizontal de página y mantuvo zoom para lectura. Los saltos automáticos de Microsoft Word no pueden garantizarse idénticos mediante un renderizador HTML; la vista se etiqueta como maquetada y orientativa, y la descarga del DOCX original sigue disponible para revisión definitiva.

Un PDF sintético local cargado por la UI del expediente descubrió un fallo real: el cache de dependencias de Vite mantenía PDF.js API `6.3.289` mientras el worker instalado era `6.2.108`; el visor mostraba fallback. Se forzó una reoptimización local y se excluyó `pdfjs-dist` del prebundle para evitar versiones cruzadas tras cambios de dependencias. Tras reiniciar con el proxy **local** QA, Chrome mostró la página PDF real en canvas, no texto extraído, con zoom y controles. A 390/320 px el canvas confirmó carga completa y la página no desbordó horizontalmente. Se añadió manejo de errores de render por página para que una cancelación no produzca rechazo sin gestionar. El PDF de prueba está etiquetado explícitamente sin validez fiscal. Regresión final: `DocumentViewer.test.tsx` 11/11; frontend 56/56 archivos, 479/479 tests; backend 198/198 archivos, 2258/2258 tests; frontend build/typecheck y `git diff --check` PASS. Sin escritura productiva. Esto **no** convierte los casos restantes de CFG-002 ni el gate de release en PASS.

## Corte CFG-002 Organization · 20-10-2026

Rama `codex/pravia-ia2-zantamar-e2e`, base `b24534ec1ec1505944c7b720e0cf03647e28c005`. Dos migraciones incrementales (`20261020100000_cfg002_organization_owner_enum` y `20261020101000_cfg002_organization_owner_backfill`) se ejecutaron únicamente en PostgreSQL QA local. Antes/después del backfill aislado: 10 artefactos, 14 versiones, 7 vínculos a actos y 3 asignaciones de machote; IDs, claves Storage y SHA conservaron su firma. El `notaria_id` histórico permanece como procedencia, mientras la titularidad activa es `ORGANIZACION`. No se eligió automáticamente entre machotes históricos homónimos.

Prueba física aislada `configurationCatalogOrganization.postgresql.integration.test.ts`: 5/5, incluyendo dos jerarquías homónimas de notarías antiguas, aislamiento A/B, rechazo de writes `NOTARIA`, versiones y auditoría. Backend unitario 198/198 archivos, 2258/2258 pruebas; frontend unitario 56/56 archivos, 477/477 pruebas. Prisma validate/generate, builds backend/frontend y `git diff --check` pasaron. Chrome local confirmó creación de carpeta y machote DOCX sin selector de Notaría, persistencia tras reload, vista previa real, SHA físico/DB y AuditLog. La pantalla CFG-002 no desbordó horizontalmente a 390/320 px. La ruta `/notarias` redirigió a Configuración → Organización.

Un machote histórico `COMPRAVENTA.docx` tenía registro y SHA pero no binario en el Storage QA; se repuso **sólo en QA local** desde el DOCX original aportado por el usuario tras comprobar igualdad exacta de 41.229 bytes y SHA-256. Su vista previa volvió a renderizar. Tanto la descarga firmada por API como la descarga iniciada desde el visor Chrome devolvieron 41.229 bytes con SHA-256 idéntico al DOCX original. La copia descargada para QA se movió a la Papelera al terminar. Esto no certifica ni modifica los otros originales históricos pendientes; el gate documental productivo sigue abierto.

Autorización con sesiones reales QA contra API local: Dirección (`DIRECCION`) leyó y obtuvo URL de descarga (200/200); Abogado (`ABOGADO`) leyó y descargó (200/200) pero no pudo crear carpeta (403); Financiero (`FINANCIERO`) no pudo leer, descargar ni crear carpeta (403/403/403). Una consulta de Dirección al owner de otra organización devolvió 403. El intento de escribir una plantilla bajo propietario legacy `NOTARIA` fue rechazado (400), sin crear registro. Se probó en backend HTTP real, no sólo con botones ocultos.

Chrome creó además `QA CFG002 ACTO 20261020`, lo vinculó al Acto exacto `ACTO CONTEXTUAL QA 1791688718904` y mostró `1 acto(s)` / `Machote para proyecto`. PostgreSQL confirmó owner `ORGANIZACION`, `notaria_id` nulo, versión de 41.229 bytes, SHA original y asignación al `tipo_acto_id` esperado. El workspace de `EXP-0141-2026` devolvió ese machote como único `default` y el resolver `PROYECTO_MACHOTE` respondió 200 con artefacto, versión y SHA exactos. La generación real quedó bloqueada correctamente por `AI_OPERATION_DISABLED`: el catálogo local de operaciones IA está vacío, por lo que no se inventó pricing/routing ni se simuló éxito.

| ID | Resultado | Evidencia / pendiente concreto |
|---|---|---|
| CFG2-01 | PASS | Explorador Organization en Chrome y PostgreSQL. |
| CFG2-02 | PASS | Integración A/B: B no lista artefacto A. |
| CFG2-03 | PASS | Alta real de machote en Chrome sin Notaría. |
| CFG2-04 | PASS | DOCX real de 41.229 bytes, Storage QA y SHA DB coincidentes. |
| CFG2-05 | PASS | Carpeta y machote presentes tras reload. |
| CFG2-06 | PASS | Chrome vinculó machote nuevo a Acto exacto; UI y PostgreSQL muestran la asignación. |
| CFG2-07 | PASS | Workspace + resolver funcional devolvieron el artefacto/version/SHA correctos para el Acto. |
| CFG2-08 | NOT VERIFIED | Generación real intentada: bloqueada por `AI_OPERATION_DISABLED`; falta catálogo IA/pricing/routing local aprobado. |
| CFG2-09 | NOT VERIFIED | Falta inspeccionar el DOCX generado. |
| CFG2-10 | PASS | Vista previa completa + descarga desde Chrome; 41.229 bytes y SHA-256 idéntico al original. |
| CFG2-11 | PASS | Integración creó v2 y conservó v1/archivo original. |
| CFG2-12 | PASS | 14 versiones legacy preservadas por firma antes/después. |
| CFG2-13 | NOT VERIFIED | PostgreSQL QA aislado: asignar v1→reemplazar v2 exige confirmación, conserva ambas versiones y audita (test físico 1/1). Falta cambio desde Chrome y cotejar documento generado antes/después sin reescritura histórica. |
| CFG2-14 | PASS | 7 vínculos a actos y 3 asignaciones conservaron identidad. |
| CFG2-15 | PASS | ID directo de A desde B denegado en integración. |
| CFG2-16 | PASS | Abogado/Financiero: POST carpeta 403 con sesiones reales QA; Dirección 400 por payload legacy, no por permiso. |
| CFG2-17 | PASS | Financiero: URL de versión 403 por permiso; Dirección/Abogado 200 y descarga firmada verificable. |
| CFG2-18 | NOT VERIFIED | Avance: la baja lógica conserva versiones, claves y FK; asignación concurrente y baja comparten bloqueo transaccional y validan vigencia dentro de la transacción. PostgreSQL QA aislado 2/2 para baja/concurrencia. Falta probar plantilla sin referencias y usada por documento generado, además de Chrome. |
| CFG2-19 | PASS | Conteos pre/post backfill aislado idénticos. |
| CFG2-20 | PASS | Migración física y versiones/asignaciones FK válidas. |
| CFG2-21 | NOT VERIFIED | Falta documento nuevo con variables institucionales. |
| CFG2-22 | NOT VERIFIED | SHA original conservado; falta cotejo de documento emitido histórico. |
| CFG2-23 | PASS | Chrome mostró Organización y ningún selector Notaría en CFG-002. |
| CFG2-24 | PASS | Chrome `/notarias` → `/configuracion/organizacion`. |
| CFG2-25 | NOT VERIFIED | Falta export/restore Control Plane con esta migración. |
| CFG2-26 | NOT VERIFIED | El enum y el presupuesto canónico ya representan `OTRO_GASTO`, con tratamiento fiscal explícito y centavos exactos. En PostgreSQL QA aislado se persistieron honorarios $50,000, impuestos/derechos $20,000 y otro gasto $1,500 gravado al 16 %, total $79,740; Chrome mostró el mismo total tras reload. Los honorarios legacy sin IVA verificable conservan su importe, se muestran como provisionales y bloquean nuevo snapshot/documento hasta revisión; Chrome verificó esto en 390/320 px sin overflow. El ADM-001 original se rellenó en su tabla económica, sin fila agregada duplicada ni apéndice artificial; el DOCX sintético se renderizó visualmente en una página. La generación/descarga por Chrome sigue bloqueada porque el blob de la versión ADM-001 activa referenciada por la DB QA no existe en el Storage local aislado; no se sustituyó silenciosamente por otro machote. |
| CFG2-27 | NOT VERIFIED | PostgreSQL QA aislado: tenant B no lista el artifact A ni obtiene metadatos por ID, versión o Acto (prueba física 1/1). Falta búsqueda global/catalogal por nombre/filtros y RBAC denegado con HTTP real. |
| CFG2-28 | PASS | AuditLog `CFG_ARTIFACT_CREATED` tras alta real y en integración. |
| CFG2-29 | PASS | `migrate deploy` sin pendientes en segundo pase; SQL repetible en clone QA. |
| CFG2-30 | NOT VERIFIED | Chrome cubrió creación/reload/preview; falta selección→generación→descarga completa. |

CFG-002 dirigido: **20 PASS / 10 NOT VERIFIED**. No se declara 30/30 ni certificación de las seis correcciones. `TN11` quedó cerrado sin reescritura histórica: CFG-001 ya no ofrece `NOTARIA` al crear un Acto ni una excepción posterior; el API rechaza el write con `CFG001_LEGACY_NOTARY_SELECTOR_READ_ONLY`, mientras la resolución de excepciones históricas permanece disponible para no alterar reglas ya persistidas.

## Casos mínimos

| ID | Área | Criterio | Estado | Evidencia / procedimiento pendiente |
|---|---|---|---|---|
| TN01 | Una notaría por tenant | menú Notarías ausente | PASS | Chrome local `frontend/e2e/six-corrections-tenant-local.spec.ts`: sesión QA autenticada, enlace Notarías ausente. |
| TN02 | Una notaría por tenant | listado/buscador/CTA ausentes | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| TN03 | Una notaría por tenant | ruta legacy redirección correcta | PASS | Chrome local `frontend/e2e/six-corrections-tenant-local.spec.ts`: `/notarias` y `/notarias/legacy-uuid` redirigen a `/configuracion/organizacion`. |
| TN04 | Una notaría por tenant | Config→Organización muestra número/titular/domicilio/logo/datos | NOT VERIFIED | Parcial Chrome local: ficha, número, titular, domicilio y acción Editar visibles; logo/datos y persistencia de edición siguen sin certificarse. |
| TN05 | Una notaría por tenant | edición con permiso, read-only para no autorizado | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| TN06 | Una notaría por tenant | migración idempotente de datos históricos | NOT VERIFIED | Dry-run parcial local en `pravia_six_corr_qa`: 10 columnas, 1 registro único migrado, 2 legacy conservados en tenant ambiguo; segunda aplicación sin error. Falta validar corpus completo y rutas dependientes. |
| TN07 | Una notaría por tenant | FK/relaciones no rotas | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| TN08 | Una notaría por tenant | Prospect sin selector notaría | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| TN09 | Una notaría por tenant | Quote sin selector | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| TN10 | Una notaría por tenant | EXP sin selector | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| TN11 | Una notaría por tenant | CFG-001/002 sin notaría interna | PASS | Chrome: alta de Acto ofrece sólo Jurisdicción/Institución (0 opciones Notaría). API real: nuevo selector NOTARIA devuelve 409 read-only. Excepciones legacy siguen resolviéndose sin reescribir historia. CFG-002 usa Organization. |
| TN12 | Una notaría por tenant | Finanzas/Cartera sin columna/filtro | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| TN13 | Una notaría por tenant | Facturación permite FiscalEntities sin módulo Notarías | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| TN14 | Una notaría por tenant | Biblioteca aranceles por tenant | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| TN15 | Una notaría por tenant | Agenda/Archivo/Reportes no exigen notariaId | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| TN16 | Una notaría por tenant | API forged notariaId no escala | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| TN17 | Una notaría por tenant | Tenant A/B sin fugas | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| TN18 | Una notaría por tenant | flujo E2E Prospect→Quote→EXP sin selección extra. | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP01 | Carga universal | causa raíz 100 KB documentada o histórico ya arreglado | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP02 | Carga universal | 50KB | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP03 | Carga universal | 100KB | NOT VERIFIED | Parcial: Chrome `upload-network-retry-local.spec.ts` cargó 102400 bytes en Expediente tras corte de red; DB y Storage local concuerdan en SHA-256. Faltan los demás destinos para certificar universalidad. |
| UP04 | Carga universal | 500KB | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP05 | Carga universal | 1MB | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP06 | Carga universal | 5MB | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP07 | Carga universal | 10MB | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP08 | Carga universal | 25MB | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP09 | Carga universal | 50MB | NOT VERIFIED | Parcial: Chrome `upload-network-retry-local.spec.ts` cargó 52428800 bytes en Expediente; vínculo tras reload y SHA-256 físico igual a DB. Faltan los demás destinos para certificar universalidad. |
| UP10 | Carga universal | >limit rechazo explícito | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP11 | Carga universal | PDF | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP12 | Carga universal | DOCX/DOC real donde soportado | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP13 | Carga universal | PNG/JPG | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP14 | Carga universal | XLSX | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP15 | Carga universal | ZIP | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP16 | Carga universal | RAR real donde permitido | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP17 | Carga universal | TXT/XML según contexto | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP18 | Carga universal | 10 cargas consecutivas misma sesión | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP19 | Carga universal | multiupload independiente | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP20 | Carga universal | fallo de uno no colapsa batch | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP21 | Carga universal | carga→DB→reload→viewer→download→SHA | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP22 | Carga universal | OCR error no borra archivo | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP23 | Carga universal | retry processing sin resubir | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP24 | Carga universal | storage-success/DB-fail compensado | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP25 | Carga universal | DB-success/storage-fail no falso success | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP26 | Carga universal | límites coherentes UI/API/proxy/storage | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP27 | Carga universal | tenant/RBAC IDOR directo | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP28 | Carga universal | rutas/ZIP bomb/XXE | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP29 | Carga universal | signed URL expiración/revocación | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP30 | Carga universal | storage quota + reservation concurrente | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| UP31 | Carga universal | responsive, progreso y mensajes precisos. Registrar diferencias locales vs hosting productivo NOT VERIFIED. | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD01 | Expedientes, comparecientes, predios y explorador | 100 % persiste en acto/resumen | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD02 | Expedientes, comparecientes, predios y explorador | 60+40 | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD03 | Expedientes, comparecientes, predios y explorador | agrupación Carácter Acto | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD04 | Expedientes, comparecientes, predios y explorador | otro acto no contamina | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD05 | Expedientes, comparecientes, predios y explorador | 80 % advierte 20 % cuando requiere 100 % | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD06 | Expedientes, comparecientes, predios y explorador | no regla 100 % inventada | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD07 | Expedientes, comparecientes, predios y explorador | guardar incompleto permitido | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD08 | Expedientes, comparecientes, predios y explorador | tarjetas compactas accesibles | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD09 | Expedientes, comparecientes, predios y explorador | ficha Predio tenant-master reusable | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD10 | Expedientes, comparecientes, predios y explorador | datos catastrales/registrales y valores | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD11 | Expedientes, comparecientes, predios y explorador | docs propios Predio | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD12 | Expedientes, comparecientes, predios y explorador | viewer/download/version | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD13 | Expedientes, comparecientes, predios y explorador | extracción real con fuente y confianza | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD14 | Expedientes, comparecientes, predios y explorador | conflictos review sin sobrescribir confirmado | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD15 | Expedientes, comparecientes, predios y explorador | descripción literal no parafraseada | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD16 | Expedientes, comparecientes, predios y explorador | navegación creación contextual y seleccionado | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD17 | Expedientes, comparecientes, predios y explorador | dos EXP enlazan un Predio sin duplicar blob | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD18 | Expedientes, comparecientes, predios y explorador | ZIP anidado import con estructura | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD19 | Expedientes, comparecientes, predios y explorador | RAR anidado import real | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD20 | Expedientes, comparecientes, predios y explorador | traversal/corrupción reporta parcial con importados/omitidos/fallidos | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD21 | Expedientes, comparecientes, predios y explorador | Importar carpeta navegador compatible | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD22 | Expedientes, comparecientes, predios y explorador | fallback justificado si navegador incompatible | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD23 | Expedientes, comparecientes, predios y explorador | +Carpeta/renombrar/padre/eliminar seguros | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD24 | Expedientes, comparecientes, predios y explorador | ZIP completo respeta nombres/subcarpetas y acceso | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD25 | Expedientes, comparecientes, predios y explorador | Proyección lee datos sin nueva lógica | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD26 | Expedientes, comparecientes, predios y explorador | tenant A/B and object access | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| EXD27 | Expedientes, comparecientes, predios y explorador | reload/restart persistence. | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ01 | Biblioteca y cotización | official/internal separadas | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ02 | Biblioteca y cotización | metadata completa | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ03 | Biblioteca y cotización | jurisdicción jerárquica | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ04 | Biblioteca y cotización | un Acto ≠ copias por estado | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ05 | Biblioteca y cotización | fecha de vigencia | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ06 | Biblioteca y cotización | fuente histórico a fecha X | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ07 | Biblioteca y cotización | upload manual PDF/DOCX/TXT | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ08 | Biblioteca y cotización | XLSX/CSV arancel | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ09 | Biblioteca y cotización | imagen OCR | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ10 | Biblioteca y cotización | URL oficial con verificación/no fake | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ11 | Biblioteca y cotización | draft/revisión/aprobación | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ12 | Biblioteca y cotización | version history replace | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ13 | Biblioteca y cotización | fuente V2 cambia nuevas no antiguas | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ14 | Biblioteca y cotización | materia/etiquetas | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ15 | Biblioteca y cotización | búsqueda filtros | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ16 | Biblioteca y cotización | artículo/versión/VER FUNDAMENTO | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ17 | Biblioteca y cotización | tenant internal isolation | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ18 | Biblioteca y cotización | RAG filtros previos estado/fecha | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ19 | Biblioteca y cotización | valor operación Prospect | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ20 | Biblioteca y cotización | Quote hereda | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ21 | Biblioteca y cotización | EXP hereda | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ22 | Biblioteca y cotización | diferencias catastral/fiscal/avalúo/operación | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ23 | Biblioteca y cotización | predio propone jurisdicción editable | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ24 | Biblioteca y cotización | tarifa interna rangos/porcentaje/fijo/fórmula/min/max | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ25 | Biblioteca y cotización | motor base/fórmula/fuente/fecha | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ26 | Biblioteca y cotización | Nayarit/Bahía test | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ27 | Biblioteca y cotización | Jalisco/Puerto Vallarta test | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ28 | Biblioteca y cotización | cambiar jurisdicción invalida conceptos | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ29 | Biblioteca y cotización | cambiar valor recalcula variables sin alterar fijos | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ30 | Biblioteca y cotización | IVA/ISR usa motores adecuados sin inventar | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ31 | Biblioteca y cotización | RPP/catastro/ISABI pendiente sin regla | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ32 | Biblioteca y cotización | 2 fuentes contradictorias review | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ33 | Biblioteca y cotización | recurso no propio vs honorarios | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ34 | Biblioteca y cotización | cotización V1/V2 snapshots | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ35 | Biblioteca y cotización | no texto inventado en fuente/no seeding de tasas | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| BJ36 | Biblioteca y cotización | flujo Prospect→Quote→EXP con detalle y fundamento persistidos. | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT01 | Cotizaciones y Word | resumen limpio | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT02 | Cotizaciones y Word | campos mínimos exactos | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT03 | Cotizaciones y Word | no Referencia/avalúo obligatorio | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT04 | Cotizaciones y Word | sin encabezados duplicados | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT05 | Cotizaciones y Word | precarga Prospect | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT06 | Cotizaciones y Word | captura faltantes contextual | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT07 | Cotizaciones y Word | documentos soporte | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT08 | Cotizaciones y Word | OCR propone/revisión | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT09 | Cotizaciones y Word | categorías honorarios/impuestos/otro | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT10 | Cotizaciones y Word | IVA honorarios 16 % en test | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT11 | Cotizaciones y Word | no IVA manual duplicado | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT12 | Cotizaciones y Word | cambio/agregado/eliminación honorario recalcula | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT13 | Cotizaciones y Word | otros gastos IVA no universal | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT14 | Cotizaciones y Word | totals 50k+8k+20k=78k | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT15 | Cotizaciones y Word | Word machote real inspeccionado | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT16 | Cotizaciones y Word | DOCX rellena EN SITIO datos | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT17 | Cotizaciones y Word | tablas 2+2+otro crecen adentro | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT18 | Cotizaciones y Word | formato/logos/header/bordes intactos | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT19 | Cotizaciones y Word | no segunda cotización apéndice | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT20 | Cotizaciones y Word | plantilla inválida falla explícita | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT21 | Cotizaciones y Word | wizard amplio y responsive | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT22 | Cotizaciones y Word | autocomplete nombre/RFC/CURP | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT23 | Cotizaciones y Word | alta contextual vuelve con ID seleccionado | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT24 | Cotizaciones y Word | wizard conserva datos | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT25 | Cotizaciones y Word | cliente principal por FK real | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT26 | Cotizaciones y Word | cambiar cliente sólo mediante selector | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT27 | Cotizaciones y Word | cliente principal ≠ rol jurídico | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT28 | Cotizaciones y Word | quote→EXP idempotente, datos/documentos/versiones/Word íntegros | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| QT29 | Cotizaciones y Word | stepper/estados/envío/aceptación/regresión. | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF01 | CFDI | extractor fiscal único | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF02 | CFDI | CSF Compareciente real | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF03 | CFDI | CSF FiscalEntity | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF04 | CFDI | CSF Proveedor real/anónima | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF05 | CFDI | RFC/nombre/CP | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF06 | CFDI | domicilio/fecha/obligaciones si presentes | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF07 | CFDI | TODOS regímenes | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF08 | CFDI | selección de régimen sin sobrescribir maestro | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF09 | CFDI | CSF guardada/view/download/replace/delete permitido | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF10 | CFDI | partial extraction/faltantes sin borrar | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF11 | CFDI | alta entidad fiscal corrige error | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF12 | CFDI | emisor reutilizable | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF13 | CFDI | CSD .cer/.key/password secreto | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF14 | CFDI | PAC config multi-adapter TEST/PROD | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF15 | CFDI | concepto fiscal catalog | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF16 | CFDI | público general como receptor no concepto | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF17 | CFDI | sugerencia concepto desde EXP | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF18 | CFDI | CFDI 4.0 campos autocargados | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF19 | CFDI | PUE/PPD/forma pago | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF20 | CFDI | IVA/retenciones/totales fiscales deterministas | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF21 | CFDI | IVA incluido vs base | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF22 | CFDI | nueva prefactura EXP/MOVIMIENTO/MANUAL | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF23 | CFDI | editor amplio | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF24 | CFDI | BORRADOR guarda/cierra/reabre | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF25 | CFDI | estados/transiciones | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF26 | CFDI | folio PRE/versiones sin factura extra | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF27 | CFDI | PDF real con leyenda no fiscal | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF28 | CFDI | plantilla única en CFG-002 | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF29 | CFDI | XML preliminar claramente no timbrado | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF30 | CFDI | regenerar v2 | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF31 | CFDI | PAC ausente timbrado deshabilitado sin UUID | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF32 | CFDI | facturación parcial y reserva sin overinvoice | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF33 | CFDI | prefactura→ingreso/EXP | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF34 | CFDI | factura real → XML/PDF y frozen snapshot sólo si PAC real | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF35 | CFDI | provider reusable fiscal/bancario opcional | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF36 | CFDI | permisos/tenant/secretos | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF37 | CFDI | double-save/race UUID/XML regression | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF38 | CFDI | estado después reload + documentos | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CF39 | CFDI | errores precisos/Chrome responsive. | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX01 | Transversales | Organización config→Quote/Word/CFDI emitter | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX02 | Transversales | Prospect con valor/municipio→Quote→EXP | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX03 | Transversales | Predio aporta jurisdicción y soporte | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX04 | Transversales | Biblioteca oficial vs interna→calcular→fundamento | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX05 | Transversales | cambiar Nayarit→Jalisco→invalidar/recalcular/versionar | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX06 | Transversales | presupuesto Honorarios/IVA→DOCX real | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX07 | Transversales | Wizard crear Compareciente→EXP cliente ID | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX08 | Transversales | EXP participant roles sumas→resumen | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX09 | Transversales | Predio ficha→docs→extracción→Proyección lectura | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX10 | Transversales | ZIP/RAR explorer→ZIP completo hash | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX11 | Transversales | cotización documentos→UploadProvider→reload | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX12 | Transversales | Quote aceptada→EXP→Finance | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX13 | Transversales | ingreso facturable→prefactura→PDF PRAVIA→versionado | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX14 | Transversales | receptor CSF múltiple régimen→snapshot | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX15 | Transversales | proveedor CSF→reutilización | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX16 | Transversales | entidad fiscal→CSD/PAC not configured | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX17 | Transversales | quote IVA honorarios vs CFDI fiscal distinta semántica | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX18 | Transversales | storage at quota no rompe lectura | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX19 | Transversales | AI wallet cero bloquea IA pero no documentos/manual | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX20 | Transversales | tenant B no consulta sources/Quote/EXP/fiscal docs de A | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX21 | Transversales | cambio permiso revoca signed URL/read | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX22 | Transversales | reload/backend restart datos persisten | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX23 | Transversales | no lectura de 26 originales QA no localizados ni borrado | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| CX24 | Transversales | no nuevas rutas IA bypass y sin doble ledger consumo. | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ01 | Seguridad y calidad | role/tenant/object access | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ02 | Seguridad y calidad | cross-tenant A/B all APIs | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ03 | Seguridad y calidad | direct unauthorized document | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ04 | Seguridad y calidad | signed URL expiry/revocation | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ05 | Seguridad y calidad | private CSF/CSD | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ06 | Seguridad y calidad | password/API key leakage 0 | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ07 | Seguridad y calidad | uploads malicious archive/XML | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ08 | Seguridad y calidad | prompt injection en legal docs/CSF | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ09 | Seguridad y calidad | no data past tenant RAG | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ10 | Seguridad y calidad | stale plan/quote version | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ11 | Seguridad y calidad | concurrent draft/billing reservations | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ12 | Seguridad y calidad | no double Quote→EXP | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ13 | Seguridad y calidad | no fake PAC/UUID | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ14 | Seguridad y calidad | no leyes/valores inventados | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ15 | Seguridad y calidad | no lost originals | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ16 | Seguridad y calidad | no wallet overspend | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ17 | Seguridad y calidad | browser 1920/1440/1366/1024/768/390/320 | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ18 | Seguridad y calidad | keyboard/accessibility/no horizontal overflow | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ19 | Seguridad y calidad | no generic failures where code known | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ20 | Seguridad y calidad | no test.only/skip accidental | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ21 | Seguridad y calidad | no new public storage buckets | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |
| SQ22 | Seguridad y calidad | AuditLog actor/origen/fuentes/acciones sensitive. | NOT VERIFIED | Ejecutar caso y registrar evidencia reproducible. |

## Gates que no deben confundirse

- `LOCAL_GATE`: NO-GO hasta completar implementación, PostgreSQL/Storage local, Chrome E2E, cinco roles, seguridad y regresión.
- `PLATFORM_PRODUCTION_RELEASE_GATE`: BLOCKED por 26 binarios históricos aún no localizados, además de backup/restauración y validaciones productivas pendientes.
- PAC/CFDI real: NOT VERIFIED sin credenciales de prueba o productivas aprobadas; no simular UUID/timbrado.
- Upload de 50 MB en producción: NOT VERIFIED hasta comprobar proxy, backend y bucket reales.

## Dependencia nueva: extracción universal y Facturación Demo-Ready (27-10-2026)

La nueva orden maestra añade EXT01–EXT60 y exige completar FDR01–FDR90, 31 pasos Chrome y segunda auditoría antes de promover el conjunto. El inventario y matriz están en `PRAVIA_UNIVERSAL_DOCUMENT_EXTRACTION_INVENTORY.md` y `PRAVIA_UNIVERSAL_EXTRACTION_CERTIFICATION.md`. La corrección dirigida de CSF es evidencia parcial, no certifica extracción transversal, catálogos SAT ni OCR INE. **No cambia ningún PASS histórico de las seis correcciones, pero tampoco convierte el release global en PASS.** Staging y producción siguen sin autorizarse hasta gates verificables.
