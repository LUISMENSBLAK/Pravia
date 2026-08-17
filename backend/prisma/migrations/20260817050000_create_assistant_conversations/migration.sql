-- Conversaciones persistentes de PRAVIA IA.
-- Evolución aditiva: conserva el asistente, documentos, Storage, auditoría y consumo existentes.

CREATE TABLE IF NOT EXISTS pravia_os.assistant_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  owner_user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Nueva conversación',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  context JSONB,
  summary TEXT,
  summary_updated_at TIMESTAMP(3),
  last_message_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  message_count INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  archived_at TIMESTAMP(3),
  trashed_at TIMESTAMP(3),
  restored_at TIMESTAMP(3),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assistant_conversations_status_check CHECK (status IN ('ACTIVE', 'ARCHIVED', 'TRASHED')),
  CONSTRAINT assistant_conversations_organization_fkey FOREIGN KEY (organization_id) REFERENCES pravia_os.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT assistant_conversations_owner_fkey FOREIGN KEY (owner_user_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS pravia_os.assistant_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'COMPLETE',
  client_message_id TEXT,
  in_reply_to_message_id UUID,
  sources JSONB,
  context_snapshot JSONB,
  provider_response_id TEXT,
  model TEXT,
  prompt_version TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assistant_messages_role_check CHECK (role IN ('USER', 'ASSISTANT')),
  CONSTRAINT assistant_messages_status_check CHECK (status IN ('COMPLETE', 'FAILED')),
  CONSTRAINT assistant_messages_organization_fkey FOREIGN KEY (organization_id) REFERENCES pravia_os.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT assistant_messages_conversation_fkey FOREIGN KEY (conversation_id) REFERENCES pravia_os.assistant_conversations(id) ON DELETE RESTRICT,
  CONSTRAINT assistant_messages_reply_to_fkey FOREIGN KEY (in_reply_to_message_id) REFERENCES pravia_os.assistant_messages(id) ON DELETE RESTRICT,
  CONSTRAINT assistant_messages_conversation_client_key UNIQUE (conversation_id, client_message_id),
  CONSTRAINT assistant_messages_reply_to_key UNIQUE (in_reply_to_message_id)
);

CREATE TABLE IF NOT EXISTS pravia_os.assistant_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  conversation_id UUID NOT NULL,
  message_id UUID,
  uploaded_by_id UUID NOT NULL,
  source TEXT NOT NULL DEFAULT 'TEMPORARY_UPLOAD',
  documento_id UUID,
  original_name TEXT NOT NULL,
  storage_key TEXT,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  extraction JSONB,
  transcription TEXT,
  transcription_model TEXT,
  transcribed_at TIMESTAMP(3),
  expires_at TIMESTAMP(3),
  promoted_at TIMESTAMP(3),
  archived_at TIMESTAMP(3),
  storage_deleted_at TIMESTAMP(3),
  cleanup_error TEXT,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT assistant_attachments_source_check CHECK (source IN ('TEMPORARY_UPLOAD', 'OFFICIAL_DOCUMENT')),
  CONSTRAINT assistant_attachments_status_check CHECK (status IN ('AVAILABLE', 'LINKED', 'ARCHIVED', 'FAILED')),
  CONSTRAINT assistant_attachments_storage_source_check CHECK (
    (source = 'TEMPORARY_UPLOAD' AND storage_key IS NOT NULL AND documento_id IS NULL)
    OR (source = 'OFFICIAL_DOCUMENT' AND storage_key IS NULL AND documento_id IS NOT NULL)
  ),
  CONSTRAINT assistant_attachments_organization_fkey FOREIGN KEY (organization_id) REFERENCES pravia_os.organizations(id) ON DELETE RESTRICT,
  CONSTRAINT assistant_attachments_conversation_fkey FOREIGN KEY (conversation_id) REFERENCES pravia_os.assistant_conversations(id) ON DELETE RESTRICT,
  CONSTRAINT assistant_attachments_message_fkey FOREIGN KEY (message_id) REFERENCES pravia_os.assistant_messages(id) ON DELETE SET NULL,
  CONSTRAINT assistant_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by_id) REFERENCES pravia_os.users(id) ON DELETE RESTRICT,
  CONSTRAINT assistant_attachments_documento_fkey FOREIGN KEY (documento_id) REFERENCES pravia_os.documentos(id) ON DELETE RESTRICT,
  CONSTRAINT assistant_attachments_conversation_hash_source_key UNIQUE (conversation_id, sha256, source)
);

