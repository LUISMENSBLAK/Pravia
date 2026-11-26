# Extracción documental y Comparecientes — revalidación 25–26/11/2026

## Alcance y publicación

Orden vigente: corregir y validar; **NO desplegar**. El punto de partida es `dedb7076077b15d2243486de8ca7e8145d4543cd`; los cambios de este informe permanecen locales. Sin push, migraciones ni modificación de configuración productiva. NOTARYPROY sólo se consultó en una transacción `READ ONLY`, mediante el pooler del mismo proyecto y TLS verificado. No se descargaron documentos privados desde producción. La ampliación del 26/11 utiliza exclusivamente los seis originales locales seleccionados y aportados por el usuario, con procesamiento OpenAI autorizado y persistencia sólo en QA local.

## Causa y correcciones

- La sesión productiva de ocho fuentes del 25/11 terminó FALLIDO después de una lectura OpenAI COMPLETED (17.061 ms). El código reutilizaba `trace_id` entre lotes y revisión ampliada, contrario al índice único tenant/traza. La regresión reproduce la colisión antes del cambio. Ahora cada adjunto/lote/lectura tiene una traza propia, estable y acotada por el Gateway existente.
- Una revisión ampliada fallida ya no descarta la primera lectura. Conserva incertidumbre, errores por fuente y posibilidad de reintento; no anuncia extracción completa.
- Segunda lectura con razonamiento `high` ante duda, discrepancia o fuente sin datos. Se mantiene el enrutamiento y límite económico versionados; se informa el modelo realmente devuelto, no se presume que el modelo solicitado fue el ejecutado.
- Perfil completo de Comparecientes: visión suplementaria de CURP PDF y de CSF parcial, sin romper el lector determinístico ni el modo local-only. Originales intactos, propuestas sin confirmación automática y CIC/OCR separados también en alta nueva. Conversión HEIC/HEIF acotada para análisis, preservando el original.
- Normalización explícita de espacios/caso en RFC/CURP, etiquetas conocidas de estado civil/régimen y fechas completas al formato del formulario, con conservación del literal. No se reparan caracteres ni se completan fechas parciales. Discrepancias reales permanecen para revisión.
- Una foto degradada produjo dos lecturas de CURP: una con una entidad de nacimiento estructuralmente imposible y otra compatible con el formato canónico. Sólo si una lectura independiente del MISMO campo y documento aporta un identificador estructuralmente válido se descarta la imposible; la lectura descartada se conserva en el borrador y no se modifican sus caracteres. Dos valores estructuralmente válidos distintos siguen en conflicto. Esto no es validación de existencia/vigencia ante RENAPO o SAT. Regresión en ambos órdenes de lectura: PASS.
- La captura manual tiene prioridad hasta una decisión explícita; los valores predeterminados de un alta nueva no se confunden con ediciones humanas. No se deduce autoridad emisora por el nombre del archivo ni se agrega un país ausente. Valores ambiguos permanecen visibles y requieren revisión antes de guardar.
- Chat documental: contenido general con referencias por archivo, además de identidad; permite leer importes y referencias que no pertenecen al esquema de Comparecientes. Caché versionada V2 para releer extracciones antiguas sin contenido; los adjuntos siguen siendo datos no confiables, nunca instrucciones ni autorización de movimientos. Se preservan discrepancias de transcripción.
- Rutas de creación ya no presentan `nuevo`/`nueva` como ID de un registro existente al chat. Se mantiene el contexto de origen autorizado.
- El [proxy Netlify limita las peticiones a 26 segundos](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/). Las operaciones IA largas reutilizan ahora la URL Render ya configurada para cargas, con Bearer, sin cookies cross-site y con los mismos controles de servidor. Login/refresh y escrituras ordinarias conservan el proxy original. No se agregó proveedor, servicio ni variable de despliegue. Preflight productivo de sólo lectura: 204, origen Netlify exacto y cabeceras Authorization/Content-Type/Idempotency-Key permitidas. Renovación 401 y destino de doce rutas cubiertos por 21 pruebas dirigidas de transporte/servicio: PASS.
- La revisión UI utiliza las pautas de `ui-styling`: etiquetas y avisos asociados, conservación del selector nativo y del diseño existente. No hubo rediseño.

