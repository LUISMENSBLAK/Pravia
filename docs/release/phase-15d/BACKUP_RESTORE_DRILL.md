# Backup / restore externo

Estado: **NOT EXECUTED — MANAGED STAGING REQUIRED**.

No existe instancia staging donde crear backup administrado y restaurar hacia una DB aislada. Al desbloquear se deberá registrar snapshot/backup ID redactado, checksum cuando aplique, duración, destino nuevo, fingerprint S2, conteos, historial de nueve migraciones, auth y configuración de Storage. Nunca se restaurará encima de producción.
