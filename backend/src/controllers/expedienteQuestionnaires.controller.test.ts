import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ComplianceError } from '../domain/compliance';

const service = vi.hoisted(() => ({ saveAnswers: vi.fn() }));
vi.mock('../services/questionnaireCatalog.service', () => ({ questionnaireCatalogService: service }));

import { saveExpedienteQuestionnaireAnswers } from './expedienteQuestionnaires.controller';

const response = () => {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

describe('Expediente questionnaires controller', () => {
  beforeEach(() => vi.clearAllMocks());

  it('preserva código y estatus de errores controlados del motor de cumplimiento', async () => {
    service.saveAnswers.mockRejectedValue(new ComplianceError('Falta metodología compatible.', 'H5_RISK_METHODOLOGY_NOT_CONFIGURED', 409));
    const res = response();
    await saveExpedienteQuestionnaireAnswers({ user: { id: 'user-1' }, params: { id: 'exp-1' }, body: {} } as any, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ code: 'H5_RISK_METHODOLOGY_NOT_CONFIGURED', error: 'Falta metodología compatible.' });
  });
});
