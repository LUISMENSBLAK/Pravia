'use strict';

// Retired by EXP-002. The legacy script previously rewrote every
// expedientes.tipo_acto_id and is intentionally kept as an explicit guard so
// old runbooks cannot mutate the non-canonical field.
throw new Error(
  'LEGACY_ACT_WRITER_RETIRED: use POST /api/expedientes/:id/actos/preview and /actos/aplicar.',
);
