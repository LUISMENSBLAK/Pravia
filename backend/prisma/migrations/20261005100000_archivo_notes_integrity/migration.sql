-- Las notas de Archivo usan el mismo vínculo documental canónico y el mismo
-- control físico de tenant, expediente e instrumento que el apéndice.
CREATE OR REPLACE FUNCTION pravia_os.guard_archivo_appendix_link() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.source_entity_type = 'ArchivoRegistro'
    AND (NEW.source_entity_type IS DISTINCT FROM OLD.source_entity_type
      OR NEW.source_entity_id IS DISTINCT FROM OLD.source_entity_id
      OR NEW.expediente_id IS DISTINCT FROM OLD.expediente_id
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.documento_id IS DISTINCT FROM OLD.documento_id) THEN
    RAISE EXCEPTION 'ARCHIVO_DOCUMENT_IDENTITY_IMMUTABLE' USING ERRCODE = '23514';
  END IF;
  IF NEW.source_entity_type = 'ArchivoRegistro' THEN
    IF NEW.organization_id IS NULL OR NEW.source_entity_id IS NULL
      OR NEW.source_context NOT IN ('APENDICE_ARCHIVO', 'NOTA_ARCHIVO')
      OR NOT EXISTS (
        SELECT 1 FROM pravia_os.archivo_registros archive
        WHERE archive.id = NEW.source_entity_id
          AND archive.organization_id = NEW.organization_id
          AND archive.expediente_id = NEW.expediente_id
          AND archive.clase = 'INSTRUMENTO'
      )
      OR NOT EXISTS (
        SELECT 1 FROM pravia_os.documentos doc
        WHERE doc.id = NEW.documento_id
          AND doc.organization_id = NEW.organization_id
          AND doc.expediente_id = NEW.expediente_id
      ) THEN
      RAISE EXCEPTION 'ARCHIVO_DOCUMENT_TENANT_INTEGRITY' USING ERRCODE = '23503';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
