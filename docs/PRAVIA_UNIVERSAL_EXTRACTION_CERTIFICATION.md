# Extracción universal — matriz EXT01–EXT60

Estado: **NO CERTIFICADO / NO-GO**, 27-10-2026. Esta matriz se inicia con las pruebas efectivamente ejecutadas; `PARCIAL` no cuenta como PASS. Los PDF privados aportados por el cliente no se copian aquí y sus valores personales no se publican.

La procedencia por página y los regímenes descriptivos sin clave se conservan en `csf_extraction` JSON de Proveedor/Compareciente cuando existe confirmación. La CURP tiene parser PDF local determinístico, SHA, página, bloque y fragmento; la ficha existente conserva original/propuestas en PostgreSQL/Storage locales y muestra la revisión en Chrome con PDF **sintético**. El PDF CURP privado sólo se leyó en memoria local. Esto no equivale a extracción INE, verificación RENAPO ni certificación universal.

| ID | Criterio | Estado | Evidencia o brecha |
|---|---|---|---|
| EXT01 | Inventario de módulos | PARCIAL | Inventario inicial en `PRAVIA_UNIVERSAL_DOCUMENT_EXTRACTION_INVENTORY.md`; faltan Biblioteca, CFG-002 y migración detalladas. |
| EXT02 | Botones reales | NOT VERIFIED | Falta recorrido de todas las pantallas en Chrome. |
| EXT03 | Servicios canónicos | PARCIAL | Fiscal local y `openaiDocument`/Gateway identificados; no consolidados en una sola arquitectura. |
| EXT04 | Sin duplicados fiscales | NOT VERIFIED | Emisor no usa extractor CSF; comparación transversal pendiente. |
| EXT05 | Gateway sin bypass | NOT VERIFIED | Call sites incompletamente auditados. |
| EXT06 | Contratos por documento | PARCIAL | CURP PDF tiene contrato local `CURP_PDF_LAYOUT_V1` y propuestas persistidas; INE y demás tipos pendientes. |
| EXT07 | Ejecuciones persistidas | NOT VERIFIED | Falta cotejo por superficie. |
| EXT08 | Procedencia | PARCIAL | CSF local informa método/SHA y página real para campos detectados; faltan coordenadas/fragmentos, runs persistidos y demás módulos. |
| EXT09 | Tenant | PARCIAL | COL67 Chrome/API/PostgreSQL QA: tenant B recibió 403 al consultar Compareciente y CSF de A; faltan las demás superficies de extracción. |
| EXT10 | Privacidad | PARCIAL | PDF reales sólo en memoria local; no hay certificación integral de Storage/URLs. |
| EXT11 | CSF real cargada | PARCIAL | Chrome local cargó el PDF privado en el formulario de Proveedor y obtuvo HTTP 200; no se guardó el archivo en Storage ni el proveedor. |
| EXT12 | Ambas páginas CSF | PARCIAL | PDF de dos páginas con texto; parser leyó ambas y devuelve página 1 para RFC/nombre/CP y página 2 para el régimen descriptivo; falta flujo Storage/confirmación. |
| EXT13 | RFC CSF | PARCIAL | RFC sintético detectado de bytes PDF, confirmado desde UI de Compareciente y persistido con actor/procedencia en PostgreSQL QA; faltan las demás superficies y CSF auténtica autorizada. |
| EXT14 | Nombre CSF | PARCIAL | Detectado localmente tras microfix tabular; falta confirmación UI. |
| EXT15 | CURP y CP CSF | PARCIAL | Ambos presentes/detectados localmente; falta confirmación. |
| EXT16 | Domicilio CSF | PARCIAL | Componentes detectados; falta cotejo completo y persistencia. |
| EXT17 | Actividad/fechas | PARCIAL | Actividad económica tabular y fechas detectadas con página en PDF real local; persistencia/confirmación UI integral pendientes. |
| EXT18 | Régimen único | PARCIAL | Descripción/fecha detectadas, clave SAT no explícita: Chrome muestra revisión requerida, no selecciona una clave. |
| EXT19 | Multirégimen sintético | PARCIAL | Chrome/API/PostgreSQL/Storage QA: dos códigos sintéticos leídos de CSF privada y visibles tras reload; una sustitución conserva los anteriores y registra el tercero. Selección/confirmación de régimen y catálogo SAT siguen pendientes. |
| EXT20 | Confirmación/persistencia fiscal | PARCIAL | RFC de CSF sintética confirmado en UI y persistido con actor; lectura compartida, SHA y procedencia sobreviven a reload. No se confirmó un régimen ni se probó reutilización fiscal transversal en factura/Proveedor/Emisor. |
| EXT21 | CURP real PDF | PARCIAL | PDF privado leído localmente sin guardarlo; carga Chrome/Storage se probó con PDF sintético, no con el privado. |
| EXT22 | Texto CURP | PARCIAL | Parser espacial local extrae etiquetas/valores, página y bloque; test unitario y Chrome sintético. |
| EXT23 | CURP detectada | PARCIAL | Candidato validado sintácticamente, propuesto sin aplicar al maestro; no verificación RENAPO. |
| EXT24 | Nombre/apellidos CURP | PARCIAL | Nombre literal etiquetado extraído; apellidos no se separan porque el PDF no los etiqueta. Falta confirmación completa. |
| EXT25 | Folio/registro CURP | PARCIAL | Folio y entidad detectados por posición, persistidos como metadatos pendientes con página/fragmento en PostgreSQL QA sintético. |
| EXT26 | Fechas CURP | PARCIAL | Fecha de inscripción etiquetada normalizada; fecha de emisión ausente permanece null. |
| EXT27 | Ausentes no inventados | PARCIAL | Tests confirman apellidos y fecha de emisión null; falta cobertura universal de documentos. |
| EXT28 | Persistencia/confirmación CURP | PARCIAL | Chrome local sube PDF sintético categorizado CURP, muestra revisión y conserva archivo tras reload; PostgreSQL/Storage conserva propuestas y AuditLog. No se ha probado confirmación humana completa. |
| EXT29 | INE imagen PDF | PARCIAL | PDF de una página y cero caracteres de texto; OCR local intentado. |
| EXT30 | Anverso OCR | NOT VERIFIED | Tesseract local llegó a ~64/100. Apple Vision local, aplicado sólo en QA a la imagen superior aislada, reconoció 20 líneas con confianza media ~81/100 y etiquetas de identificación; aún falta extracción estructurada/revisión en la app, y Vision/macOS no es el runtime Linux de producción. |
| EXT31 | Reverso OCR | NOT VERIFIED | Tesseract y Apple Vision procesaron separadamente la imagen inferior; ninguna salida permitió acreditar los campos requeridos con fiabilidad. |
| EXT32 | Nombre INE | NOT VERIFIED | No detectado con fiabilidad. |
| EXT33 | Domicilio INE | NOT VERIFIED | No detectado con fiabilidad. |
| EXT34 | Identificadores electorales | NOT VERIFIED | No extraídos; no publicar datos sensibles. |
| EXT35 | Fechas/vigencia INE | NOT VERIFIED | No detectadas con fiabilidad. |
| EXT36 | Baja calidad → revisión | PARCIAL | Observación técnica de OCR baja confianza; falta estado UI/persistencia. |
| EXT37 | Datos sensibles fuera de logs | NOT VERIFIED | Auditoría global de logs pendiente. |
| EXT38 | Revisión humana INE | NOT VERIFIED | Falta E2E. |
| EXT39 | CURP entre documentos | NOT VERIFIED | Prueba local privada: Vision propuso un candidato de 18 caracteres en la imagen superior, pero **no coincidió** con la CURP del PDF separado; es conflicto que exige revisión, no fusión ni sobrescritura. Falta flujo UI/AuditLog. |
| EXT40 | Nombre entre documentos | NOT VERIFIED | Comparación autorizada no ejecutada. |
| EXT41 | Domicilios/diferencias | NOT VERIFIED | Comparación autorizada no ejecutada. |
| EXT42 | Conflictos | NOT VERIFIED | Sin prueba adversarial. |
| EXT43 | No sobrescritura | NOT VERIFIED | Sin prueba adversarial. |
| EXT44 | Procedencia cruzada | NOT VERIFIED | Sin modelo universal confirmado. |
| EXT45 | AuditLog confirmación | NOT VERIFIED | Sin E2E. |
| EXT46 | Estado SUBIENDO | NOT VERIFIED | UI de factura muestra estado; no todas las superficies. |
| EXT47 | Estado ALMACENADO | NOT VERIFIED | UI de factura muestra estado; no todas las superficies. |
| EXT48 | Estado EXTRAYENDO | NOT VERIFIED | UI de factura muestra estado; no todas las superficies. |
| EXT49 | Progreso honesto | PARCIAL | Mensajes por fase sin porcentaje ficticio en factura; pendiente transversal. |
| EXT50 | Cierre/reload | NOT VERIFIED | Falta prueba de extracción en proceso. |
| EXT51 | Retry sin duplicado | NOT VERIFIED | Falta prueba transversal. |
| EXT52 | Fallo IA conserva archivo | NOT VERIFIED | Implementación de factura indica conservación; falta E2E. |
| EXT53 | Revisión por campo | NOT VERIFIED | No certificada transversalmente. |
| EXT54 | Predios | NOT VERIFIED | Falta Chrome/DB/Storage. |
| EXT55 | Expedientes | NOT VERIFIED | Falta Chrome/DB/Storage. |
| EXT56 | Cotizaciones | NOT VERIFIED | Falta Chrome/DB/Storage. |
| EXT57 | Biblioteca Jurídica | NOT VERIFIED | Inventario detallado pendiente. |
| EXT58 | Facturación/Proveedor/Emisor | NOT VERIFIED | Emisor aún sin carga CSF canónica; faltan E2E. |
| EXT59 | Migración/otros | NOT VERIFIED | Inventario detallado pendiente. |
| EXT60 | Seguridad/regresión | NOT VERIFIED | Prueba dirigida CURP PostgreSQL/Storage y Chrome PASS; suites completas y seguridad transversal pendientes de este corte. |

