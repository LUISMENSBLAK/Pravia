-- COL35: only Prospectos may be created without an assigned responsible.
-- Existing assignments and all historical rows remain unchanged.
ALTER TABLE "pravia_os"."prospectos" ALTER COLUMN "user_id" DROP NOT NULL;
