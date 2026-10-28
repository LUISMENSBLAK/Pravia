-- An incomplete local draft may be persisted without inventing a fiscal amount.
-- Zero is permitted only while the record is an editable LOCAL_DRAFT.
ALTER TABLE "pravia_os"."documentos_cfdi"
  DROP CONSTRAINT "ck_documentos_cfdi_totales";
ALTER TABLE "pravia_os"."documentos_cfdi"
  ADD CONSTRAINT "ck_documentos_cfdi_totales" CHECK (
    "subtotal" >= 0 AND "impuestos_trasladados" >= 0 AND "impuestos_retenidos" >= 0 AND
    "total" >= 0 AND "saldo" >= 0 AND "saldo" <= "total" AND
    ("total" > 0 OR ("source" = 'LOCAL_DRAFT' AND "estado" = 'DRAFT'))
  );
