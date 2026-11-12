# Release técnico · 12-11-2026

## Alcance autorizado

El propietario confirmó que los datos actuales son de prueba y autorizó publicar en GitHub, Render, Netlify y Supabase NOTARYPROY existentes. Esto no equivale a certificación para documentos notariales reales. No se compró ni creó infraestructura. No se ejecutan pagos, timbrado ni llamadas externas IA durante el smoke.

## Migraciones y recuperación

- Proyecto verificado: `mkiwijbampubccrpvgga`; Session pooler con TLS verificado y CA oficial. No se deshabilitó validación de certificado.
- Se aplicaron mediante el wrapper canónico `20261103010000_fiscal_entity_private_logo` y `20261111010000_quote_operation_territory`, previamente probadas sobre restauración local representativa. Ambas son aditivas.
- Estado posterior: **126/126 migraciones canónicas**, cero pendientes, fallos abiertos o checksums canónicos divergentes. La fila adicional del baseline histórico no se alteró.
- Dump previo actualizado de `pravia_os`, `auth`, `storage` y `public`: 3.286.599 bytes; SHA-256 `0b27d263e5aaf6e1f61fd17e66be4d91da0a8558b2bc48741ee7ec1fd2a20871`; inventario de restauración verificado. Backup privado local, no incluido en Git. La restauración física previa de aplicación es local, no independiente.
- Se conservan 6 usuarios, 1 organización, 6 membresías, 40 políticas RLS y ambos buckets privados. La autenticación de PRAVIA usa sesiones propias; no se infiere un fallo de Auth por `auth.users` vacío.
- Backup previo de los objetos disponibles: **278/278**, tamaño y SHA comprobados. Los 26 objetos históricos ausentes no se recuperaron ni borraron; se preservan sus referencias y no se presentan como archivos existentes. Su clasificación como prueba proviene de la confirmación del propietario, no de inferir identidades por nombres.
- Rollback de código: desplegar el SHA anterior en los mismos servicios; conservar las columnas nuevas compatibles. No ejecutar down destructivo ni reset. Antes de admitir datos reales falta certificar recuperación en un dominio de fallo independiente con objetivos operativos aprobados.

## Publicación y correcciones del smoke

El candidato acumulado `991dc9eb9fe871804feb2bd4fe6c638eb5d8975c` superó CI 4/4 y fue publicado en Render y Netlify. `main` avanzó por fast-forward, sin force ni pérdida de historia. Render conserva Auto-Deploy Off; Netlify publica automáticamente `main` y usa el proxy `/api` hacia el backend existente.

El smoke descubrió dos defectos reales y motivó este seguimiento, sin ampliar el producto:

1. Cambiar organización con un UUID vacío provocaba un rechazo Prisma no capturado y reinicio de Node. Se valida la entrada antes de consultar y se controlan errores de servicio; una organización ajena sigue denegada. Pruebas de entrada inválida, denegación y fallo de dependencia.
2. ADM-001 activo es un machote personalizado seccionado, no la tabla estándar del ZIP. Se reutiliza su misma tabla para honorarios, impuestos/derechos y otros gastos con los totales canónicos; se conservan condiciones, estilos, logos y saltos de Word. No se sustituye ni altera la versión fuente privada. Valores de avalúo/catastro ausentes quedan POR CONFIRMAR, no cero ficticio. Un render físico del derivado sintético se revisó completo antes de publicar la corrección.

La primera prueba de cinco cuentas demostró login, pero su comprobación inicial de sesión usaba un token anterior a la renovación legítima; no se presenta ese error del harness como fallo del producto. Una prueba posterior con payload erróneo expuso el defecto real anterior. El recorrido público corregido debe repetirse sobre el nuevo SHA; ni esa repetición, ni ADM-001 HTTP ni prefactura pública se declaran PASS por pruebas unitarias o render local.

Regresión del seguimiento: **2.388/2.388 backend**, incluyendo las conversiones físicas con LibreOffice habilitado, con dos workers y timeout de harness de 60 s; build TypeScript correcto y escaneo de 1.992 archivos sin secretos detectados. La primera ejecución con concurrencia por defecto tuvo seis timeouts/OCR/conversión ocupada bajo carga local; se conserva esa evidencia y la repetición completa pasó, sin modificar límites funcionales ni ocultar casos. El frontend no cambia en este seguimiento; sus 507 pruebas y build se vuelven a exigir en CI del SHA exacto antes de publicar.

## Límites y certificaciones que no se sustituyen

- Bucket `pravia_documentos`: 52.428.800 bytes (50 MiB) configurados. Esta lectura sola no certifica una carga extrema real.
- Prefactura determinística no necesita OpenAI. PAC/CSD no configurados: no timbrar, no inventar UUID fiscal. No se verifica proveedor externo IA en este smoke.
- Las matrices integrales del cliente conservan sus pendientes. Publicar un entorno de prueba no convierte automáticamente 135 correcciones, FDR90, extracción universal o colaboración completa en PASS.
- URLs existentes: [frontend](https://pravianetwork.netlify.app), [backend](https://pravia-api.onrender.com), [health](https://pravia-api.onrender.com/health).
- La evidencia pública final y el SHA exacto se informarán tras CI y el rollout de este seguimiento. **READY FOR REAL CLIENT DATA: NO**.
