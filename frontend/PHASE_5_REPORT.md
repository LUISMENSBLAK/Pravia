# Fase 5 — Cotizaciones

## Contrato real inspeccionado

El módulo consume el backend existente y conserva sus permisos y reglas de acceso a objeto. No se crearon estados, impuestos, vigencias, documentos ni eventos ficticios.

### Endpoints usados

- `GET /cotizaciones?page=&pageSize=&sort=&busqueda=&estado=&acto=&responsable=&fecha_desde=&fecha_hasta=&periodo=`: lista, facetas, KPIs, analytics y paginación.
- `POST /cotizaciones`: crea el encabezado desde un prospecto elegible.
- `GET /cotizaciones/:id`: detalle, versiones, pagos y elegibilidad de conversión.
- `POST /cotizaciones/:id/versiones`: crea una nueva versión inmutable.
- `POST /cotizaciones/version/:versionId/aprobar`: aprueba una versión.
- `PUT /cotizaciones/:id/estado`: ejecuta una transición permitida por el workflow del backend.
- `GET/POST /cotizaciones/:id/seguimientos`: actividad y seguimiento.
- `POST /cotizaciones/:id/registrar-envio`: registra evidencia manual de envío y ejecuta la transición válida.
- `GET /cotizaciones/:id/documentos` y `GET /documentos/:id/url`: documentos y descarga mediante URL firmada.
- `POST /cotizaciones/:id/convertir`: conversión idempotente mediante el servicio de dominio.
- `GET /prospectos?...&sinCotizacion=true`: candidatos reales sin una cotización existente.
- `GET /notarias?activa=true`: notarias activas para el alta.

## Cambios aditivos de backend

- Se añadió búsqueda por UUID/folio, prospecto/cliente y acto.
- Se añadieron filtros por estado, acto, responsable y rango de fechas; ordenamiento con lista blanca y paginación con límite máximo de 100.
- La respuesta paginada incluye KPIs, conteos por estado, facetas y serie mensual. Sin parámetros de paginación, `GET /cotizaciones` conserva el arreglo plano legado.
- Prospectos admite `sinCotizacion=true` de forma opcional y compatible para evitar duplicar una cotización desde el wizard.
- Se añadió el registro de envío manual con canal, destinatario y evidencia obligatorios. La respuesta declara `deliveryConfirmedByProvider: false`.
- No hubo migraciones, cambios destructivos ni modificaciones de la lógica financiera.

## Estados y transiciones reales

Estados Prisma: `BORRADOR`, `ENVIADA_NOTARIA`, `PRESUPUESTO_RECIBIDO`, `EN_REVISION_ABOGADO`, `ENVIADA_CLIENTE`, `EN_NEGOCIACION`, `ACEPTADA`, `RECHAZADA`, `VENCIDA` y `CONVERTIDA_EXPEDIENTE`.

Transiciones del workflow:

- `BORRADOR → ENVIADA_NOTARIA` (requiere notaría).
- `ENVIADA_NOTARIA → PRESUPUESTO_RECIBIDO | VENCIDA`.
- `PRESUPUESTO_RECIBIDO → EN_REVISION_ABOGADO`.
- `EN_REVISION_ABOGADO → ENVIADA_CLIENTE`.
- `ENVIADA_CLIENTE → EN_NEGOCIACION | ACEPTADA | RECHAZADA | VENCIDA`.
- `EN_NEGOCIACION → ENVIADA_CLIENTE | ACEPTADA | RECHAZADA | VENCIDA`.
- Aceptada, rechazada, vencida y convertida son terminales para el workflow general; la conversión aceptada se realiza por el endpoint especializado.

## KPIs y analytics

- **Total cotizaciones:** conteo real dentro del scope y filtros actuales.
- **Enviadas:** cotizaciones con `fecha_enviada_cliente` registrada. Abrir correo, descargar un PDF o copiar un enlace no cuenta.
- **Aceptadas:** cotizaciones con `fecha_aceptacion_cliente` registrada.
- **Importe total:** suma de `total_cliente`; nunca usa `valor_operacion`.
- **Tasa de conversión:** `aceptadas / enviadas × 100`. Sin enviadas se presenta como no disponible, no como cero inventado.

La gráfica agrupa por mes usando `fecha_enviada_cliente`. Importe enviado suma `total_cliente` de la cohorte; importe aceptado y tasa usan las cotizaciones de esa cohorte que tienen `fecha_aceptacion_cliente`. Periodos soportados: últimos seis meses y año actual.

## Nueva cotización y totales

El drawer usa cinco pasos: prospecto, notaría y acto, conceptos, condiciones y revisión. Desde Prospectos se abre preseleccionando el prospecto. Se distinguen `HONORARIOS`, `DERECHOS`, `IMPUESTOS`, `GASTOS` y `OTROS` dentro de `desglose_notaria.rubros`.

El frontend envía el desglose y su suma al backend como `total_notaria`; el contrato vigente establece `total_cliente = total_notaria`. `honorarios_pravia` es una participación interna, no un cargo adicional al cliente. El modelo no tiene una vigencia comercial general: se muestra únicamente la fecha límite real de respuesta de notaría cuando existe.

## Detalle, versiones, PDF y envío

El detalle muestra encabezado operativo, resumen, conceptos de la versión vigente, prospecto/notaría, versiones, actividad derivada de fechas y seguimientos reales, y documentos vinculados. Editar siempre crea una nueva versión.

No existe un generador PDF ni un proveedor de email en este backend. Descargar solo aparece cuando una versión contiene `pdf_url` o existe un documento PDF vinculado. Enviar se presenta como **Registrar envío manual**, exige evidencia y no afirma confirmación del proveedor.

## Conversión a expediente

La conversión usa exclusivamente `POST /cotizaciones/:id/convertir`. El backend exige cotización aceptada, versión aprobada, anticipo de categoría `ANTICIPO_NOTARIA` validado, prospecto vinculado y ausencia de expediente. El servicio es idempotente: si ya existe el expediente relacionado devuelve el existente; conflictos se muestran con un mensaje humano. Requiere además `expedientes.write`.

## Permisos y PRAVIA IA

- Lectura: `cotizaciones.read`.
- Escritura, nuevas versiones, transición y seguimiento: `cotizaciones.write`.
- Conversión: también `expedientes.write`; anticipos conservan los permisos financieros del backend.
- Lista: contexto `module: cotizaciones`.
- Detalle: `entityType: cotizacion` y `entityId` real.
- Las quick actions solo precargan consultas; no simulan respuestas del asistente.

## Responsive y QA

- Desktop: cinco KPIs, tabla/analytics 65/35.
- Tablet: tabla con scroll controlado y analytics debajo cuando no cabe.
- Mobile: KPIs en carrusel horizontal, filtros compactos, cards y detalle apilado.
- Estados independientes: skeletons de KPI/lista/chart, vacío global, vacío filtrado y error con reintento.
- Frontend: 43 pruebas y build de producción correctos.
- Backend: 116 pruebas y build TypeScript correctos.

Fase 5 queda sin commit y sin push a la espera de aprobación visual.
