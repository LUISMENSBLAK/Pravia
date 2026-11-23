-- Extend the existing gateway catalog; no provider/model or monetary price is
-- introduced. If the source configuration is absent, execution stays closed.
INSERT INTO "pravia_os"."ai_operation_catalog"
  (operation_code, billing_class, required_capability, quality_tier, max_input, max_output, max_charge_minor, allow_fallback, active)
SELECT 'ISR_OPERATION_INTERPRETATION', 'CUSTOMER_WALLET', 'ia.execute', quality_tier,
  max_input, LEAST(max_output, 6000), max_charge_minor, allow_fallback, active
FROM "pravia_os"."ai_operation_catalog"
WHERE operation_code = 'DOCUMENT_STRUCTURED_EXTRACTION'
ON CONFLICT (operation_code) DO NOTHING;

INSERT INTO "pravia_os"."ai_routing_policy_versions"
  (operation_code, version, routing_rules_json, effective_from, active)
SELECT 'ISR_OPERATION_INTERPRETATION', 1, routing_rules_json, CURRENT_TIMESTAMP, active
FROM "pravia_os"."ai_routing_policy_versions"
WHERE operation_code = 'DOCUMENT_STRUCTURED_EXTRACTION' AND active = true AND effective_from <= CURRENT_TIMESTAMP
ORDER BY version DESC LIMIT 1
ON CONFLICT (operation_code, version) DO NOTHING;

-- Usage-priced execution: reuse the approved configurable margin floor only.
-- A fixed commercial charge from another operation must never be copied.
INSERT INTO "pravia_os"."commercial_sku_versions"
  (sku, kind, quantity, unit, sale_price_minor, currency, min_markup_multiplier, effective_from, version, active)
SELECT 'AI_USAGE:ISR_OPERATION_INTERPRETATION', kind, quantity, unit, NULL,
  currency, min_markup_multiplier, CURRENT_TIMESTAMP, 1, active
FROM "pravia_os"."commercial_sku_versions"
WHERE sku = 'AI_USAGE:DOCUMENT_STRUCTURED_EXTRACTION' AND active = true
  AND effective_from <= CURRENT_TIMESTAMP AND (effective_to IS NULL OR effective_to > CURRENT_TIMESTAMP)
ORDER BY version DESC LIMIT 1
ON CONFLICT (sku, version) DO NOTHING;
