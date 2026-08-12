# PRAVIA OS — Frontend Fases 1 a 5

Frontend nuevo construido desde cero. Incluye login, capa de autenticación, rutas protegidas, application shell responsive, el dashboard operativo **Mi Día**, el copiloto transversal **PRAVIA IA**, el pipeline de **Prospectos** y el workspace de **Cotizaciones**.

## Desarrollo

1. Copia `.env.example` a `.env` y ajusta las rutas del backend.
2. Ejecuta `npm install`.
3. Ejecuta `npm run dev`.

## Integración de autenticación

El cliente soporta tokens `accessToken`, `access_token` o `token`, además de sesiones por cookie (`credentials: include`). Los endpoints se parametrizan con variables Vite porque el backend no forma parte de este repositorio.

Los campos de usuario aceptados se normalizan desde respuestas con `user`, `data.user`, `data` o el objeto raíz. La UI nunca contiene un nombre de usuario fijo.

## Integración de Mi Día

Mi Día consume un único endpoint configurable con `VITE_MY_DAY_PATH` (por defecto `GET /dashboard/mi-dia`). El frontend normaliza respuestas parciales, mantiene estados independientes por widget y solo muestra información financiera cuando el backend devuelve `permissions.canViewFinance: true`.

El contrato esperado y la evidencia de validación se documentan en [PHASE_2_REPORT.md](./PHASE_2_REPORT.md).

## Integración de PRAVIA IA

PRAVIA IA se monta una sola vez dentro del shell privado. Su contexto procede de la ruta actual y su red está aislada en un adapter con endpoints opcionales por entorno. Mientras el backend no confirme esas rutas, el frontend no inventa sugerencias, respuestas ni acciones.

La arquitectura, contratos y estados se documentan en [PHASE_3_REPORT.md](./PHASE_3_REPORT.md).

## Integración de Prospectos

Prospectos consume el contrato real `GET/POST /prospectos`, `GET /prospectos/:id`, `POST /prospectos/:id/seguimientos` y `GET /prospectos/:id/documentos`. El mapeo visual de estados, las limitaciones de volumen y la evidencia de QA se documentan en [PHASE_4_REPORT.md](./PHASE_4_REPORT.md).

## Integración de Cotizaciones

Cotizaciones usa el contrato real de cotización, versiones, documentos, seguimientos, aceptación y conversión. La lista utiliza búsqueda, filtros, orden y paginación server-side; sus KPIs y su serie mensual se calculan en backend. Los estados, fórmulas, permisos, limitaciones de PDF/envío y evidencia de QA se documentan en [PHASE_5_REPORT.md](./PHASE_5_REPORT.md).

## Alcance

Expedientes, Comparecientes, Agenda, Finanzas y los demás módulos posteriores continúan como placeholders intencionales. Sus acciones contextuales de PRAVIA IA solo precargan consultas y no implementan lógica del módulo.
