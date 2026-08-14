# Plan de rotación JWT productiva

> **NOT AUTHORIZED — DO NOT EXECUTE.** Ningún paso de este documento autoriza cambios en producción.

1. Verificar staging con secreto A aleatorio de 32+ caracteres, nunca mostrado ni almacenado en Git.
2. Crear sesiones sintéticas y confirmar login/refresh/logout.
3. Cambiar staging a secreto B mediante el gestor del proveedor; reiniciar de forma coordinada.
4. Confirmar la política esperada: tokens A dejan de verificarse, sesiones persistidas quedan revocadas/forzadas a login según el runbook, nuevos tokens B funcionan.
5. Registrar timestamps, release IDs, métricas de errores y rollback a A solo dentro del ensayo staging.
6. Para producción: **NOT AUTHORIZED — DO NOT EXECUTE** hasta tener ventana, comunicación, responsable, backup, staging GREEN y aprobación explícita.

No se realizó el drill porque no hay backend staging.