## Evidencia y límites

Resultados de los pases finales. Las omisiones por dependencias físicas no se cuentan como PASS hasta su ejecución específica; tampoco se ocultan los intentos fallidos.

| Verificación | Evidencia local |
| --- | --- |
| Backend general | Último pase tras los originales: 236 archivos, **2749 PASS**; seis omitidas por dependencias físicas en ese comando. `/tmp/pravia-originals-qa.qDIOZ3/backend-full.log`. Incluye contexto íntegro de seis adjuntos, fechas, referencias naturales, metadato SHA y actividad trazable de CSF. No incluye la carpeta de integración en ese comando. |
| Dependencias físicas | **16/16 PASS**, tres archivos, sin omisiones, HEIC real sintético y LibreOffice configurado. Cubre las seis omisiones anteriores; no se suman las otras diez como pruebas distintas. `/tmp/pravia-originals-qa.qDIOZ3/physical.log` |
| Frontend general | Último pase: 75 archivos, **606/606 PASS**. `/tmp/pravia-originals-qa.qDIOZ3/frontend-full.log` |
| Integración PostgreSQL del chat | **4/4 PASS**, sin omisiones, en la QA local aislada: confirmación concurrente e idempotente, promoción atómica del original, rollback ante segundo adjunto inválido, permisos y recuperación tras fallo post-commit sin duplicar. `/tmp/pravia-originals-qa.qDIOZ3/assistant-postgres.log`. No usa proveedor simulado como evidencia de lectura documental; sólo verifica persistencia/acciones con datos sintéticos y sin llamadas IA. |
| Cambios finales dirigidos | Backend 30/30 y frontend 24/24 PASS, incluidos CIC/OCR, conservación manual, sustitución del valor predeterminado por evidencia y aviso/bloqueo de una etiqueta ambigua. Logs `extraction-directed-final` y `extraction-ui-directed-final` en `/tmp/pravia-nov25-*`. No se suman como pruebas distintas de la regresión general. |
| Compilación | Último pase tras todas las correcciones: **backend TypeScript y frontend TypeScript/Vite PASS**, códigos de salida 0. Logs `backend-build.log` y `frontend-build.log` en `/tmp/pravia-originals-qa.qDIOZ3`. Comprobación final del diff sin errores. |
| Chrome con OpenAI y backend directos | **2/2 PASS** en el estado final, `/tmp/pravia-nov26-extraction-chrome-final.log`. Ocho fuentes, cuatro llamadas completadas con trazas únicas, CURP correcta sin intervención humana en ese pase y 51.051 ms de recorrido. Se verifican valores visibles de nombres, apellidos, RFC/CURP, fecha, lugar/nacionalidad, ocupación, contacto, estado civil, régimen y tipo de identificación; borrador PostgreSQL sin creación automática; originales descargados idénticos por SHA-256. |
| Chat documental real | Dentro del segundo caso Chrome: foto con anticipo/referencia sin identidad, respuesta fiel y foto tapada sin fabricar datos ni reutilizar el comprobante anterior. Sin movimientos financieros ni alta de personas. URL de mensajes y extracción verificada en `http://127.0.0.1:3011/api`, origen frontend diferente, no sólo una prueba mock de transporte. |
| Límites de acceso directos | Cuatro solicitudes rechazadas con 403: extracción y lectura de archivo temporal por usuario de otro tenant y por usuario sólo lectura sin acceso a la sesión. Cero llamadas IA ejecutadas. `/tmp/pravia-nov25-extraction-boundaries.log`. |
| Ficha maestra existente + HEIC | **PASS** con HEIC sintético real y OpenAI: carga, extracción del nombre, comparación de TODA la PersonaFisica contra su snapshot previo sin cambios y descarga original idéntica por SHA-256. `/tmp/pravia-nov26-master-heic-verified.log`. Se creó una ficha QA explícitamente como preparación; la extracción no la creó ni modificó por su cuenta. El primer intento del harness comparaba con el texto de solicitud, antes de su normalización canónica a mayúsculas; se corrigió para comparar contra el estado realmente persistido. |
| Secretos | Último pase: **2123 archivos revisados, cero hallazgos**, `/tmp/pravia-originals-qa.qDIOZ3/secrets.log`. No se copiaron credenciales, documentos personales ni claves privadas al código o al frontend. |

