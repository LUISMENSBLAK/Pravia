# PRAVIA OS Formatos Biblioteca Jurídica e ISR

## Estado del cierre local

Actualización posterior: el código de esta validación se publicó en `main`, Render y Netlify mediante `72972c9cb949f7cedeec246648585dce61bf0005`. La migración productiva y la configuración IA equivalente se completaron, con respaldo restaurado y comprobaciones productivas. El estado final de publicación está en [PRAVIA_PUBLICATION_20261126.md](PRAVIA_PUBLICATION_20261126.md); las referencias a «sin publicar» en este informe describen el corte local previo, no el estado posterior del rollout.

Las tres actualizaciones cuentan con implementación y pruebas locales sobre PostgreSQL aislado, API y Chrome. No se hizo commit, push, deploy ni cambio de configuración productiva. La rama sigue siendo `codex/release-pravia-20261028`, con HEAD `dedb7076077b15d2243486de8ca7e8145d4543cd`; se conservaron las modificaciones anteriores de extracción.

La evidencia funcional usa datos sintéticos y archivos marcados como QA sin validez. Los resultados de esta ronda no certifican todos los formatos bancarios reales, toda salida jurídica de IA ni el comportamiento de una configuración productiva distinta.

## Formatos por compareciente y expediente

El usuario autorizado selecciona manualmente un formato para cada compareciente vinculado o para el expediente completo. También puede seleccionar bancos e instituciones configurados. El listado de maestros institucionales depende de esas instituciones; no se crean bancos ni reglas normativas ficticias.

Guardar la aplicabilidad no genera documentos ni elimina obligaciones automáticas. Cada cambio exige motivo, versión vigente del expediente, permiso de escritura y auditoría. La selección manual no requiere inventar una regla CFG-002. Dos cambios simultáneos con el mismo snapshot no se sobrescriben: uno recibe conflicto de versión. El fallo de auditoría revierte selección, versión y materialización.

La generación individual consume sólo los datos actuales de esa persona y sus fuentes autorizadas. La generación general consume datos estructurados del mismo expediente, sus comparecientes, actos, predios e instituciones. El navegador no puede introducir IDs arbitrarios de documentos en ese contexto. Los datos ausentes permanecen pendientes y el resultado queda **PENDIENTE_REVISION**, no validado automáticamente.

Se probaron dos Word individuales, un Word general, un Word literal institucional y un PDF con campos de texto AcroForm. Las cinco generaciones funcionaron con llamadas reales a OpenAI cuando correspondía; los reintentos conservaron el mismo documento sin duplicarlo. Los maestros originales conservaron bytes y SHA-256. Retirar una selección conservó el documento previo y su lectura privada desde el historial.

Word admite variables y llenado dirigido sobre un maestro literal, conservando su estructura. PDF admite campos de texto rellenables; un PDF plano, un campo de firma o campos especiales sin mapeo se rechazan explícitamente. No se sustituye el formato por un resumen genérico. Las plantillas oficiales de Banorte, BIM o Bajío necesitan cargarse y homologarse por separado; el maestro institucional probado es sintético.

Chrome verificó selección independiente por sujeto, recarga, historial y guardado consecutivo de formatos e instituciones. Se corrigieron el desmontaje de los selectores al refrescar, la pérdida inmediata del aviso de guardado y la altura del selector de bancos. La comprobación geométrica se ejecutó a 1440, 1024, 768 y 390 px, esperando las transiciones; la captura móvil usa el contenedor de desplazamiento real.

## Biblioteca Jurídica

Administración puede cargar PDF, DOCX y TXT desde la Biblioteca y agregar versiones a una fuente existente. Se conserva el original privado, su hash, su referencia canónica de Storage, el texto recuperado y la auditoría. La carga queda pendiente; no acredita autenticidad ni activa conocimiento jurídico por sí sola.

