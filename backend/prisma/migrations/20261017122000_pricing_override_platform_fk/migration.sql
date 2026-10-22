ALTER TABLE "pricing_overrides"
  ADD CONSTRAINT "fk_pricing_overrides_platform_approver"
  FOREIGN KEY ("approved_by_platform_id")
  REFERENCES "platform_administrators"("id")
  ON DELETE RESTRICT ON UPDATE NO ACTION;
