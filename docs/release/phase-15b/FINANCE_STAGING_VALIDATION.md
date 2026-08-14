# Validación financiera staging

Dataset sintético: un `Pago` validado de MXN 1,000 ligado a cotización y expediente.

Dry-run inicial: una fila `MIGRACION_SEGURA`, total MXN 1,000; cero ambiguas y cero duplicadas. El ejecutor `phase15b-staging-finance-backfill.ts` acepta únicamente `pravia_staging_future` local, exige actor Dirección/Administración, usa transacción e `idempotency_key=legacy:pago:<id>`.

Run 1: creó un movimiento por MXN 1,000. Reconciliación: movimientos antes 1/MXN 500; después 2/MXN 1,500; legacy representado 1/1.

Run 2: la fila se clasificó `YA_REPRESENTADO`; creó cero movimientos. Totales finales idénticos: 2 movimientos/MXN 1,500. No hubo backfill productivo.
