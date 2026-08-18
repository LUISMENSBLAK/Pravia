# Registro de ejecución del cutover PRAVIA OS

No incluir secretos, tokens, contraseñas, URLs con credenciales ni contenido legal.

## Identidad y aprobaciones

- Fecha/hora UTC:
- Ventana aprobada:
- Operador principal:
- Segundo verificador:
- Incident lead:
- Aprobación GO:
- Commit aprobado:
- GitHub remote HEAD antes/después:
- Render service/deploy anterior:
- Netlify site/deploy anterior:

## Freeze y respaldo

- Comunicación de mantenimiento:
- Auto-Deploy Render OFF verificado:
- Auto-Publish Netlify STOPPED verificado:
- Backend suspendido a las:
- Workers/crons verificados detenidos:
- Requests mutadores después del freeze: 0 / detalle
- Backup PostgreSQL timestamp UTC:
- Ubicación segura redactada:
- Tamaño:
- SHA-256:
- Versión de `pg_dump`:
- Restore target aislado:
- Restore duration:
- RESTORE: PASS / FAIL
- DATABASE READABLE: PASS / FAIL
- CRITICAL TABLE COUNTS: MATCH / FAIL
- FINANCIAL RECONCILIATION: MATCH / FAIL
- Storage inventory timestamp:
- Bucket/provider:
- Object count / bytes / manifest checksum:
- Respaldo de blobs o política de preservación:

## Base de datos

- Project ref verificado: `mkiwijbampubccrpvgga`
- Database/schema: `postgres` / `pravia_os`
- Migration state BEFORE:
- S0 artifact/checksum:
- Canonical package `SHA256SUMS` checksum:
- `migrate deploy` inicio/fin/resultado:
- Migration state AFTER:
- Bootstrap Organization ID:
- Bootstrap Organization name aprobado:
- Memberships esperadas/creadas:
- Backfill inicio/fin/resultado:
- Orphans:
- Cross-tenant invalid relationships:
- Missing FK indexes:
- Duplicate indexes:
- S1/S2 artifacts/checksums:
- Financial reconciliation delta:

## Deploys y smoke

- Render deploy ID nuevo:
- Render commit:
- `/health`:
- `/api/health`:
- Auth/session smoke:
- Document/Storage smoke:
- Netlify deploy ID nuevo:
- Netlify commit:
- Full product smoke:
- Multitenant smoke:
- PRAVIA IA smoke:
- Logs/5xx/latency/AI provider:

## Decisión final

- GO / ABORT / ROLLBACK:
- Motivo:
- Rollback DB ejecutado: NO / detalle
- Rollback Render ejecutado: NO / detalle
- Rollback Netlify ejecutado: NO / detalle
- Escrituras reanudadas a las:
- Monitorización intensiva termina a las:
- Incidentes abiertos:
- Firma operador:
- Firma segundo verificador:
