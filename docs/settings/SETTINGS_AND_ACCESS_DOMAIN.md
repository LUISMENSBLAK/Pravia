# Configuración, usuarios y accesos — Fase 13

## Objetivo y límites

Esta fase convierte Configuración en un módulo funcional para perfil, seguridad, sesiones, preferencias, organización, usuarios, roles, IA administrativa, auditoría, notificaciones y búsqueda global. No incorpora despliegue, pagos, firma, automatizaciones externas ni una segunda fuente de datos para notarías. “Inteligencia” no aparece en la navegación principal; la administración técnica de IA vive bajo Configuración y requiere `ai.admin.read`.

El frontend carga Configuración, detalle de usuario y activación mediante rutas lazy. El núcleo global mantiene únicamente shell, búsqueda, notificaciones y el launcher del asistente.

## Modelo de autorización

Los roles siguen siendo el enum canónico ya existente:

- `DIRECCION`
- `ADMINISTRACION`
- `ABOGADO`
- `RECEPCION`
- `GESTORIA`
- `CONSULTA`

La matriz se obtiene de `ROLE_PERMISSIONS` en el backend. El frontend no calcula, concede ni persiste permisos. Dirección conserva `usuarios.manage` y `configuracion.manage`; Administración puede consultar usuarios e IA administrativa, pero no alterar accesos. La pantalla de roles es deliberadamente de solo lectura.

El alcance operativo sigue las reglas existentes: Dirección, Administración y Consulta tienen alcance global para expedientes; Abogado, Gestoría y Recepción ven objetos asignados o compatibles con su función. La búsqueda global reutiliza esas reglas y consulta únicamente módulos para los que el usuario posee permiso de lectura.

## Perfil y preferencias

El perfil propio permite cambiar nombre, apellido y teléfono. Correo, rol, permisos y ámbito se muestran como solo lectura. No se aceptan cambios de rol o permisos desde este contrato.

`UserPreference` es una relación uno a uno y persiste solo capacidades implementadas:

- vista inicial: tarjetas o lista;
- densidad: cómoda o compacta;
- zona horaria dentro del catálogo soportado;
- formato de fecha;
- tema: sistema o claro;
- notificaciones;
- sugerencias contextuales del asistente.

Valores fuera de catálogo se rechazan en servidor. Cada cambio genera un registro de auditoría con las claves modificadas, sin almacenar secretos.

## Sesiones y contraseña

`AuthSession` continúa siendo la fuente de verdad. Configuración permite:

- listar sesiones vigentes de la cuenta autenticada;
- identificar la sesión actual;
- mostrar navegador/sistema a partir del user-agent;
- mostrar únicamente IP aproximada, sin geolocalización;
- revocar una sesión propia;
- revocar todas las sesiones propias excepto la actual;
- cerrar la sesión actual de forma explícita;
- cambiar contraseña mediante el contrato existente.

Cambiar contraseña revoca las demás sesiones. La revocación registra actor, sesión y correlación. Una cuenta nunca puede revocar sesiones de otra por este endpoint.

## Invitaciones y activación

La creación directa con contraseña temporal dejó de exponerse en las rutas administrativas. El flujo nuevo es:

1. Dirección registra nombre, apellido, correo y rol.
2. El backend genera un token opaco aleatorio.
3. Solo el SHA-256 del token se persiste en `UserInvitation`.
4. La invitación expira a las 72 horas y puede revocarse.
5. El proveedor configurado recibe un enlace de activación.
6. La persona define su propia contraseña que debe superar la política de fortaleza.
7. Una transacción crea la cuenta, reclama la invitación, audita la activación y crea una notificación de bienvenida.

El enlace no se devuelve en producción. En desarrollo solo puede devolverse cuando `AUTH_ALLOW_DEV_INVITATION_LINK=true`; el valor predeterminado es `false`. El webhook es `USER_INVITATION_WEBHOOK_URL` y la base del enlace es `USER_ACTIVATION_URL`.

## Administración de usuarios

El listado administrativo es paginado, filtrable y ordenable en servidor. Los estados se derivan de datos reales:

- `ACTIVO`;
- `SUSPENDIDO`;
- `BLOQUEADO`, cuando `locked_until` sigue vigente;
- `CAMBIO_REQUERIDO`, para cuentas heredadas que aún deben cambiar contraseña.

Las invitaciones pendientes o expiradas no se confunden con usuarios activos. No existe borrado de usuario: suspender conserva historia y relaciones. Cambiar rol o suspender revoca todas las sesiones vigentes y genera auditoría y notificación.

