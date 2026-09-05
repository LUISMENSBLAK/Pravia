import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const db: any = {
    $queryRaw: vi.fn(),
    expedienteComplianceState: { findMany: vi.fn() },
    expediente: { findMany: vi.fn() },
    tipoActo: { findMany: vi.fn() },
  };
  return { db };
});
vi.mock('../config/prisma', () => ({ default: mocks.db }));

import { ComplianceH8Service, H8_FILTERS, parseH8PanelQuery } from './complianceH8.service';

const org = '00000000-0000-4000-8000-00000000c801';
const userId = '00000000-0000-4000-8000-00000000c802';
const actor: any = { id: userId, organizationId: org, rol: 'ABOGADO', permissions: ['compliance.read'] };
const query = parseH8PanelQuery({});
const state = {
  id: 'state-1', state: 'PENDIENTE', pending_count: 3,
  expediente: {
    id: 'exp-1', numero_pravia: 'EXP-0042-2026', numero_notaria: null,
    datos_operacion: { numero_escritura: null }, estatus: 'ENTREGADO',
    abogado: { id: userId, nombre: 'Andrea', apellido: 'Ruiz' },
    notaria: { id: 'not-1', nombre: 'Notaría Central', numero_notaria: '12' },
    actos: [
      { tipo_acto: { id: 'act-1', nombre: 'Compraventa' } },
      { tipo_acto: { id: 'act-2', nombre: 'Poder' } },
    ],
    comparecientes: [
      { es_principal: true, compareciente: { id: 'person-1', nombre_busqueda: 'María López' } },
      { es_principal: false, compareciente: { id: 'person-2', nombre_busqueda: 'Juan López' } },
    ],
  },
};

const summary = { total: 1n, pending: 1n, notices: 1n, approaching: 0n, expired: 0n };
const ordered = [{ state_id: 'state-1', expediente_id: 'exp-1', current_review_id: 'review-1', urgency_bucket: 'PENDIENTE', next_due: null, notice_count: 2n, notice_pending_count: 2n, notice_presented_count: 1n, notice_fulfilled_count: 0n, notice_overdue_count: 0n, vulnerable: true }];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.db.$queryRaw.mockResolvedValueOnce([summary]).mockResolvedValueOnce(ordered);
  mocks.db.expedienteComplianceState.findMany.mockResolvedValue([state]);
  mocks.db.expediente.findMany.mockResolvedValueOnce([{ abogado: state.expediente.abogado }]).mockResolvedValueOnce([{ notaria: state.expediente.notaria }]);
  mocks.db.tipoActo.findMany.mockResolvedValue(state.expediente.actos.map((item) => item.tipo_acto));
});

