-- Additive local-sandbox orchestration states. No existing CFDI is rewritten,
-- renumbered or promoted to fiscal validity; historical states stay unchanged.
ALTER TABLE "pravia_os"."documentos_cfdi" DROP CONSTRAINT "ck_documentos_cfdi_estado";
ALTER TABLE "pravia_os"."documentos_cfdi" ADD CONSTRAINT "ck_documentos_cfdi_estado"
  CHECK ("estado" IN ('DRAFT','PREFACTURA','VIGENTE','TIMBRADO','CANCELACION_SOLICITADA','CANCELADO','SUSTITUIDO','RECIBIDO_VALIDADO',
    'TIMBRANDO_SANDBOX','RECUPERAR_SANDBOX','TIMBRADO_SANDBOX'));
ALTER TABLE "pravia_os"."documentos_cfdi" ADD CONSTRAINT "ck_cfdi_sandbox_intent"
  CHECK ("estado" NOT IN ('TIMBRANDO_SANDBOX','RECUPERAR_SANDBOX','TIMBRADO_SANDBOX') OR COALESCE((
    "provider" = 'FACTURAMA_SANDBOX' AND "source" = 'LOCAL_DRAFT'
    AND "emisor_rfc" = 'EKU9003173C9' AND "receptor_rfc" = 'URE180429TM6'
    AND "draft_payload"->'sandbox_stamp'->>'status' = CASE "estado"
      WHEN 'TIMBRANDO_SANDBOX' THEN 'IN_FLIGHT' WHEN 'RECUPERAR_SANDBOX' THEN 'RECOVERY_REQUIRED' ELSE 'COMPLETED' END
    AND ("estado" <> 'TIMBRADO_SANDBOX' OR ("uuid_fiscal" IS NOT NULL AND "xml_documento_id" IS NOT NULL AND "pdf_documento_id" IS NOT NULL AND "provider_reference" IS NOT NULL))
  ), false));