Antes de suspender se calcula impacto en expedientes activos, tareas pendientes, eventos futuros y revisiones. Si existe impacto, el servidor exige `confirm_impact=true`. La fase no implementa reasignación masiva: la interfaz lo declara y orienta a reasignar desde cada módulo. El backend impide desactivar la propia cuenta y protege al último usuario activo de Dirección tanto al suspender como al cambiar su rol.

## Auditoría

Se reutiliza `AuditLog`. El endpoint administrativo expone únicamente:

- acción;
- entidad e identificador;
- actor;
- fecha;
- ids de correlación y sesión.

No devuelve `valores_anteriores`, `valores_nuevos` ni `detalles`, porque pueden contener datos internos. Contraseñas, tokens y hashes nunca se escriben en auditoría.

## Administración de IA

La pantalla usa `AIUsageLog` real para solicitudes, fallos, tokens, documentos, costo estimado, escalamiento y agrupación por modelo. Los nombres de modelos y estados de configuración son de solo lectura y provienen del entorno. La API informa si una clave está configurada, pero nunca muestra su valor. La política recuerda que las herramientas combinan permiso de IA, permiso de sistema y alcance del objeto; las acciones siguen requiriendo confirmación explícita.

## Notificaciones

`Notification` es un modelo mínimo y dirigido a un usuario. Incluye tipo, título, cuerpo, enlace interno, actor opcional, lectura y fecha. En esta fase se crean notificaciones reales para bienvenida, suspensión y cambio de rol. El centro global y la página de Configuración consultan la misma fuente, permiten marcar una o todas como leídas y navegan al enlace interno autorizado.

## Búsqueda global

`GET /api/settings/search?q=` devuelve resultados normalizados de:

- expedientes;
- comparecientes;
- prospectos;
- cotizaciones;
- notarías.

Requiere `ai.search` porque esa capacidad ya representa el permiso transversal existente, pero el endpoint no llama a un modelo ni mezcla resultados con el chat. Cada consulta aplica el permiso de lectura del módulo y sus filtros de alcance. El frontend espera dos caracteres, aplica debounce de 260 ms y soporta `⌘ K` / `Ctrl K`.

## Contratos principales

- `GET/PATCH /api/settings/profile`
- `GET/PATCH /api/settings/preferences`
- `GET /api/settings/sessions`
- `DELETE /api/settings/sessions/:id`
- `POST /api/settings/sessions/revoke-others`
- `GET /api/settings/roles`
- `GET /api/settings/audit`
- `GET/POST /api/settings/notifications...`
- `GET /api/settings/search`
- `GET /api/users` paginado para administradores y catálogo reducido para otros roles
- `GET /api/users/:id` y `GET /api/users/:id/impact`
- `PATCH /api/users/:id`
- `GET/POST/DELETE /api/users/invitations...`
- `GET/POST /api/auth/activation`
- `GET /api/ia/dashboard`

## Migración

`20260813030000_settings_and_access` es aditiva:

- añade `users.telefono` nullable;
- crea `user_preferences`;
- crea `user_invitations` con token hash único y expiración;
- crea `notifications`;
- agrega índices y llaves foráneas explícitas.

No elimina columnas, roles, relaciones ni datos heredados. Debe aplicarse con el flujo normal de Prisma antes de habilitar los endpoints.

## Interfaz, accesibilidad y responsive

La interfaz usa los tokens navy/oro existentes, tarjetas blancas y estados semánticos. Los diálogos de suspensión, revocación e invitación son modales accesibles; no se usa `window.confirm`. Los controles tienen nombre accesible, foco visible y textos que no dependen solo del color. A 768 px la navegación de Configuración se convierte en una barra horizontal; a 390 px las tablas cambian a tarjetas y los diálogos ocupan el ancho disponible.

Estados implementados: carga, vacío, error con reintento, acceso restringido y confirmación de impacto.

## Verificación de esta fase

- Backend: 43 archivos, 198 pruebas.
- Frontend: 15 archivos, 117 pruebas.
- Build backend TypeScript: aprobado.
- Build frontend: aprobado.
- Prisma generate/validate: requerido en el cierre final.
- Bundle inicial tras Fase 13: 236.92 kB JS (77.60 kB gzip); Configuración se entrega aparte en 29.56 kB JS (7.50 kB gzip) y 16.37 kB CSS (3.41 kB gzip).

Las capturas visuales se generan después de validar los contratos con un servidor de fixtures local, sin conectar ni alterar producción.
