# Fase 4 — Prospectos

## Endpoints usados

- `GET /prospectos?busqueda=&prioridad=&estado=&servicio=&origen=&page=&pageSize=&sort=`: pipeline, KPIs, facetas, filtros y paginación.
- `POST /prospectos`: alta rápida.
- `GET /prospectos/:id`: detalle y timeline de seguimientos.
- `POST /prospectos/:id/seguimientos`: registro de actividad y siguiente acción.
- `GET /prospectos/:id/documentos`: documentos vinculados en detalle.

El listado incorpora paginación y ordenamiento con campos permitidos, búsqueda por nombre/teléfono/correo/tipo de acto o UUID exacto, filtros por estado/prioridad/servicio/origen, conteos globales y facetas. La respuesta paginada se activa únicamente al enviar `page`, `pageSize` o `limit`; las integraciones antiguas que no los envían conservan el arreglo plano original.

## Mapeo explícito de estados

| Agrupación visual | Estados reales |
| --- | --- |
| Nuevo | `NUEVO`, `INFO_PENDIENTE` |
| Seguimiento | `DOCS_RECIBIDOS`, `EN_REVISION`, `SEGUIMIENTO` |
| Cotización | `COTIZACION_SOLICITADA`, `COTIZACION_ENVIADA` |
| Cierre | `ACEPTADO`, `PERDIDO`, `CANCELADO` |

`ARCHIVADO` no llega en el listado porque el backend filtra `archived_at: null`. “Convertidos” cuenta únicamente `ACEPTADO`; “Con cotización” usa la relación real `cotizacion` y “En proceso” excluye cierre/archivo.

No hay drag-and-drop: `PUT /prospectos/:id` acepta el enum, pero no existe un endpoint de transición de negocio que proteja cotización/conversión.

## Alta rápida

Campos soportados: nombre o razón social, teléfono, correo, servicio/tipo de acto, ciudad, origen, prioridad, necesidad y tiempo estimado. El responsable se asigna en backend mediante el usuario autenticado. El modelo no soporta un campo “tipo de persona” ni una nota separada del campo `necesidad`.

## Detalle

Incluye resumen, contacto, prioridad/origen, responsable, última actividad, siguiente acción, timeline de seguimientos, documentos vinculados y cotización relacionada cuando existe. Registrar seguimiento usa `tipo`, `contenido`, `proxima_accion` y `fecha_proximo_seguimiento`.

El contrato de Prospecto no expone una relación directa a Expediente. Crear cotización existe en el backend de Cotizaciones, pero queda fuera del alcance visual/funcional de esta fase.

## Permisos y PRAVIA IA

- Lectura: `prospectos.read`.
- Alta y seguimiento: `prospectos.write`.
- La lista reporta `module: prospectos`; el detalle reporta `entityType: prospecto` y `entityId`.
- Triggers contextuales no generativos: `PROSPECTO_ESTANCADO`, `SIN_SIGUIENTE_ACCION`, `COTIZACION_PENDIENTE`.

## Responsive y QA

- Desktop: cuatro columnas completas a 1440 y 1280.
- Tablet: selector de etapa visible y columnas con scroll horizontal controlado, sin comprimir el tablero.
- Mobile: selector de etapa y una sola columna visible; KPIs con scroll horizontal.
- PRAVIA IA: el workspace reserva un área inferior segura en todos los breakpoints; el launcher respeta además el `safe-area-inset-bottom` del dispositivo.
- Estados verificados: loading con skeletons, vacío con CTA y error con reintento.
- Validación frontend: `npm test` (28 pruebas) y `npm run build`.
- Validación backend: `npm test` (112 pruebas) y `npm run build`.
- La validación visual automatizada local quedó bloqueada en el login por ausencia de `PRAVIA_E2E_EMAIL`/`PRAVIA_E2E_PASSWORD`; no se creó ni modificó ninguna contraseña para eludir esa protección.