La revisión permite abrir el original, cotejar el texto, indicar vigencia y verificar mediante acción autorizada. Fechas inexistentes y fuentes inactivas no se verifican. Un PDF sin texto se conserva pendiente; necesita una transcripción revisada en una nueva versión antes de utilizarlo como fundamento. Esta carga no incorpora OCR automático ni convierte un escaneo vacío en texto ficticio. La API limita el archivo a 50 MiB, el PDF a 1500 páginas y el texto a cinco millones de caracteres; esta ronda no prueba una subida de 50 MiB ni modifica el límite del bucket productivo.

La recuperación de normas exige organización, estado verificado y vigencia de la versión para la fecha consultada. Los criterios internos revisados y aprobados se entregan por separado, identificados como criterios internos y no como normas. El búho consume ese paquete y sus referencias. Proyección ya utiliza el mismo recuperador en su revisión jurídica; Cotizaciones ahora conserva el paquete en la evidencia de su propuesta, sin inventar impuestos ni cambiar automáticamente el presupuesto.

La prueba física verificó original descargable e idéntico, carga pendiente excluida de consultas jurídicas, inclusión tras revisión, versiones concurrentes distintas, auditoría y rechazo de otro tenant. Chrome completó carga nativa, revisión y recarga; una consulta natural al búho obtuvo el contenido de la fuente sintética verificada, sin altas ni movimientos no solicitados. Una prueba unitaria adicional comprobó el paquete de Cotizaciones y la ausencia de aplicación automática. Esta ronda no repitió una proyección jurídica completa contra OpenAI ni una generación completa de Cotización en PostgreSQL.

La verificación se serializa por fuente y organización. Dos versiones con la misma fecha inicial no se activan simultáneamente; se rechaza una vigencia igual o anterior a otra ya verificada para evitar solapamientos. El reintento de una verificación idéntica no genera otra auditoría, y un fallo de auditoría revierte el cierre anterior y la nueva activación. Las consultas históricas conservan la versión que correspondía a su fecha. Una homologación retroactiva fuera de orden requiere revisión expresa: se bloquea, no reescribe históricos. Las fechas de consulta inexistentes o mal formadas también se rechazan.

## Caso de ISR solicitado

El motor ya contenía el mínimo fiscal y el acreditamiento estatal; no se reemplazó por un resultado fijo. Se añadieron regresiones para enajenación el 11 y el 23 de noviembre de 2026, con adquisición del 26 de mayo de 2025. La prueba física conservó el costo histórico de $2,034.65 y utilizó explícitamente la opción de factores de Anexo 9 del entorno QA; no inventó un INPC faltante.

| Concepto | Importe MXN |
| --- | ---: |
| Enajenación y avalúo | 746,130.00 |
| Costo deducible mínimo aplicado | 74,613.00 |
| Ganancia fiscal | 671,517.00 |
| ISR provisional artículo 126 | 126,288.13 |
| Parte estatal artículo 127 | 33,575.85 |
| Remanente federal | 92,712.28 |

