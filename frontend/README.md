# PRAVIA OS — Frontend Fases 1 y 2

Frontend nuevo construido desde cero. Incluye login, capa de autenticación, rutas protegidas, application shell responsive y el dashboard operativo **Mi Día**.

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

## Alcance

Los demás módulos operativos continúan como placeholders intencionales. PRAVIA IA se limita a su tarjeta inicial; el drawer conversacional pertenece a una fase posterior.
