import type { Response } from 'express';
import { ProspectWorkflowError } from '../domain/prospectWorkflow';

export function prospectWorkflowError(res: Response, error: unknown) {
  if (error instanceof ProspectWorkflowError) return res.status(error.status).json({ error: error.message, code: error.code });
  const code = (error as { code?: string })?.code;
  if (['P2002', 'P2034', 'P2028'].includes(code ?? '')) return res.status(409).json({
    error: 'La operación cambió o no pudo confirmarse. Actualiza la ficha antes de volver a intentarlo.', code: 'PRO001_CONFLICT',
  });
  return res.status(500).json({ error: 'No pudimos completar la operación. Inténtalo de nuevo.', code: 'PRO001_UNAVAILABLE' });
}
