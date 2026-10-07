-- El autor de un evento debe pertenecer a la misma organización. El FK a
-- users(id) por sí solo no protege contra relaciones cruzadas entre tenants.
CREATE TRIGGER "trg_agenda_creator_membership"
BEFORE INSERT OR UPDATE ON pravia_os.eventos_agenda
FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership('created_by_id');
