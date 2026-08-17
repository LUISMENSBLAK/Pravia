-- Compareciente workspace: human-authored notarial notes.
-- Additive and nullable to preserve every existing record.
ALTER TABLE "comparecientes"
ADD COLUMN IF NOT EXISTS "observaciones" TEXT;