Intentos previos registrados: colisión de traza y pérdida de primera lectura reproducidas como regresiones rojas; se corrigieron. Una prueba Chrome descubrió falso conflicto por espacios en CURP. Un arranque de QA antes de estar saludable devolvió 502. Los recorridos ejecutados durante las suites paralelas encontraron P2028 (transacción local de 5 s vencida bajo carga); no se aumentaron a ciegas los timeouts productivos. La repetición secuencial del estado final se registra separadamente.

Otros hallazgos de la prueba fotográfica real contra OpenAI: nombre completo tratado como nombre de pila entre lotes, CURP de formato imposible etiquetada como lectura clara y dependencia del proxy de 26 s. Fueron corregidos y no se contabilizan esos intentos como aprobados. La conciliación de nombres exige componentes separados ya acreditados; la comprobación estructural no confía exclusivamente en el nivel declarado por el modelo y provoca revisión ampliada. Si ninguna lectura válida queda acreditada, no llena el identificador y conserva el conflicto.

Fixtures claramente sintéticos, sin sellos ni validez oficial: fotos con inclinación, perspectiva, sombra y JPEG con calidad 43; PDFs rasterizados y Word. Un caso reproduce ocho documentos con la misma categoría de carga de la captura; otro comprueba un comprobante sin datos personales y una foto tapada. Se usa OpenAI real y PostgreSQL/Storage locales, no un proveedor simulado en esas pruebas Chrome.

### Ampliación del 26/11: seis originales reales aportados por el usuario

Se recibieron cinco PDF y un DOCX: diez páginas revisadas visualmente antes de comparar la salida IA. Incluyen acta y CSF rasterizadas sin texto seleccionable y un pasaporte escaneado de baja calidad; no se sustituyeron por PDFs sintéticos. Son los documentos suministrados en esta continuación, no se afirma haber reproducido los ocho archivos de otra persona que aparecen en la captura anterior.

Los originales, oráculo revisado, respuestas, capturas y logs con información personal permanecen fuera del repositorio, en el directorio privado `/tmp/pravia-originals-qa.qDIOZ3`. El informe conserva sólo resultados y nombres de campos. Cinco PDF y el DOCX de Downloads conservan sus SHA-256 iniciales. Las lecturas dudosas se revisaron contra las páginas, sin convertir la confianza del modelo en una prueba de identidad.

Hallazgos adicionales y correcciones:

