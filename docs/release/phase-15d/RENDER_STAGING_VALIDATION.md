# Render staging validation

Estado: **BLOCKED — RENDER ACCESS/SERVICE REQUIRED**.

El panel disponible solicita autenticación. No hay `render.yaml`, CLI/token, servicio staging, URL o variables declaradas. No se creó servicio ni se tocó producción.

El backend está preparado para Node 22, build separado y start sin migraciones automáticas. La imagen incluye healthcheck; el target `migrate` es separado. Antes de usar Render deben crearse/configurarse web y workers staging, cargar secretos fuertes y ejecutar migraciones como release job único.

Si Render debe leer Git: `GIT_REMOTE_REQUIRED_FOR_EXTERNAL_STAGING`. No se autoriza push en esta fase sin instrucción posterior explícita.
