# Estrategia cookies, CORS y dominios

Cookies actuales: refresh `HttpOnly`; `Secure` cuando `NODE_ENV=production`; `SameSite=Strict`; path `/api/auth`; sesión normal 12 h; persistente 7 días; rotación one-time.

`SameSite=Strict` no es compatible con frontend Netlify y API Render en sitios distintos para XHR de refresh. La opción recomendada es publicar frontend y API bajo el mismo site registrable, por ejemplo `app.staging.example` y `api.staging.example`, o proxy same-origin `/api`. No se relajará a `SameSite=None` sin threat model y prueba CSRF.

CORS debe contener exclusivamente el origen HTTPS exacto del frontend staging, con credentials; wildcard queda prohibido. El build staging exige `VITE_EXPECTED_API_HOST` y puede recibir `VITE_PRODUCTION_API_HOSTS` para bloquear cruces.

Los dominios concretos siguen pendientes; no se modificó DNS.
