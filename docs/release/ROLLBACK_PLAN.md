# Plan de rollback

Este plan no autoriza un despliegue. PRAVIA usa rollback de aplicación y forward-fix de datos; una migración con datos nuevos no debe “deshacerse” borrando historia.

## Condiciones de activación

- errores sostenidos de auth/refresh, pérdida de scope o IDOR;
- diferencia financiera no explicada;
- documentos inaccesibles o incongruencia DB/Storage;
- errores de migración, crecimiento anómalo de 5xx o health de DB fallido;
- incompatibilidad PWA/asset manifest.

## Frontend (Netlify existente)

1. Detener promoción del release.
2. Restaurar el deploy publicado inmediatamente anterior desde el historial del sitio existente; no crear otro site.
3. Mantener el backend compatible con N y N-1 durante la ventana.
4. Verificar `/`, login, refresh y rutas SPA. El Service Worker versionado eliminará caches antiguos al activarse; si el release roto no permite el prompt, publicar un SW de forward-fix con un nuevo nombre de cache.

## Backend (Render existente)

1. Desactivar workers mutadores mediante sus flags antes de revertir la aplicación.
2. Restaurar la imagen/commit anterior en el servicio existente; no crear otro servicio.
3. No ejecutar migraciones desde `start`. La imagen anterior debe tolerar columnas/tablas aditivas.
4. Comprobar process health, DB health, auth y una lectura de cada dominio crítico.

## Base de datos

- Antes de producción: `npm run db:backup`, checksum, retención y restore drill.
- Migraciones aditivas: preferir forward-fix y desactivar la feature. No eliminar columnas/tablas con datos.
- Incidente destructivo o corrupción: aislar escrituras, preservar logs, restaurar a una base nueva desde el backup verificado y apuntar servicios solo tras reconciliar la ventana perdida.
- Ledger y snapshots: nunca borrar/recalcular silenciosamente. Reversiones son movimientos/decisiones compensatorias auditadas.

## Storage

- No borrar objetos durante rollback de aplicación.
- Mantener claves de objetos y vínculos DB. Los signed URLs son efímeros y se regeneran.
- Si DB se restaura a otro punto, reconciliar referencias antes de ejecutar el compensation worker. Cualquier objeto huérfano queda en cuarentena, no se purga automáticamente.

## Workers y flags

- Detener primero consumidores Outbox, compensación Storage y jobs IA/documentales.
- Registrar último job reclamado y reanudar solo handlers idempotentes.
- `LOCAL_LEGACY` permanece disponible como lector de contingencia; no es persistencia productiva moderna ni se elimina en este release.

## Criterios de recuperación

Auth y scope correctos, health DB verde, cero 5xx nuevos, documento controlado descargable, totales financieros reconciliados, auditoría íntegra y smoke test frontend/PWA aprobado.