- Fechas completas con espacios y mes español escrito se leían, pero no llegaban al control de fecha. Conversión explícita a ISO con comprobación de calendario y literal conservado; no se completa siglo, día o mes ausente ni se reparan caracteres OCR. La etiqueta «pasaporte mexicano» se concilia con el tipo canónico PASAPORTE; esto no resuelve números discrepantes.
- El chat analizaba los seis archivos, pero dos recortes independientes de 12.000 caracteres eliminaban las últimas fuentes y podían dejar JSON incompleto. Ahora cada adjunto tiene cuota independiente dentro de 48.000 caracteres, JSON válido y aviso explícito de recorte. Se incluyen domicilios, actividades y regímenes estructurados, además de campos y transcripción. Se distingue un aviso de ausencia en una fuente de una ausencia en el lote entero.
- «Los seis documentos que adjunté antes» no recuperaba los adjuntos previos. Se cubren cantidades y referencias naturales, siempre desde el último mensaje con adjuntos de la MISMA conversación privada y con comprobación de propietario/tenant. No se reutilizan documentos en consultas ajenas.
- La síntesis high de un lote extenso agotó dos salidas de 4.096 tokens. Se registra como fallo, no como PASS. Para contexto documental mayor de 12.000 caracteres se solicita ahora una salida acotada de 12.288 tokens; las consultas ordinarias siguen en 4.096 y el Gateway mantiene catálogo, reserva, tarifa y límite económico. No se cambió ninguna ruta/modelo, saldo ni configuración de producción.
- La CSF aportaba su actividad en la tabla estructurada pero no en el campo visible. La tabla ahora exige fuente documental y confianza; sólo actividades de un documento realmente enviado pueden proponer el campo `actividad_economica`. Se mantienen separadas de ocupación/giro, sin atribuir actividades del emisor ni adivinar fuente por el nombre del archivo. Múltiples actividades del mismo documento se conservan juntas.
- La confirmación integraba los bytes originales, pero omitía copiar el SHA-256 al registro definitivo. Se conserva ese metadato para nuevas integraciones sin reescribir Storage ni modificar documentos históricos. Comprobado además mediante alta sintética física, confirmación repetida idempotente, PostgreSQL y descarga original.

| Recorrido con fuentes reales | Resultado comprobado |
| --- | --- |
| Alta nueva en Chrome, API directa y PostgreSQL | Seis fuentes procesadas sin errores de lectura del lote; nombres, RFC, nacimiento, estado civil y correo cotejados; identificación y fechas canónicas. CURP y número de pasaporte con lecturas discrepantes se retienen para revisión, no se eligen silenciosamente. Borrador PENDIENTE_CONFIRMACION, sin alta automática. |
| Domicilios | Campos particular y fiscal cotejados por separado con sus fuentes; calle, números, colonia, CP, municipio y estado correctos. No se usa el domicilio del proveedor del recibo. |
| Confirmación revisada y recarga | API canónica tras revisión explícita; una sola ficha, auditoría de creación única, datos e identificación persistidos en PostgreSQL y visibles al recargar Chrome. Los seis originales descargados antes y después de la integración coinciden por SHA-256 con Downloads. |
| Chat con lote completo y seguimiento natural | Respuesta real de OpenAI con ambas direcciones, identidad, contacto, ocupación y fechas; seguimiento compara el número del anexo y el del escaneo con advertencia de duda. Recupera los seis adjuntos desde el historial sin otra extracción/cobro documental. Sin altas, cambios ni movimientos financieros solicitados por el contenido del documento. |
| Actividad económica en ficha existente | Segunda extracción real de las seis fuentes en Chrome: propuesta sustentada en la CSF escaneada, sin guardado automático ni alteración de identidad manual. Confirmación Guardar cambios, recarga y PostgreSQL: PASS. |
| Integridad de nuevas integraciones | Alta sintética física: hash definitivo, descarga idéntica, reintento sin duplicado y auditoría única: PASS. Los documentos de la primera confirmación QA, anterior a esta corrección de metadato, no se modificaron retroactivamente; sus bytes sí se comprobaron. |

Logs finales privados de los recorridos: `verified-browser.log` (alta y lectura de los seis originales), `finish-verified.log` (confirmación/recarga y respuesta con lote completo), `chat-followup.log` (número de identificación con comparación de fuentes), `activity.log` (extracción y guardado de actividad), `checksum.log` (integración nueva e idempotencia). En `finish-verified.log` la aserción del número no solicitado en esa respuesta es una expectativa adicional del harness, no un fallo de acceso a los documentos; el seguimiento explícito que sí pide ese número termina PASS. Los casos funcionales no se confunden con las pruebas unitarias que simulan el Gateway.

