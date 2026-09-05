import { describe, expect, it, vi } from 'vitest';
import { ExpedienteReadService } from './expedienteRead.service';

const organizationId = '00000000-0000-4000-8000-00000000b701';
const user: any = {
  id: '00000000-0000-4000-8000-00000000b702',
  organizationId,
  rol: 'ADMINISTRACION',
  scope: 'GLOBAL',
  permissions: ['expedientes.read', 'compliance.read'],
};
const query: any = {
  page: 1,
  pageSize: 25,
  sort: 'updated_at:desc',
};

function database() {
  const record: any = {
    id: '00000000-0000-4000-8000-00000000b703', numero_pravia: 'EXP-0001-2026', numero_notaria: null,
    cliente_alias: 'Caso sintético', estatus: 'ENTREGADO', version: 1, etapa_actual_nombre: 'Entregado',
    proxima_accion: null, fecha_limite_accion: null, fecha_estimada_firma: null, fecha_real_firma: null,
    fecha_entrega_cliente: new Date('2026-09-05T12:00:00.000Z'), created_at: new Date('2026-09-01T12:00:00.000Z'),
    updated_at: new Date('2026-09-05T12:00:00.000Z'), actos: [], abogado: null, notaria: null, etapaActual: null,
    comparecientes: [], complianceReviews: [],
    complianceStates: [{ state: 'PENDIENTE', pending_count: 2, currentReview: { legalRuleResults: [{ id: 'vulnerable-result' }] } }],
    _count: { requisitos_docs: 0, tareas: 0, tareas_externas: 0 },
  };
  return {
    expediente: { findMany: vi.fn().mockResolvedValue([record]), count: vi.fn().mockResolvedValue(1), groupBy: vi.fn().mockResolvedValue([{ estatus: 'ENTREGADO', _count: { _all: 1 } }]) },
    tipoActo: { findMany: vi.fn().mockResolvedValue([]) },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    notaria: { findMany: vi.fn().mockResolvedValue([]) },
    expedienteEtapa: { findMany: vi.fn().mockResolvedValue([]) },
    expedienteComplianceState: { findMany: vi.fn() },
    complianceRuleResult: { findMany: vi.fn() },
  } as any;
}

describe('H7 expediente list compliance projection', () => {
  it('loads vulnerable and compliance indicators in the page query without per-record reads', async () => {
    const db = database();
    const result = await new ExpedienteReadService(db).list(user, query);
    const listQuery = db.expediente.findMany.mock.calls[0][0];
    expect(listQuery.include.complianceStates).toEqual(expect.objectContaining({ take: 1 }));
    expect(listQuery.include.complianceStates.select.currentReview.select.legalRuleResults).toEqual(expect.objectContaining({ take: 1 }));
    expect(db.expedienteComplianceState.findMany).not.toHaveBeenCalled();
    expect(db.complianceRuleResult.findMany).not.toHaveBeenCalled();
    expect(result.data[0]).toMatchObject({
      macrofase: 'ENTREGADO',
      vulnerable: { value: true, label: 'Sí' },
      cumplimiento: { state: 'PENDIENTE', label: 'Pendiente', pending_count: 2 },
    });
  });

  it('does not expose compliance-derived indicators without the existing read permission', async () => {
    const db = database();
    const result = await new ExpedienteReadService(db).list({ ...user, permissions: ['expedientes.read'] }, query);
    expect(result.data[0]).toMatchObject({
      vulnerable: { value: null, label: 'Restringido' },
      cumplimiento: { state: null, label: 'Restringido', pending_count: 0 },
    });
  });
});
