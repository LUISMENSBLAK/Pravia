# Entrega Fase 1 — Application Shell + Login

## Construido

- Frontend React + Vite + TypeScript completamente nuevo en `frontend/`.
- Login responsive con estados idle, focus, loading, error y disabled.
- Cliente API centralizado con base URL, bearer token opcional, cookies, refresh, reintento por 401, normalización de usuario y logout.
- Guardas privadas sin flash de login durante la comprobación inicial.
- Shell con sidebar expandible, rail tablet, drawer móvil, topbar navy, búsqueda honesta como placeholder, notificaciones sin contador inventado y menú de sesión.
- Rutas placeholder para todos los módulos solicitados.
- Assets oficiales copiados sin redibujar logo ni búho.

## Código antiguo no reutilizado

El repositorio recibido no contiene frontend anterior. No se reutilizó CSS, sidebar, topbar, layout ni componentes previos.

## Integración pendiente del backend real

El repositorio recibido tampoco contiene backend, documentación de endpoints ni variables de ejecución. Por ello:

- Las rutas se parametrizan en `.env` y sus valores de referencia están en `.env.example`.
- El flujo se validó en navegador con un servidor temporal fuera del repositorio que responde al contrato esperado.
- Antes de producción deben confirmarse los paths exactos, forma de la respuesta de login/me, política de cookies/CORS y campo real de notaría/rol.
- No se modificó ni simuló backend dentro del código de producción.

## Verificación

- `npm run build`: correcto.
- `npm test`: 5 pruebas correctas.
- `npm audit`: 0 vulnerabilidades conocidas.
- Login, guardas, navegación, sidebar colapsado, drawer móvil, búsqueda, user menu y logout comprobados en navegador.

## Capturas

- `screenshots/login-1440x900.jpg`
- `screenshots/login-390x844.jpg`
- `screenshots/shell-1440x900.jpg`
- `screenshots/shell-1280x800.jpg`
- `screenshots/shell-768x1024.jpg`
- `screenshots/shell-390x844.jpg`

Mi Día, PRAVIA IA y los módulos operativos quedan deliberadamente fuera de esta fase.
