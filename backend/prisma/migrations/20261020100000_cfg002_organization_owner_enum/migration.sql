-- Expand only. PostgreSQL requires the new enum value to commit before it can
-- be used by the separate data migration.
ALTER TYPE "pravia_os"."CatalogoPropietarioTipo" ADD VALUE IF NOT EXISTS 'ORGANIZACION';
