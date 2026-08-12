# PRAVIA OS — Frontend Fase 1

Frontend nuevo construido desde cero. Incluye login, capa de autenticación, rutas protegidas y application shell responsive.

## Desarrollo

1. Copia `.env.example` a `.env` y ajusta las rutas del backend.
2. Ejecuta `npm install`.
3. Ejecuta `npm run dev`.

## Integración de autenticación

El cliente soporta tokens `accessToken`, `access_token` o `token`, además de sesiones por cookie (`credentials: include`). Los endpoints se parametrizan con variables Vite porque el backend no forma parte de este repositorio.

Los campos de usuario aceptados se normalizan desde respuestas con `user`, `data.user`, `data` o el objeto raíz. La UI nunca contiene un nombre de usuario fijo.

## Alcance

Los módulos operativos son placeholders intencionales. Mi Día y PRAVIA IA quedan fuera de esta fase.
