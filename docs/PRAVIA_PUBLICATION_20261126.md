# Publicación productiva de PRAVIA 26 noviembre 2026

## Resultado

El código funcional `72972c9cb949f7cedeec246648585dce61bf0005` quedó en `main` por avance directo y se publicó en los servicios existentes. No se reescribió el historial de Git ni se crearon proyectos, proveedores, buckets o servicios de pago.

| Componente | Estado verificado |
| --- | --- |
| GitHub | Rama de release y main contienen el commit funcional. CI de release [45870661423](https://github.com/LUISMENSBLAK/Pravia/actions/runs/45870661423) y de main [45891179298](https://github.com/LUISMENSBLAK/Pravia/actions/runs/45891179298): cuatro jobs PASS en ambos. |
| Render pravia-api | DESPLEGADO. Commit `72972c9`, deploy `dep-dc49frt6e07s73eih9n0`, panel «Deploy succeeded / Live». Se conservaron Docker, raíz backend, rama main, health `/health` y auto-deploy Off. |
| Netlify pravianetwork | DESPLEGADO. Commit `72972c9`, deploy `6b0896344e7bbe268130f53a`, panel «Published deploy». La publicación automática original se restableció tras el bloqueo temporal de coordinación. |
| Supabase NOTARYPROY | CONECTADO. Proyecto `mkiwijbampubccrpvgga`, pooler oficial con TLS verificado, DB y Storage cloud. SUPABASE_URL de Render cotejada con el mismo proyecto. |
| Migraciones | 136 de 136 canónicas aplicadas, cero pendientes, cero checksums divergentes y cero fallidas. Se conserva el baseline histórico adicional. |
| Backend público | https://pravia-api.onrender.com |
| Frontend público | https://pravianetwork.netlify.app |
| Chrome productivo | 38 de 38 controles PASS con el código publicado; API autenticada adicional 29 de 29 PASS. No son controles independientes que deban sumarse como una certificación global. |

La URL pública del frontend y el permalink del deploy sirven el mismo paquete `index-B_eNQ1bk.js`. El commit documental que incorpora este reporte no modifica ese código desplegado.

## Respaldo migración y recuperación

Se obtuvo un respaldo privado actual de PostgreSQL de **3,725,145 bytes**, SHA-256 `f505a3ce4984c6231f997041313c02f876c1b26d5ff8a7bc2d2171f8ea3b9a11`. Incluye los esquemas pravia_os, auth, storage y public, sin propietarios ni privilegios. Se restauró en una base local nueva y aislada, preparando la extensión pg_trgm y los roles NOLOGIN que requieren las políticas; no se omitieron tablas, datos ni políticas para obtener el PASS.

La restauración conservó 14 expedientes, 38 cotizaciones, 184 documentos, 7 CFDI y una organización. La única migración pendiente, `20261126000000_exp006_manual_selection`, pasó primero sobre esa copia y después en producción. Sólo permite regla_id nulo para la selección manual; no borra, renumera ni actualiza registros existentes. La comprobación inmediatamente posterior conservó conteos y digest de referencias documentales.

Se preparó una rama de recuperación `codex/rollback-pravia-20261126`, commit `b43d6fea501a327018149c3509096b55e138014f`, basada en el backend anterior `d34f7ef`. Incluye cliente compatible con regla_id nullable, conserva selecciones manuales al reconciliar y bloquea su edición durante recuperación, permitiendo leer documentos conservados. Build, 89 pruebas de contrato y prueba física sobre filas manuales QA: PASS. Su [CI 45873474854](https://github.com/LUISMENSBLAK/Pravia/actions/runs/45873474854) también pasó. No se ejecutó rollback sobre producción porque no se presentó un fallo crítico del rollout.

No es seguro usar el backend antiguo sin esa compatibilidad después de crear selecciones manuales. Tampoco se debe imponer NOT NULL, borrar filas ni inventar reglas para forzar una reversión. El respaldo es una copia previa al rollout, no una copia continua de nuevas escrituras. Restaurarlo directamente sobre producción perdería cambios posteriores y no forma parte de este procedimiento.

El respaldo PostgreSQL contiene metadatos de Storage, no todos sus binarios. Los 26 objetos históricos ausentes siguen sin recuperarse. No se afirma recuperación integral de esos archivos ni se alteraron sus referencias. El bucket existente continúa privado, con límite 52,428,800 bytes. Este rollout no homologa una subida física de 50 MiB en todos los formularios.

## Configuración IA publicada

Se compararon catálogo, modelos y rutas productivos antes de publicar. La extracción documental y de Predios aún usaban nano; Formatos operativos y lectura financiera no tenían una operación activa. Se configuraron las cuatro operaciones con el mini ya registrado `gpt-5.4-mini-2026-03-17`, mediante nuevas versiones de ruta y auditoría de plataforma, sin proveedor nuevo ni claves en Git.

Se conservaron CUSTOMER_WALLET, permisos ia.execute, reserva atómica, precios unitarios y margen aprobados. No se recargó saldo. Las reservas máximas se recalcularon con el snapshot económico existente, no con tarifas inventadas: 42.98 MXN para extracción documental, formatos y lectura financiera; 38.74 MXN para Predios. Esas cantidades son techos de reserva, no cobros fijos por cada lectura. El cambio de nano a mini sí puede aumentar el coste real de una llamada. La facturación continúa calculándose desde uso y tarifa configurada; no se afirma una actualización de precio de mercado o FX al día.

Chat, revisión jurídica, planificación de Proyecto e interpretación ISR mantienen sus contratos y rutas previas. No se habilitaron otras operaciones ni PAC real. La configuración se registró con la traza `PRAVIA-RELEASE-20261126-72972c9`; existe snapshot privado previo de catálogo, rutas y SKU para recuperación.

## Comprobaciones productivas

API autenticada: login y lectura de Prospectos, Cotizaciones, Expedientes, Comparecientes, Predios, Archivo, Agenda, Finanzas, cartera, entidades/conceptos/documentos fiscales, Reportes, chats/herramientas y Biblioteca. Rutas nuevas de selección e instituciones responden sobre un expediente autorizado. Platform Admin permanece denegado a Dirección, un expediente inexistente no se expone y una fecha jurídica imposible se rechaza con error controlado. El estado fiscal confirma que PAC real no está habilitado.

Chrome real: login, renovación, recarga y navegación de once módulos; selección manual de formatos y bancos; carga nativa de TXT sintético jurídico como PENDIENTE, descarga idéntica por SHA-256, recarga y exclusión de la fuente pendiente del conocimiento jurídico. Ninguna fuente sintética se verificó como norma en producción. Se conservan las dos cargas QA identificadas y pendientes, no se borró evidencia.

En el chat se subieron PDF y JPEG sintéticos. La foto contiene ligera inclinación, sombra y compresión; no sustituye el banco de fotos reales y degradadas de la validación previa. La respuesta real de OpenAI recuperó nombre y correo, los adjuntos salieron del composer y la petición larga fue directamente al Render existente. La reserva/uso registró mini real, incluidos varios pases documentales; no se reutilizó una respuesta simulada. Una orden natural creó una cotización identificada como QA sin Prospecto ni cobro, ofreció «Ver cambios» y permitió leerla después. Una conversación nueva rechazó la receta ajena a PRAVIA. Cinco anchos, de 1440 a 320 px, no desbordaron y no hubo errores JavaScript.

La primera ejecución del harness mantuvo el JWT anterior después de la renovación, y una segunda buscó el código de inventario en minúsculas aunque el contrato lo normaliza a mayúsculas. Se corrigieron las expectativas y la gestión del token de la prueba, no la aplicación. Los intentos se conservan y no se cuentan como recorridos aprobados. La repetición completa terminó 38 de 38 PASS. El panel de Netlify tuvo además un error transitorio; tras recargar se verificó el deploy correcto antes de publicarlo.

La auditoría final verificó **184 de 184 referencias documentales anteriores sin cambios**, 14 expedientes, 7 comparecientes y 184 documentos canónicos. Las cotizaciones pasaron de 38 a 39 por la orden QA expresamente ejecutada. Los adjuntos privados y fuentes jurídicas QA tienen sus propios registros; no son documentos canónicos nuevos. No se timbró, pagó ni movieron fondos como parte del smoke. El aislamiento entre organizaciones y usuarios de lectura se probó físicamente en QA; no se inventa una segunda organización productiva para afirmar que también se probó allí.

## Límites que permanecen

Las 2803 pruebas backend y 615 frontend, las pruebas físicas y la validación local del motor compartido están detalladas en [el cierre funcional](PRAVIA_FORMATOS_BIBLIOTECA_ISR_20261126.md) y [la revalidación documental](PRAVIA_EXTRACTION_REVALIDATION_20261125.md). El deploy no convierte en aprobaciones las dependencias jurídicas o fiscales pendientes.

Formatos bancarios oficiales necesitan sus maestros y homologación; PDF plano o campos especiales sin mapeo no se declaran rellenados. La Biblioteca exige fuentes y vigencia revisadas y un escaneo sin texto requiere transcripción revisada. No se certificó aquí una nueva proyección jurídica completa ni todas las ramas ISR con datos reales. OCR y modelos pueden equivocarse: se mantiene revisión humana, trazabilidad y confirmación de cambios. Facturama sandbox tiene evidencia previa; timbrado real, REP y complementos no quedan certificados por este rollout.

No se tocaron FIEL, certificados ni archivos privados empresariales. Las credenciales no forman parte del reporte. Evidencia privada del rollout en `/tmp/pravia-deploy-20261126.ofEXm2`: backup/restore, migración, recuperación compatible, configuración IA, API, Chrome y auditoría final. No se afirma que `/tmp` sea respaldo permanente fuera de este equipo.
