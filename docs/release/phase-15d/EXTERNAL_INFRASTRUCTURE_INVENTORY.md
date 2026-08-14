# Inventario de infraestructura externa

| Componente | Producción | Staging externo | Estado 15D |
|---|---|---|---|
| Supabase/PostgreSQL | ref `mkiwijbampubccrpvgga`, PostgreSQL 17.6 | no configurado ni accesible | MISSING |
| Supabase Storage | mismo ref productivo, solo lectura en fases previas | no URL/service role/bucket staging | MISSING |
| Render backend | existencia no verificable sin sesión | no servicio/URL/variables accesibles | UNKNOWN / ACTION REQUIRED |
| Netlify frontend | existencia no verificable sin sesión | no site/deploy preview/URL accesible | UNKNOWN / ACTION REQUIRED |
| DNS/domains | no declarados en repo | no dominios staging declarados | MISSING |
| Email/mailsink | webhooks no configurados localmente | no proveedor QA | MISSING |
| IA externa | clave local presente, valor no inspeccionado | autorización/proveedor staging no demostrados | PENDING |
| Redis/rate-limit distribuido | no declarado | no declarado | MISSING |
| Sentry/observabilidad SaaS | no declarado | no declarado | NOT CONFIGURED |

La CLI Supabase autenticada enumera solo dos proyectos ajenos a PRAVIA (`Ávila Conecta` y `Abaroa`). El ref productivo tampoco pertenece al alcance visible de ese token. Render y Netlify mostraron login, sin sesión activa. No se intentó autenticar, contratar, crear, enlazar ni modificar recursos.

Para desbloquear: el propietario debe autorizar o crear un proyecto Supabase staging separado, iniciar sesión o conceder acceso a Render/Netlify, aportar dominios staging y cargar secretos mediante los gestores de cada proveedor, nunca en Git/chat.
