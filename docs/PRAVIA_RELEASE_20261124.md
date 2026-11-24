# PRAVIA — candidato técnico 24-11-2026

Estado: candidato en validación final, NO publicado todavía. Este registro prevalece sobre conteos históricos, sin convertir pruebas sintéticas en homologación notarial. Base de código: 190fa74. Sin infraestructura ni proveedores nuevos.

## Resultado verificable

- Backend consolidado: 233 archivos, 2.712/2.712 PASS con LibreOffice real; cero omitidas. Frontend: 72 archivos, 574/574 PASS antes del último endurecimiento de selección de chat; repetición afectada/CI final pendientes.
- API, seguridad e integridad: 137/137 PASS; login/refresh/logout, permisos de módulos, 2 tenants, objetos/Storage ajenos denegados y prefacturas físicas. Rotar refresh revoca correctamente el JWT anterior; el test usa el token renovado, no el obsoleto.
- PostgreSQL dirigido: H1 18/18, H2 9/9, H3 18/18, H4 22/22, H5 15/15, H9 2/2 y lote nuevo 9/9. Fixtures declaradas sintéticas. H9 físico verifica linaje e inmutabilidad, no una llamada nueva a IA.
- H4 F004 se actualizó al contrato aprobado de lectura compartida dentro de Organization, manteniendo denegación de edición sin permiso y acceso de otro tenant. No se restringió la app para imponer el contrato antiguo de lectura sólo del creador.
- Chrome con OpenAI real: orden cotidiana de cotización crea borrador canónico sin Prospecto; consulta Mi Día; mensajes ajenos rechazados, instrucciones para revelar secretos/otra notaría sin exposición; múltiples chats, renombre, papelera/restauración y reload. Se están añadiendo archivo/restauración y selección demorada al recorrido final.
- Causas corregidas en chat: respuestas/subidas/transcripciones antiguas no pasan a otro chat; el historial respeta el último filtro solicitado; restaurar/archivar tarde no borra el chat nuevo; no se envía al chat anterior mientras carga la selección nueva. Errores de red se muestran sin rechazo sin manejar.
- Visor compartido: ResizeObserver mide contenedor y barra reales; ajustar página considera ancho y alto; ajustar ancho usa el contenedor; manual mantiene escala y scroll interno. Se eliminó la restricción CSS que anulaba el zoom manual. Chrome MXN/USD/CAD PASS a 1920/1440/1366/1280/1024/768/390/320 y ampliación sucesiva, orientación y manual sin reload. SHA/bytes inmutables, v1 conservada tras v2. Aserción original a 1024 conservada.

## Recorrido N23-06…N23-20

El resultado individual y las dependencias están en CLIENT_UPDATES_20261121.md. Los quince fueron inspeccionados. No son quince PASS integrales: N23-08/09/19 tienen certificaciones Chrome pendientes; N23-10/11/12/13 dependen de fuentes/reglas/formatos vigentes; N23-14 requiere configurar y ejecutar su operación Gateway; N23-15 permanece parcial, y N23-20 espera el formato anunciado por el cliente. No inventar anexos, umbrales, fuentes, acuses ni timbrados para cerrar una matriz.

Se implementaron elección Público en general; recibo con QR verificable y referencia al movimiento sin romper su constraint; reutilización de archivos generados; ficha CFG002 versionada; selección manual tenant-scoped de institución; mapeo literal sin rehacer Word; configuración explícita del protocolo y búsqueda/paginación. No se borraron históricos ni documentos del usuario.

## Base, recuperación y configuración actuales

- NOTARYPROY: lectura por Session pooler oficial y TLS verificado. 131/135 migraciones canónicas aplicadas al inspeccionar; cuatro nuevas aditivas pendientes, cero checksums canónicos divergentes, cero migraciones fallidas. El baseline histórico adicional se conserva.
- Respaldo PostgreSQL actual: 3.651.622 bytes, SHA-256 a464c3dbafe0fd6089b622f50630c181549899d2082e8f1739fda3ff3982be97. Dump previo interrumpido NO se considera respaldo. Copia privada local, permisos 0600.
- Restore completo sobre PostgreSQL 17 local: PASS. Requiere recrear extensión pg_trgm en pravia_os y roles de políticas Supabase NOLOGIN; se omite sólo CREATE SCHEMA de esquemas ya preparados, no tablas/datos/políticas. Las cuatro migraciones se aplicaron sobre esa copia. Conteos conservados: 14 expedientes, 36 cotizaciones, 181 documentos, 374 objetos Storage (metadatos). Esto NO demuestra recuperación de los 26 binarios históricos ausentes.
- Recuperación de código preparada: Render 190fa74 y frontend Netlify 957e8ce. Las migraciones son compatibles con código anterior; no se elimina ninguna columna ni se reescriben documentos/folios. No se plantea reset ni restauración destructiva sobre producción.
- Seis operaciones IA actuales activas CUSTOMER_WALLET, dos modelos OpenAI habilitados y límites/reservas/catalogo versionado existentes. No se modificó esa política ni se amplió a operaciones adicionales. PAC real deshabilitado; no se simula UUID/XML oficial.
- Bucket pravia_documentos privado, límite efectivo 52.428.800 bytes (50 MiB). No buckets/proyectos nuevos.
- Render existente: pravia-api, rama main, Docker con raíz backend, auto-deploy Off, health /health. Netlify existente: pravianetwork, rama main, auto-publicación On, publicado 957e8ce; 190fa74 sólo cambió backend y su build fue cancelado por ausencia de cambios frontend.
- Secret scan: 2.105 archivos, cero hallazgos en ese pase; repetir al consolidar. npm audit frontend: cero vulnerabilidades. Backend: cero high/critical; cinco moderate de la cadena archiver/glob, sin salto mayor forzado. No son cero vulnerabilidades totales.

## Gate

READY FOR REAL CLIENT DATA: NO. No se certifica jurídicamente Cumplimiento/ISR con fixtures, ni lectura perfecta de cualquier foto. READY FOR TECHNICAL TESTING / deploy del candidato: pendiente de CI exacto, completar recorridos críticos, migración productiva segura y smoke real. No marcar publicado por un HTTP 200.