Los primeros intentos no se ocultan: formato de fecha rechazado, recorte del chat, referencia natural no reconocida, salida IA incompleta y omisión de actividad en campo visible. Hubo además incidencias del harness (esperar antes de salud del backend, Bearer de una sesión rotada y comparación del número de pasaporte en una respuesta que sólo pedía fechas); se corrigieron/aislaron y la lectura del número se probó con una petición explícita, sin introducir su valor esperado en el prompt. Las discrepancias OCR genuinas no se contabilizan como lectura inequívoca automática.

Una imagen realmente ilegible no garantiza recuperación. No se acredita autenticidad documental ni consulta ante RENAPO/SAT; se acredita propuesta, trazabilidad, revisión, persistencia e integridad del flujo.

Este pase es funcional/local. No sustituye una prueba de carga productiva, una homologación jurídica/fiscal global ni la recuperación de los objetos históricos pendientes. Los límites y permisos existentes de Storage, saldo IA, autenticación y confirmación de acciones permanecen vigentes. **Sin push ni deploy; producción conserva su versión anterior.**

## Segunda ampliación: extracción compartida — 26/11/2026

Petición: más pruebas sobre el motor reutilizado entre módulos, con fotos imperfectas y fuentes reales. Se conserva el trabajo anterior; esta sección es el estado más reciente. HEAD permanece en `dedb7076077b15d2243486de8ca7e8145d4543cd`, con correcciones locales sin publicar. No se ejecutaron migraciones, push, deploy ni cambios de configuración productiva. No se tocaron firmas, claves privadas ni timbrado.

### Defectos reproducidos y corregidos

- Predios reutilizaba una traza económica para varios documentos: el segundo resultado podía perderse aunque el endpoint respondiese 200. Ahora cada documento tiene su traza/idempotencia. La revisión equivalente corrigió las dos lecturas de Finanzas (general e importe) y cada comprobante H5. Regresiones comprueban las trazas distintas; no se confunde HTTP 200 con un lote completo.
- ISR usaba el esquema exclusivo de identidad y descartaba importes/fecha de enajenación. Su propósito documental tiene ahora un conjunto cerrado de campos ya admitidos por el flujo de propuestas; no amplía los campos de Comparecientes ni permite cálculos, verificaciones o escrituras arbitrarias. Fechas completas se normalizan sin completar datos ausentes.
- Un lote de dos personas podía omitir la segunda fuente. La revisión ampliada prioriza fuentes sin cobertura, conservando las lecturas anteriores y los conflictos. Alias de correo/teléfono se agrupan antes de conciliar para que una variante no oculte otra.
- Incluso una foto marcada CLARA por el modelo devolvió una referencia con O/Q errónea. El chat fotográfico ahora contrasta una segunda lectura acotada cuando la revisión ampliada está habilitada. Si discrepan, no elige silenciosamente. La caché documental pasa a V3 para no reutilizar automáticamente resultados antiguos de una sola lectura. Dos lecturas coincidentes tampoco demuestran exactitud universal.
- El modelo omitió el correo explícitamente etiquetado en un Word real. Se conserva adicionalmente el literal de párrafos nativos etiquetados como correo; si difiere de otra lectura, queda conflicto y procedencia, no sobrescritura.
- Valores de ausencia como N/A, NO APLICA y PENDIENTE DE INFORMACIÓN ya no se proponen como datos. Se conservan valores legítimos como una calle SIN NOMBRE o número S/N. Se reutiliza la misma regla en consolidación, Predios y campos financieros.
- Los lectores de Predios/Finanzas convierten HEIC/HEIF mediante el trabajador acotado existente y admiten imágenes WebP/GIF en el lector. Los bytes originales no se cambian. Se informa el modelo realmente usado por el Gateway, no solamente el solicitado.
- Salida incompleta, rechazo, vacío y JSON inválido tienen códigos seguros diferenciados. Si falla la revisión ampliada, se conserva la primera lectura, se comunica el estado parcial y no se convierte en éxito completo ni se filtra la respuesta técnica del proveedor.

### Pruebas funcionales adicionales