ALTER TABLE pravia_os.ai_usage_logs
  ADD COLUMN IF NOT EXISTS assistant_conversation_id UUID;

ALTER TABLE pravia_os.storage_compensation_jobs
  ADD COLUMN IF NOT EXISTS assistant_attachment_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_logs_assistant_conversation_fkey') THEN
    ALTER TABLE pravia_os.ai_usage_logs
      ADD CONSTRAINT ai_usage_logs_assistant_conversation_fkey
      FOREIGN KEY (assistant_conversation_id) REFERENCES pravia_os.assistant_conversations(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_storage_job_assistant_attachment') THEN
    ALTER TABLE pravia_os.storage_compensation_jobs
      ADD CONSTRAINT fk_storage_job_assistant_attachment
      FOREIGN KEY (assistant_attachment_id) REFERENCES pravia_os.assistant_attachments(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_assistant_conversations_owner_status_last
  ON pravia_os.assistant_conversations(organization_id, owner_user_id, status, last_message_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_conversation_created
  ON pravia_os.assistant_messages(organization_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assistant_attachments_conversation_status_created
  ON pravia_os.assistant_attachments(organization_id, conversation_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_assistant_attachments_documento
  ON pravia_os.assistant_attachments(documento_id);
CREATE INDEX IF NOT EXISTS idx_assistant_attachments_expiry_status
  ON pravia_os.assistant_attachments(expires_at, status);
CREATE INDEX IF NOT EXISTS idx_ai_usage_conversation_created
  ON pravia_os.ai_usage_logs(assistant_conversation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS storage_compensation_jobs_assistant_attachment_id_key
  ON pravia_os.storage_compensation_jobs(assistant_attachment_id);
CREATE INDEX IF NOT EXISTS idx_storage_jobs_assistant_attachment_fk
  ON pravia_os.storage_compensation_jobs(assistant_attachment_id);

CREATE TRIGGER trg_tenant_assistant_messages_conversation
  BEFORE INSERT OR UPDATE ON pravia_os.assistant_messages
  FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('assistant_conversations','conversation_id');
CREATE TRIGGER trg_tenant_assistant_attachments_conversation
  BEFORE INSERT OR UPDATE ON pravia_os.assistant_attachments
  FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('assistant_conversations','conversation_id');
CREATE TRIGGER trg_tenant_assistant_attachments_documento
  BEFORE INSERT OR UPDATE ON pravia_os.assistant_attachments
  FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('documentos','documento_id');
CREATE TRIGGER trg_tenant_assistant_attachments_message
  BEFORE INSERT OR UPDATE ON pravia_os.assistant_attachments
  FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('assistant_messages','message_id');
CREATE TRIGGER trg_tenant_assistant_messages_reply
  BEFORE INSERT OR UPDATE ON pravia_os.assistant_messages
  FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('assistant_messages','in_reply_to_message_id');
CREATE TRIGGER trg_tenant_ai_usage_conversation
  BEFORE INSERT OR UPDATE ON pravia_os.ai_usage_logs
  FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('assistant_conversations','assistant_conversation_id');
CREATE TRIGGER trg_tenant_storage_job_assistant_attachment
  BEFORE INSERT OR UPDATE ON pravia_os.storage_compensation_jobs
  FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_same_organization('assistant_attachments','assistant_attachment_id');
CREATE TRIGGER trg_member_assistant_conversation_owner
  BEFORE INSERT OR UPDATE ON pravia_os.assistant_conversations
  FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership('owner_user_id');
CREATE TRIGGER trg_member_assistant_attachment_uploader
  BEFORE INSERT OR UPDATE ON pravia_os.assistant_attachments
  FOR EACH ROW EXECUTE FUNCTION pravia_os.enforce_organization_membership('uploaded_by_id');