describe('H8 central compliance read model', () => {
  it('accepts only the seven frozen filters and bounds server pagination', () => {
    expect(H8_FILTERS).toHaveLength(7);
    expect(parseH8PanelQuery({ filter: 'PRESENTADOS', page: '-2', page_size: '1000' })).toMatchObject({ filter: 'PRESENTADOS', page: 1, pageSize: 100 });
    expect(parseH8PanelQuery({ filter: 'INVENTADO' }).filter).toBe('TODOS');
  });

  it('returns one row per expediente with canonical principal, lawyer and compact multi-act data', async () => {
    const result = await new ComplianceH8Service(mocks.db).panel(actor, query, new Date('2026-09-05T18:00:00.000Z'));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      expediente_id: 'exp-1', escritura: null, operational_status: 'ENTREGADO',
      compareciente_principal: { id: 'person-1', nombre: 'María López' },
      abogado: { nombre: 'Andrea Ruiz' }, cumplimiento: { code: 'PENDIENTE', pending_count: 3 },
      aviso: { code: 'PENDIENTE', pending: 2, count: 2 }, vulnerable: true,
    });
    expect(result.rows[0].actos).toHaveLength(2);
  });

  it('does not conflate presented with fulfilled when another notice remains pending', async () => {
    const result = await new ComplianceH8Service(mocks.db).panel(actor, query);
    expect(result.rows[0].aviso).toMatchObject({ code: 'PENDIENTE', pending: 2, label: '1 pendiente · 1 presentado' });
  });

  it('uses fixed aggregate/detail/options queries instead of a query per row', async () => {
    await new ComplianceH8Service(mocks.db).panel(actor, query);
    expect(mocks.db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(mocks.db.expedienteComplianceState.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.db.expediente.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.db.tipoActo.findMany).toHaveBeenCalledTimes(1);
  });

  it('applies tenant and object visibility to the same SQL read model used by KPIs and rows', async () => {
    await new ComplianceH8Service(mocks.db).panel(actor, query);
    const sqlCalls = mocks.db.$queryRaw.mock.calls.map(([fragment]: any[]) => fragment.strings.join(' '));
    expect(sqlCalls.every((sql: string) => sql.includes('s.organization_id') && sql.includes('e.organization_id'))).toBe(true);
    expect(sqlCalls.every((sql: string) => sql.includes('e.abogado_id') && sql.includes('e.creador_id'))).toBe(true);
  });

  it('keeps server-side search, secondary filters, date range and primary filtering in SQL', async () => {
    const filtered = parseH8PanelQuery({ filter: 'VENCIDOS', search: 'EXP-0042', lawyer_id: userId, act_id: '00000000-0000-4000-8000-00000000c803', notaria_id: '00000000-0000-4000-8000-00000000c804', from: '2026-09-01', to: '2026-09-30' });
    await new ComplianceH8Service(mocks.db).panel(actor, filtered);
    const sql = mocks.db.$queryRaw.mock.calls[1][0].strings.join(' ');
    expect(sql).toContain('numero_pravia ILIKE');
    expect(sql).toContain('expediente_comparecientes');
    expect(sql).toContain('tipo_acto_id');
    expect(sql).toContain("urgency_bucket = 'VENCIDO'");
    expect(sql).toContain('next_due >=');
  });

  it('derives urgency from deadlines and canonical open alert levels without numeric timing defaults', async () => {
    await new ComplianceH8Service(mocks.db).panel(actor, query);
    const sql = mocks.db.$queryRaw.mock.calls[1][0].strings.join(' ');
    expect(sql).toContain("a.level = 'CRITICA'");
    expect(sql).toContain("a.level = 'ADVERTENCIA'");
    expect(sql).toContain('rr.vulnerable_activity = true');
    expect(sql).toContain("'PRESENTADO','ACUSE_CARGADO'");
    expect(sql).toContain("WHEN next_due >=");
    expect(sql).not.toMatch(/INTERVAL\s+'\d+ day/i);
  });

  it('returns empty panel state without loading row detail', async () => {
    vi.resetAllMocks();
    mocks.db.$queryRaw.mockResolvedValueOnce([{ total: 0n, pending: 0n, notices: 0n, approaching: 0n, expired: 0n }]).mockResolvedValueOnce([]);
    mocks.db.expediente.findMany.mockResolvedValue([]); mocks.db.tipoActo.findMany.mockResolvedValue([]);
    const result = await new ComplianceH8Service(mocks.db).panel(actor, query);
    expect(result.rows).toEqual([]); expect(result.meta.total).toBe(0);
    expect(mocks.db.expedienteComplianceState.findMany).not.toHaveBeenCalled();
  });

  it('shows the Notaría selector only for a real multi-Notaría scope', async () => {
    mocks.db.expediente.findMany.mockReset().mockResolvedValueOnce([{ abogado: state.expediente.abogado }]).mockResolvedValueOnce([{ notaria: state.expediente.notaria }, { notaria: { id: 'not-2', nombre: 'Otra', numero_notaria: '8' } }]);
    const result = await new ComplianceH8Service(mocks.db).panel(actor, query);
    expect(result.filters.show_notaria).toBe(true);
    expect(result.filters.notaries).toHaveLength(2);
  });
});
