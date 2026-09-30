import { describe, expect, it, vi } from 'vitest';
import { ExpedienteFinanceService } from './expedienteFinance.service';

const actor = { id: 'user-1', organizationId: 'org-1', sessionId: 'session-1', rol: 'ADMINISTRACION', scope: 'GLOBAL', permissions: ['expedientes.read', 'finanzas.read', 'documentos.read', 'documentos.write'] } as any;

describe('estado de cuenta canónico del expediente', () => {
  it('separa honorarios y recursos no propios con centavos exactos, sin duplicar movimientos', async () => {
    const db: any = {
      expediente: { findFirst: vi.fn().mockResolvedValue({ id: 'exp-1', numero_pravia: 'EXP-0001-2026', cliente_alias: 'Cliente', notaria: { nombre: 'Notaría' }, actos: [] }) },
      expedientePresupuesto: { findFirst: vi.fn().mockResolvedValue({ id: 'budget-1', version: 3, subtotal_honorarios: '116000.10', subtotal_impuestos_derechos: '24000.20', total: '140000.30', conceptos: [] }) },
      movimientoFinanciero: { findMany: vi.fn().mockResolvedValue([
        { id: 'income-1', naturaleza: 'INGRESO', monto: '50000.15', categoria: 'DISTRIBUIDO', concepto: 'Anticipo', fecha_movimiento: new Date('2026-09-20'), estatus: 'APLICADO', distribuciones: [{ monto: '40000.10', categoria: { naturaleza: 'DESPACHO' } }, { monto: '10000.05', categoria: { naturaleza: 'TERCERO' } }] },
        { id: 'expense-1', naturaleza: 'EGRESO', monto: '3000.01', categoria: 'TERCERO', concepto: 'Derecho', fecha_movimiento: new Date('2026-09-21'), estatus: 'APLICADO', distribuciones: [{ monto: '3000.01', categoria: { naturaleza: 'TERCERO' } }] },
      ]) },
    };
    const result = await new ExpedienteFinanceService(db).accountStatement(actor, 'exp-1');
    expect(result?.sections).toEqual([
      { key: 'FEES', label: 'Honorarios', budgeted: '116000.10', collected: '40000.10', pending: '76000.00' },
      { key: 'THIRD_PARTY', label: 'Recursos no propios / impuestos y derechos', budgeted: '24000.20', collected: '10000.05', pending: '14000.15' },
    ]);
    expect(result?.totals).toEqual({ budget: '140000.30', collected: '50000.15', pending: '90000.15', thirdPartyPendingApplication: '7000.04' });
    expect(result?.movements).toHaveLength(2);
    expect(db.movimientoFinanciero.findMany.mock.calls[0][0].where).toMatchObject({ organization_id: 'org-1', expediente_id: 'exp-1' });
  });

  it('no inventa estado de cuenta si no existe presupuesto vigente', async () => {
    const db: any = { expediente: { findFirst: vi.fn().mockResolvedValue({ id: 'exp-1', numero_pravia: 'EXP-1', notaria: null, actos: [] }) }, expedientePresupuesto: { findFirst: vi.fn().mockResolvedValue(null) }, movimientoFinanciero: { findMany: vi.fn().mockResolvedValue([]) } };
    await expect(new ExpedienteFinanceService(db).accountStatement(actor, 'exp-1')).resolves.toBeNull();
  });
});
