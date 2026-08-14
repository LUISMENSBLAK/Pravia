# Netlify staging validation

Estado: **BLOCKED — NETLIFY ACCESS/SITE REQUIRED**.

El panel disponible solicita autenticación. No hay CLI/token/site/deploy preview staging accesible. No se publicó ni se modificó el sitio productivo.

El build local PASS e incluye SPA redirects, PWA y headers. Se añadió un guard que bloquea builds productivos con API localhost/HTTP y, cuando `VITE_DEPLOY_ENV=staging`, exige API HTTPS y host exacto separado de los hosts productivos.

Si Netlify debe leer Git: `GIT_REMOTE_REQUIRED_FOR_EXTERNAL_STAGING`. No se hizo push.
