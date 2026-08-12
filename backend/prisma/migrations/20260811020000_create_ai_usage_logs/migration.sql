-- Additive ledger for AI requests. It stores usage metadata only, never API keys or document bodies.

CREATE TABLE IF NOT EXISTS pravia_os.ai_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL DEFAULT 'OPENAI',
  modelo TEXT NOT NULL,
  operacion TEXT NOT NULL,
  estatus TEXT NOT NULL DEFAULT 'COMPLETADO',
  usuario_id UUID,
  expediente_id UUID,
  compareciente_alta_session_id UUID,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  duracion_ms INTEGER NOT NULL DEFAULT 0,
  costo_estimado_usd DECIMAL(12, 6) NOT NULL DEFAULT 0,
  documentos_enviados INTEGER NOT NULL DEFAULT 0,
  escalamiento_utilizado BOOLEAN NOT NULL DEFAULT false,
  escalamiento_motivo TEXT,
  error_codigo TEXT,
  metadata JSONB,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_logs_usuario_id_fkey') THEN
    ALTER TABLE pravia_os.ai_usage_logs
      ADD CONSTRAINT ai_usage_logs_usuario_id_fkey
      FOREIGN KEY (usuario_id) REFERENCES pravia_os.users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_logs_expediente_id_fkey') THEN
    ALTER TABLE pravia_os.ai_usage_logs
      ADD CONSTRAINT ai_usage_logs_expediente_id_fkey
      FOREIGN KEY (expediente_id) REFERENCES pravia_os.expedientes(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_usage_logs_compareciente_alta_session_id_fkey') THEN
    ALTER TABLE pravia_os.ai_usage_logs
      ADD CONSTRAINT ai_usage_logs_compareciente_alta_session_id_fkey
      FOREIGN KEY (compareciente_alta_session_id)
      REFERENCES pravia_os.compareciente_alta_sessions(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_usage_logs_created_at_idx
  ON pravia_os.ai_usage_logs(created_at);
CREATE INDEX IF NOT EXISTS ai_usage_logs_modelo_created_at_idx
  ON pravia_os.ai_usage_logs(modelo, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_logs_usuario_id_created_at_idx
  ON pravia_os.ai_usage_logs(usuario_id, created_at);
CREATE INDEX IF NOT EXISTS ai_usage_logs_expediente_id_created_at_idx
  ON pravia_os.ai_usage_logs(expediente_id, created_at);
