# PWA external update test

Estado: **NOT EXECUTED — NETLIFY STAGING REQUIRED**.

El build local conserva `sw.js`, manifest, offline honesto, assets hashed y headers de no-cache para SW/index. Falta el ensayo real HTTPS V1 → pestaña abierta → V2 → prompt/update → recarga, además de rollback V2 → V1 sin MIME incorrecto, white screen o pérdida indebida de sesión.
