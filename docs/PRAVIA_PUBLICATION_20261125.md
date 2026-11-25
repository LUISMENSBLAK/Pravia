# Publicación técnica PRAVIA — 25 noviembre 2026

## Resultado observado

| Componente | Estado / evidencia |
| --- | --- |
| Render existente | DESPLEGADO, `d34f7efbf80368f84812ab6f3be0bab83e95aaaf`, deploy `dep-dc3b0dvavr4c73esoc90`; panel «Deploy succeeded / Live». Backend posterior de `28c6dc2` idéntico byte a byte en Git: ese último commit sólo cambia Agenda frontend, tests y documentación. |
| Netlify existente | DESPLEGADO, `28c6dc23f473b1234259c5940acb0344498301d1`, deploy `6b06b08a83642ca921a1e6cd`; panel «Published deploy». Bloqueo temporal retirado: «Lock to stop auto publishing», configuración automática original restablecida. |
| Git | Ambos commits promovidos a main por avance directo, sin force ni reescribir historial. CI exacto `45580059630` y `45589189261`: cuatro jobs PASS cada uno. |
| Supabase NOTARYPROY | CONECTADO. Proyecto existente `mkiwijbampubccrpvgga`, DB/Storage cloud; status Prisma por pooler con TLS verificado: 135/135 migraciones canónicas y schema actualizado. No se aplicaron migraciones nuevas por el último ajuste visual. |
| Frontend | https://pravianetwork.netlify.app |
| Backend | https://pravia-api.onrender.com |

## Verificación productiva, no sólo HTTP 200

Chrome real con la cuenta administradora expresamente autorizada: **44 controles PASS**. Login, recarga y Organization preservada; APIs de Prospectos, Cotizaciones, Expedientes, Comparecientes, Predios, Archivo, Agenda, Finanzas, cartera, entidades/conceptos/documentos fiscales, Reportes e historial/herramientas IA; navegación de módulos; acceso Platform Admin denegado; política 50 MiB; PAC productivo deshabilitado. PDF inequívocamente sintético subido al chat privado, extracción real OpenAI, adjunto retirado del composer, cotización canónica nueva sin Prospecto ni cobro, «Ver cambios» al registro real y rechazo de receta ajena al ámbito. Anchos 1440/1024/768/390/320 sin desbordamiento y cero errores de página. Se cerró únicamente la sesión de pruebas creada por el harness; la sesión del usuario en Safari se conservó.

Antes de publicar el frontend se ejecutó el mismo smoke contra la UI antigua: APIs y extracción pasaron, pero «Ver cambios» no existía allí. Ese intento NO se cuenta como PASS. La repetición posterior en el frontend publicado pasó completa. Los registros sintéticos se conservan identificados como QA; no se borró evidencia, no se aplicaron pagos ni se timbró en producción.

Agenda productiva: consulta real de indicadores y evento visible existente, **PASS en seis anchos** 1440/1366/1024/768/390/320. Punto amarillo encima del número, centrado y sin desbordamiento; calendario visible en móvil. No se creó ni modificó ningún evento para esta prueba productiva. Safari del usuario se recargó y mostró el punto sobre el 26 de noviembre en su evento visible; captura inspeccionada. La privacidad entre usuarios/Organizations, cancelación y expiración sin reload están acreditadas por el recorrido físico local, no se afirma una prueba productiva con otro tenant inexistente.

## Regresión y límites que se mantienen

- Frontend completo final: **584/584 PASS**, 73 archivos; Chrome local de Agenda y posición: PASS; siete recorridos críticos anteriores: PASS, más conversión/ficha automática y persistencia de «Ver cambios» tras reload PASS.
- Backend del candidato: CI PASS; 2726 pruebas estándar PASS y seis omitidas por dependencias físicas. Se cubrieron después las dependencias con 16/16 pruebas dirigidas locales reales. No se contabilizan omitidas como aprobadas.
- Backup previo privado 3651622 bytes, SHA-256 `a464c3dbafe0fd6089b622f50630c181549899d2082e8f1739fda3ff3982be97`, restauración física y migraciones sobre copia PASS. Continúa siendo un respaldo previo del release, no una copia posterior de nuevas escrituras. Rollback de código conservado: Render `190fa74`, Netlify `957e8ce`; schema aditivo compatible, sin reset/restauración destructiva.
- Los 26 binarios históricos ausentes NO se recuperaron ni se borraron/sobrescribieron sus referencias. No se declara recuperación integral de Storage por restaurar sólo metadatos.
- Facturama sandbox funciona en el entorno local de QA; runtime fiscal productivo sigue deshabilitado. No se subieron FIEL empresariales. No se certifican cancelación, REP ni complementos no implementados.
- Las dependencias jurídicas, fuentes/listas/formatos autorizados y ramas ISR pendientes de `CLIENT_UPDATES_20261121.md` continúan abiertas. Este cierre es del lote técnico publicado y de Agenda/chat/navegación; **no declara todos los requisitos históricos PASS ni homologación fiscal/jurídica global**. La verificación UX conservó diseño, tokens y navegación existentes, agregando sólo el indicador superior y visibilidad móvil solicitados.

Credenciales y documentos privados no forman parte de este reporte ni del repositorio. No se crearon servicios, proyectos ni proveedores nuevos.
