-- Fingerprint lógico BEFORE/AFTER para PRAVIA OS.
-- READ-ONLY. Guardar la salida fuera del repositorio con acceso restringido.

\set ON_ERROR_STOP on
\if :{?FINGERPRINT_LABEL}
\else
  \set FINGERPRINT_LABEL UNSPECIFIED
\endif

BEGIN TRANSACTION READ ONLY;
SELECT :'FINGERPRINT_LABEL' AS fingerprint_label, now() AT TIME ZONE 'UTC' AS captured_at_utc;

SELECT * FROM (
  SELECT 'User' AS metric, count(*)::bigint AS row_count,
         md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) AS id_hash FROM pravia_os.users
  UNION ALL SELECT 'Expediente', count(*), md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) FROM pravia_os.expedientes
  UNION ALL SELECT 'Compareciente', count(*), md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) FROM pravia_os.comparecientes
  UNION ALL SELECT 'Documento', count(*), md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) FROM pravia_os.documentos
  UNION ALL SELECT 'Prospecto', count(*), md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) FROM pravia_os.prospectos
  UNION ALL SELECT 'Cotizacion', count(*), md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) FROM pravia_os.cotizaciones
  UNION ALL SELECT 'Notaria', count(*), md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) FROM pravia_os.notarias
  UNION ALL SELECT 'MovimientoFinanciero', count(*), md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) FROM pravia_os.movimientos_financieros
  UNION ALL SELECT 'CuentaFinanciera', count(*), md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) FROM pravia_os.cuentas_financieras
  UNION ALL SELECT 'EventoAgenda', count(*), md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) FROM pravia_os.eventos_agenda
  UNION ALL SELECT 'Tarea', count(*), md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) FROM pravia_os.tareas
  UNION ALL SELECT 'ComplianceReview', count(*), md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) FROM pravia_os.compliance_reviews
  UNION ALL SELECT 'AuditLog', count(*), md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) FROM pravia_os.audit_logs
) AS business_counts
ORDER BY metric;

SELECT
  count(*) AS documentos,
  COALESCE(sum(size_bytes), 0)::bigint AS metadata_bytes,
  count(DISTINCT storage_key) AS unique_storage_references,
  count(*) FILTER (WHERE storage_key IS NULL OR btrim(storage_key) = '') AS missing_storage_references,
  md5(COALESCE(string_agg(
    concat_ws('|', id::text, storage_key, size_bytes::text, mime_type),
    ',' ORDER BY id::text
  ), '')) AS document_metadata_hash
FROM pravia_os.documentos;

SELECT to_regclass('pravia_os.calculos_isr') IS NOT NULL AS has_calculos_isr \gset
\if :has_calculos_isr
  SELECT 'CalculoISR' AS metric, count(*)::bigint AS row_count,
         md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) AS id_hash
  FROM pravia_os.calculos_isr;
\else
  SELECT 'CalculoISR' AS metric, 0::bigint AS row_count, 'TABLE_ABSENT'::text AS id_hash;
\endif

SELECT to_regclass('pravia_os.organizations') IS NOT NULL AS has_organizations \gset
\if :has_organizations
  SELECT 'Organization' AS metric, count(*)::bigint AS row_count,
         md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), '')) AS id_hash
  FROM pravia_os.organizations
  UNION ALL
  SELECT 'OrganizationMembership', count(*)::bigint,
         md5(COALESCE(string_agg(id::text, ',' ORDER BY id::text), ''))
  FROM pravia_os.organization_memberships;
\else
  SELECT 'Organization' AS metric, 0::bigint AS row_count, 'TABLE_ABSENT'::text AS id_hash
  UNION ALL SELECT 'OrganizationMembership', 0::bigint, 'TABLE_ABSENT'::text;
\endif

SELECT to_regclass('pravia_os.assistant_conversations') IS NOT NULL AS has_assistant \gset
\if :has_assistant
  SELECT 'AssistantConversation' AS metric, count(*)::bigint AS row_count FROM pravia_os.assistant_conversations
  UNION ALL SELECT 'AssistantMessage', count(*)::bigint FROM pravia_os.assistant_messages
  UNION ALL SELECT 'AssistantAttachment', count(*)::bigint FROM pravia_os.assistant_attachments;
\else
  SELECT 'AssistantConversation' AS metric, 0::bigint AS row_count
  UNION ALL SELECT 'AssistantMessage', 0::bigint
  UNION ALL SELECT 'AssistantAttachment', 0::bigint;
\endif

ROLLBACK;
