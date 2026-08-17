-- Preserve historical rows as-is, but prevent every future write from making
-- a movement's distribution exceed its absolute amount. Partial distributions
-- remain valid and are completed later through the canonical workflow.

CREATE OR REPLACE FUNCTION "assert_finance_distribution_ceiling"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  target_movement_id UUID;
  movement_amount DECIMAL(14,2);
  distributed_amount DECIMAL(14,2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_movement_id := OLD."movimiento_id";
  ELSE
    target_movement_id := NEW."movimiento_id";
  END IF;

  SELECT ABS("monto")
    INTO movement_amount
    FROM "movimientos_financieros"
   WHERE "id" = target_movement_id
   FOR UPDATE;

  IF movement_amount IS NULL THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM("monto"), 0)
    INTO distributed_amount
    FROM "movimiento_distribuciones"
   WHERE "movimiento_id" = target_movement_id;

  IF distributed_amount > movement_amount THEN
    RAISE EXCEPTION 'FINANCE_DISTRIBUTION_EXCEEDS_TOTAL'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "movement_distribution_ceiling_guard"
AFTER INSERT OR UPDATE OF "monto", "movimiento_id" OR DELETE
ON "movimiento_distribuciones"
FOR EACH ROW
EXECUTE FUNCTION "assert_finance_distribution_ceiling"();

CREATE OR REPLACE FUNCTION "assert_finance_movement_amount_ceiling"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  distributed_amount DECIMAL(14,2);
BEGIN
  SELECT COALESCE(SUM("monto"), 0)
    INTO distributed_amount
    FROM "movimiento_distribuciones"
   WHERE "movimiento_id" = NEW."id";

  IF distributed_amount > ABS(NEW."monto") THEN
    RAISE EXCEPTION 'FINANCE_DISTRIBUTION_EXCEEDS_TOTAL'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "movement_amount_distribution_ceiling_guard"
BEFORE UPDATE OF "monto"
ON "movimientos_financieros"
FOR EACH ROW
EXECUTE FUNCTION "assert_finance_movement_amount_ceiling"();