El mínimo corresponde al [artículo 121 de la LISR](https://wwwmat.sat.gob.mx/articulo/31968/articulo-121); el procedimiento considera los años transcurridos conforme al [artículo 126](https://wwwmat.sat.gob.mx/articulo/18353/articulo-126). La tarifa usada corresponde al apartado A.I del [Anexo 8 de la RMF 2026](https://sidof.segob.gob.mx/notas/docFuente/5777219). El [artículo 127](https://wwwmat.sat.gob.mx/articulo/32168/articulo-127) establece el acreditamiento del pago estatal: no se suman otros $33,575.85 al ISR total. La opción de actualización se referencia en la [regla 3.15.1](https://wwwmat.sat.gob.mx/articulo/57681/regla-3.15.1) y el [Anexo 9 publicado en 2026](https://sat.gob.mx/minisitio/NormatividadRMFyRGCE/documentos2026/rmf/anexos/Anexo-9-RMF-2026_DOF-17072026.pdf).

API y PostgreSQL conservaron el resultado y el reintento devolvió la misma versión. Este caso no sustituye la revisión fiscal de todas las operaciones, exenciones y reglas territoriales.

## Pruebas y evidencia

Evidencia privada local en `/tmp/pravia-formats-library.jXeVhg`, fuera de Git. Los logs no se sustituyen por declaraciones de éxito.

| Comprobación | Resultado | Evidencia |
| --- | --- | --- |
| Backend general | 239 archivos; 2803 PASS y 7 omitidas por dependencias físicas | `backend-certified.log` |
| Dependencias físicas | 44 de 44 PASS; incluye las siete omitidas y 37 repeticiones, no se suman como pruebas nuevas | `physical.log` |
| Frontend general | 78 archivos; 615 de 615 PASS | `frontend-certified.log` |
| PostgreSQL de chat y propuestas ISR | 11 de 11 PASS | `postgresql.log` |
| PostgreSQL de selección manual | 5 de 5 PASS, incluidos concurrencia y rollback por fallo de auditoría | `manual-postgresql.log` |
| PostgreSQL de vigencias jurídicas | 4 de 4 PASS, incluidos concurrencia, fecha histórica, reintento y rollback por fallo de auditoría | `knowledge-validity-postgresql.log` |
| Formatos con generación real | Cinco documentos, aislamiento individual, estado de revisión, SHA e idempotencia | `api-final.log`, `generated.json` |
| Biblioteca y almacenamiento | Carga, versiones concurrentes, lectura privada, verificación y aislamiento PASS sobre el backend actualizado | `knowledge-certified.log` |
| Chrome de Biblioteca y búho | Tres fases PASS, con consulta real al modelo | `browser-fixed.log` |
| Chrome final de formatos | PASS a cuatro anchos, guardado consecutivo y cero errores JavaScript | `final-browser-certified.log` |
| Maestros originales | Cuatro originales idénticos | `final-browser-certified.log` |
| ISR físico | Resultado y persistencia PASS | `isr.log` |
| Compilación | Backend TypeScript y frontend TypeScript/Vite, salida 0 | `backend-build-certified.log`, `frontend-build-certified.log` |
| PostgreSQL local | 136 migraciones registradas; nueva columna nullable acreditada | `database-final.log` |
| Secretos | 2138 archivos revisados, cero hallazgos | `secrets-final-report.log` |

Los primeros intentos también se conservan: una referencia estructurada anidada del formato general fue rechazada y motivó un enumerador cerrado de referencias válidas; el ensayo de Biblioteca necesitó una cuenta QA con permisos de configuración, sin ampliar permisos de usuarios existentes. El primer fixture de concurrencia incumplía la forma física de contenido del catálogo y se corrigió, sin retirar la restricción. El fixture de vigencias necesitó la membresía organizacional que exige el trigger real de aislamiento; no se deshabilitó ese trigger. La prueba del paquete de Cotizaciones esperaba un número donde el contrato serializa dinero decimal como texto; se corrigió la expectativa a `0.00`, no el contrato financiero. Las capturas iniciales durante la animación de cambio de ancho no se usaron como certificación visual final.

## Migración y publicación

La migración `20261126000000_exp006_manual_selection` permite `regla_id` nulo en pendientes seleccionados manualmente. Sólo se aplicó en PostgreSQL QA local; no elimina, renumera ni sobrescribe registros. Los 26 objetos históricos pendientes de recuperación no se tocaron, ni sus referencias. Tampoco se modificaron PAC, timbrado, certificados ni claves privadas.

**No hay publicación productiva en esta ronda.** Antes de desplegar se mantienen los gates generales de respaldo restaurable, configuración IA equivalente a la probada, CI y smoke productivo. La ruta local para generación operativa usa el modelo mini ya existente con Gateway y controles de saldo; no se habilitó silenciosamente esa ruta en producción.

El rollback de código requiere una versión compatible con `regla_id` nullable. Una versión antigua de Prisma puede fallar al leer nuevos pendientes manuales; volver a imponer NOT NULL no es seguro mientras existan esas filas. No deben borrarse selecciones ni inventarse reglas para forzar una reversión. El procedimiento productivo debe contar con código de recuperación compatible y un respaldo restaurable antes del rollout.

El detalle anterior de extracción compartida permanece en `PRAVIA_EXTRACTION_REVALIDATION_20261125.md`; sus límites y comprobaciones no se sustituyen por esta ronda.
