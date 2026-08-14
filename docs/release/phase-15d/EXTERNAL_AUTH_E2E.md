# Auth E2E externo

Estado: **NOT EXECUTED — EXTERNAL URLs/DB REQUIRED**.

Conteos externos: 0 ejecutados, 0 PASS, 0 FAIL, todos bloqueados. Pendientes: login, refresh rotation, logout, sesión 12 h, recordar 7 días, expiración, activación, recovery y suspensión sobre HTTPS real.

Endurecimiento local 15D: `AUTH_JWT_SECRET` ahora rechaza vacío, menos de 32 caracteres, placeholders conocidos y valores repetitivos; las pruebas unitarias nuevas pasan. Cookies mantienen `HttpOnly`, `Secure` en producción, `SameSite=Strict` y path `/api/auth`.