**Conteo certificado EXT: 0/60 PASS.** El recorrido COL67 del 28-10 pasó 1/1 en Chrome/API/PostgreSQL/Storage QA para CSF sintética de Compareciente y fortaleció evidencia parcial de EXT09/13/19/20; no cubre la extracción universal. En particular, `OCR INE`, compatibilidad de clave SAT de CSF real, selección de régimen y reutilización transversal siguen sin certificarse. No hubo commit, push, staging ni producción en este corte.

Prueba privada adicional Chrome: login sintético en QA local, navegación a Facturación → Proveedores, carga de la CSF del cliente, endpoint de extracción HTTP 200 con método determinístico, estado `REVIEW_REQUIRED`, RFC/nombre/CP presentes, un régimen descriptivo y cero códigos SAT explícitos. La advertencia de revisión fue visible. **No se guardó la CSF ni se creó un proveedor**; no hubo screenshot, trace ni salida de valores personales.

Evidencia nueva CURP: test unitario del parser y de la ruta sin AI Gateway; prueba física 1/1 con fixture sintética en PostgreSQL/Storage locales (original, SHA, propuestas, página, fragmento, metadatos, AuditLog, sin modificación maestra, tenant ajeno denegado); Chrome real 1/1 con carga categorizada, revisión visible y reload. El mismo test comprobó selector accesible por foco y sin overflow horizontal a 390/320 px. El PDF CURP privado confirmó localmente la presencia de CURP/nombre/folio/entidad/fecha de inscripción sin publicar valores. No se presentó como verificación de identidad ni se remitió a proveedor IA externo.