Evidencia privada en `/tmp/pravia-extraction-expanded.4C3MBN` (fuera de Git). Diez fotos sintéticas con inclinación, sombras y JPEG degradado; PDF de dos páginas sin texto seleccionable; archivo corrupto; seis originales del usuario. No se sustituyen los originales por fixtures ni se guardan valores personales en este informe.

| Caso | Resultado observado |
| --- | --- |
| Predios, dos fuentes complementarias | PASS: dos llamadas/linajes, propuesta sin aplicar, decisión explícita, guardado y recarga Chrome/PostgreSQL. Replay no consume otra llamada. `api.log`, `browser-mini.log`. |
| Predios, fuentes contradictorias | PASS: valores incompatibles retenidos, sin elegir ni guardar automáticamente. `api.log`. |
| Permisos de extracción | PASS: otro tenant y usuario sólo lectura rechazados antes del proveedor, cero llamadas IA. `api.log`. |
| Dos personas en el mismo lote | PASS: nombres, RFC y contactos discrepantes conservados como conflictos, sin alta automática. `api-mini.log`. |
| Instrucciones dentro del documento | PASS: se extraen datos, no se ejecutan órdenes incrustadas ni se crean registros o movimientos. `api-mini.log`, `browser-mini.log`. |
| Fotos ilegibles | PASS de comportamiento seguro: no se fabrican identidad, importe o referencias; no significa recuperación de texto tapado. `api.log`, `e2e-final.log`. |
| ISR, fotografía de soporte | PASS: operación, avalúo, catastro y fecha cotejados; sólo propuestas, sin cálculo fiscal ni modificación automática del input; replay cacheado. `api-mini.log`. |
| Finanzas, foto de recibo y dos totales incompatibles | PASS: importe correcto en el caso inequívoco; incompatibles retenidos para revisión. No se registra pago, movimiento ni documento definitivo por extraer. `api-mini.log`. |
| Chat con tres conversaciones nuevas | PASS: frases naturales, fotos de recibo/persona, cambio entre chats sin contaminación, adjuntos liberados tras enviar, sin altas ni dinero por el contenido. `browser-mini.log`. |
| Ocho fuentes y chat fotográfico en Chrome | 2/2 PASS con OpenAI real, API directa y PostgreSQL. Primer caso: ocho fuentes, tres llamadas, 39.090 ms de extracción; segundo: comprobante y foto tapada. `e2e-final.log`. |
| Escaneo de dos páginas | PASS: recupera datos presentes sólo en página dos. `scan.log`. |
| PDF corrupto | Rechazo HTTP 502 sin extracción ficticia ni alta automática. Es evidencia de rechazo seguro, no de experiencia de error ideal. `scan.log`. |
| CSF original escaneada | PASS: RFC/CP cotejados, regímenes textuales conservados, revisión requerida y ninguna invención de régimen; ruta OCR local sin llamada externa. `fiscal-real.log`. |
| Seis originales, repetición final | PASS de procesamiento y revisión: seis sin errores, identidad/contacto/fechas cotejados, CURP con alternativa correcta sustentada pero EN REVISIÓN, domicilios separados, ausencias no inventadas, descargas idénticas por SHA-256, ninguna ficha maestra creada automáticamente. `originals-coded.log`. No equivale a todos los campos inequívocos. |

### Configuración y resultados negativos conservados

La comparación del modelo ya existente `gpt-5.4-mini` se configuró mediante versiones **sólo en PostgreSQL QA local** para extracción documental, Predios y Finanzas. Se mantuvieron proveedor OpenAI, Gateway, reserva/saldo y precios de prueba; no se contrató servicio ni se recargó saldo. Finanzas no estaba habilitada en el catálogo local: el primer 409 AI_OPERATION_DISABLED se registra como fallo de configuración de QA, no como fallo del archivo. No se ha verificado ni cambiado aquí su configuración productiva.

