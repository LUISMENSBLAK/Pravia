# Workers externos

Estado: **NOT EXECUTED — SERVICES/DB/STORAGE STAGING REQUIRED**.

| Worker/capacidad | Implementación | Resultado externo |
|---|---|---|
| Storage compensation | worker con claim, retry, backoff, estado terminal y health | BLOCKED |
| Domain outbox | servicio con `FOR UPDATE SKIP LOCKED`, retry y handlers | BLOCKED: no proceso desplegado |
| Notificaciones | persistencia/API; no consumidor externo separado | BLOCKED |
| Recordatorios | dominio Agenda; no worker staging demostrado | BLOCKED |
| IA/jobs documentales | ejecución en aplicación; proveedor staging no autorizado | BLOCKED |

No se probaron dos réplicas ni ausencia de duplicados. No debe activarse producción hasta definir procesos/flags y health por worker en Render staging.