El modelo nano erró un importe por un cero y el mini también erró una referencia O/Q. Los intentos FAIL no se borran ni se rebajan sus expectativas para aprobar: motivaron el contraste fotográfico y las comprobaciones posteriores. El primer recorrido Chrome de Predios encontró correctamente un conflicto que impedía aplicarlo; se mantuvo el bloqueo. Los seis originales tuvieron una omisión de correo y después un N/A indebido; ambos motivaron regresiones y correcciones. Una repetición posterior tuvo una revisión ampliada fallida, conservó la lectura inicial y comunicó PARCIAL; el siguiente pase completo terminó sin errores. Esto no garantiza disponibilidad infalible del proveedor.

Antes de publicar, cualquier ruta productiva debe compararse explícitamente con la configuración que se probó. **Un PASS con mini local no certifica que producción con otra ruta/modelo tenga la misma calidad.** No se han actualizado silenciosamente los parámetros productivos.

### Regresión final tras las correcciones

| Comprobación | Estado final |
| --- | --- |
| Backend general | **236 archivos, 2764 PASS, 7 omitidas por dependencias físicas**. `backend-final-suite.log`. La primera corrida encontró un contrato estático que buscaba el regex antiguo en Predios; se actualizó para verificar el filtro compartido y se repitió toda la suite. La regla de ausencia tiene además pruebas ejecutables. |
| Dependencias físicas | **44/44 PASS**, cuatro archivos; HEIC sintético real y LibreOffice. Incluye las siete omitidas anteriores y 37 pruebas repetidas, que NO se suman como nuevas. `physical.log`. |
| Frontend general | **75 archivos, 606/606 PASS**. `frontend-full.log`. |
| PostgreSQL físico | **11/11 PASS**, chat/adjuntos (4) y propuestas ISR (7): confirmación, concurrencia, idempotencia, rollback, tenant/permisos y conservación de versiones. Sólo QA aislada; no usa IA real para simular estas garantías transaccionales. `postgresql.log`. |
| Compilación | Backend TypeScript y frontend TypeScript/Vite PASS, salida 0. `backend-build.log`, `frontend-build.log`. |
| Secretos | **2123 archivos, cero hallazgos**. `secrets.log`. |
| Consumo QA | 62 eventos desde la reproducción inicial: 61 COMPLETED y 1 FAILED_COST_UNVERIFIED por error HTTP del proveedor. 61 débitos únicos; trazas únicas, saldo no negativo y conciliación con transacciones PASS. `ledger-final.log`. |

El ledger registra USD 0,549238 de coste reportado, **no un total externo íntegramente conciliado**: hay un intento con coste desconocido y la reproducción inicial de la colisión pudo perder el registro de otra respuesta. No se afirma que esos intentos costaron cero. FX y saldo de QA son sintéticos, no tarifas/cargos productivos certificados.

### Límites de esta ampliación

- La selección de archivos de cada módulo conserva su contrato. La prelectura de Finanzas aún limita su formulario/API a PDF/JPG/PNG/DOCX; mejorar el lector subyacente no habilita todas las extensiones en todos los botones. DOC legado y otros formatos no quedan certificados por esta ronda.
- La importación de presupuesto de Cotizaciones es un parser nativo de PDF de texto (aunque el nombre histórico del servicio sugiera IA). No queda certificada para PDF escaneado mediante estos PASS del motor compartido.
- La generación/revisión jurídica de Proyección es un flujo separado; esta ampliación no vuelve a certificar cada salida jurídica ni cada petición libre de proyección. H5 tiene regresión de trazas, no un nuevo recorrido completo contra proveedor real.
- OCR/modelo pueden equivocarse incluso declarando confianza alta. Se exige revisión de fuentes y confirmación para cambios; no se verifica autenticidad documental, identidad ante autoridades ni cálculo fiscal por leer una imagen.
- No se prueba aquí carga productiva ni se resuelven los 26 objetos históricos pendientes. No se alteraron sus referencias.

**Resultado: ampliación local completada con evidencia y límites explícitos. Sin push ni deploy; la calidad probada con mini permanece sólo en QA.**
