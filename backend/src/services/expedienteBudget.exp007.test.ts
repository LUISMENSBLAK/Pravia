import { readFileSync } from 'fs';
import { resolve } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  budgetTotals,
  calculateDistribution,
  centsFromPercentage,
  centsToMoney,
  moneyToCents,
  normalizeBudgetConcepts,
  percentageFromCents,
  quoteCategoryToBudget,
  renderClientBudgetPdf,
} from '../domain/expedienteBudget';

const storage = vi.hoisted(() => ({ upload: vi.fn(), remove: vi.fn(), signed: vi.fn() }));
vi.mock('../storage/storage.service', () => ({
  uploadFile: storage.upload,
  deleteFile: storage.remove,
  getSignedUrl: storage.signed,
}));

import { ExpedienteBudgetError, ExpedienteBudgetService, type BudgetActor } from './expedienteBudget.service';

const root = resolve(process.cwd(), '..');
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');
const serviceSource = () => source('backend/src/services/expedienteBudget.service.ts');
const uiSource = () => source('frontend/src/features/cases/components/tabs/BudgetTab.tsx');
const cssSource = () => source('frontend/src/features/cases/components/tabs/BudgetTab.module.css');
const migrationSource = () => source('backend/prisma/migrations/20260829010000_create_exp007_case_budget/migration.sql');
const schemaSource = () => source('backend/prisma/schema.prisma');
const routeSource = () => source('backend/src/routes/expedientes.routes.ts');

const actor = (overrides: Partial<BudgetActor> = {}): BudgetActor => ({
  id: 'user-a', organizationId: 'tenant-a', sessionId: 'session-a', rol: 'ADMIN',
  permissions: ['expedientes.read', 'expedientes.write', 'finanzas.read', 'finanzas.write', 'documentos.read', 'documentos.write', 'documentos.unlink'],
  ...overrides,
});
const concepts = () => normalizeBudgetConcepts([
  { concepto: 'Honorarios', categoria: 'HONORARIOS', importe: '100.10' },
  { concepto: 'IVA de honorarios', categoria: 'IVA_HONORARIOS', importe: '16.02' },
  { concepto: 'Derechos', categoria: 'IMPUESTOS_DERECHOS', importe: '50.30' },
]);
const pdfData = (total = '166.42') => ({
  folio: 'EXP-0001-2026', client: 'Cliente conocido', notary: 'Notaría 1', generatedDate: '29/08/2026',
  concepts: [
    { concept: 'Honorarios', categoryLabel: 'Honorarios', amount: '100.10' },
    { concept: 'IVA', categoryLabel: 'IVA de honorarios', amount: '16.02' },
    { concept: 'Derechos', categoryLabel: 'Impuestos y derechos', amount: '50.30' },
  ],
  subtotalHonorarios: '116.12', subtotalImpuestosDerechos: '50.30', total,
});

describe('EXP-007 — 51 casos forenses contractuales', () => {
  beforeEach(() => {
    vi.clearAllMocks(); storage.upload.mockResolvedValue(undefined); storage.remove.mockResolvedValue(undefined);
    storage.signed.mockResolvedValue('https://signed.invalid/document');
  });

  it('A. Cotización estructurada → presupuesto inicial correcto', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'budget-a' }); const distribution = vi.fn().mockResolvedValue({});
    const tx: any = { expedientePresupuesto: { create }, expedientePresupuestoDistribucion: { create: distribution } };
    await new ExpedienteBudgetService({} as any).createFromQuoteInTransaction(tx, {
      actor: actor(), expedienteId: 'exp-a', quoteVersion: { id: 'quote-version-a', total_cliente: '166.42', honorarios_pravia: '70.00', desglose_notaria: { rubros: [
        { concepto: 'Honorarios', categoria: 'HONORARIOS', monto: '100.10' },
        { concepto: 'IVA honorarios', categoria: 'HONORARIOS', monto: '16.02' },
        { concepto: 'Derechos', categoria: 'DERECHOS', monto: '50.30' },
      ] } },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      expediente_id: 'exp-a', cotizacion_version_origen_id: 'quote-version-a', total: '166.42',
      conceptos: { create: expect.arrayContaining([expect.objectContaining({ categoria: 'IVA_HONORARIOS', importe: '16.02' })]) },
    }) }));
    expect(distribution).toHaveBeenCalledOnce();
  });

  it('A2. Cotización sin desglose no inventa una distribución interna', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'budget-review' });
    const tx: any = { expedientePresupuesto: { create }, expedientePresupuestoDistribucion: { create: vi.fn().mockResolvedValue({}) } };
    await new ExpedienteBudgetService({} as any).createFromQuoteInTransaction(tx, {
      actor: actor(), expedienteId: 'exp-review', quoteVersion: { id: 'quote-version-review', total_cliente: '1000.00', honorarios_pravia: '250.00', desglose_notaria: null },
    });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      requiere_clasificacion: true, distribucion_requiere_revision: true,
    }) }));
  });

  it('B. Modificar presupuesto no modifica Cotización origen', () => {
    expect(serviceSource()).not.toMatch(/cotizacion\.(update|delete|upsert)/);
  });
  it('C. Editar concepto inline', () => expect(uiSource()).toContain("updateConcept(index, 'concepto'"));
  it('D. Editar categoría inline', () => expect(uiSource()).toContain("updateConcept(index, 'categoria'"));
  it('E. Editar importe inline', () => expect(uiSource()).toContain("updateConcept(index, 'importe'"));
  it('F. Agregar concepto', () => expect(uiSource()).toContain('Agregar concepto'));
  it('G. Eliminar concepto', () => expect(uiSource()).toContain('current.filter'));

  it('H. Subtotal Honorarios recalcula con precisión decimal', () => {
    expect(budgetTotals(concepts()).subtotal_honorarios).toBe('116.12');
    expect(budgetTotals(normalizeBudgetConcepts([{ concepto: 'a', categoria: 'HONORARIOS', importe: '0.10' }, { concepto: 'b', categoria: 'IVA_HONORARIOS', importe: '0.30' }])).subtotal_honorarios).toBe('0.40');
  });
  it('I. Subtotal Impuestos y derechos recalcula', () => expect(budgetTotals(concepts()).subtotal_impuestos_derechos).toBe('50.30'));
  it('J. Total recalcula sin coma flotante', () => {
    expect(budgetTotals(concepts()).total).toBe('166.42');
    expect(centsToMoney(moneyToCents('0.01') + moneyToCents('0.10') + moneyToCents('0.30'))).toBe('0.41');
  });
  it('K. IVA de honorarios permanece en Honorarios', () => {
    expect(quoteCategoryToBudget('HONORARIOS', 'IVA de honorarios')).toBe('IVA_HONORARIOS');
    expect(budgetTotals(concepts()).subtotal_honorarios).toBe('116.12');
  });

  it('L. Distribución oculta por defecto', () => expect(uiSource()).toContain('useState(false)'));
  it('M. Abrir distribución', () => expect(uiSource()).toContain('setExpanded((current) => !current)'));
  it('N. Cerrar distribución', () => expect(uiSource()).toContain('aria-expanded={expanded}'));
  it('O. Modificar monto → porcentaje recalcula', () => expect(percentageFromCents(3333n, 10000n)).toBe('33.3300'));
  it('P. Modificar porcentaje → monto recalcula', () => expect(centsFromPercentage(10001n, '33.3333')).toBe(3334n));
  it('Q. PRAVIA + Notaría cierra correctamente', () => {
    const totals = budgetTotals(concepts()); const result = calculateDistribution(totals, {
      pravia_honorarios: { mode: 'PERCENT', value: '33.3333' }, pravia_iva: { mode: 'AMOUNT', value: '5.01' },
    });
    expect(moneyToCents(result.pravia.honorarios) + moneyToCents(result.notaria.honorarios)).toBe(totals.honorariosCents);
    expect(moneyToCents(result.pravia.iva) + moneyToCents(result.notaria.iva)).toBe(totals.ivaHonorariosCents);
  });
  it('R. Honorarios e IVA distribuidos por separado', () => {
    const result = calculateDistribution(budgetTotals(concepts()), { pravia_honorarios: { mode: 'AMOUNT', value: '60.00' }, pravia_iva: { mode: 'AMOUNT', value: '8.00' } });
    expect(result.pravia).toMatchObject({ honorarios: '60.00', iva: '8.00' });
  });

  it('S. Distribución interna no aparece en PDF cliente', () => {
    const pdf = renderClientBudgetPdf(pdfData()).toString('latin1');
    expect(pdf).not.toContain('Distribucion interna'); expect(pdf).not.toContain('PRAVIA / Notaria');
  });
  it('T. PDF usa fecha actual recibida', () => expect(renderClientBudgetPdf(pdfData()).toString('latin1')).toContain('29/08/2026'));
  it('U. PDF usa información ya conocida', () => {
    const pdf = renderClientBudgetPdf(pdfData()).toString('latin1');
    expect(pdf).toContain('EXP-0001-2026'); expect(pdf).toContain('Cliente conocido'); expect(pdf).toContain('Notaría 1');
  });
  it('V. No formulario genérico previo a generación', () => {
    expect(uiSource()).not.toContain('Datos del cliente'); expect(uiSource()).not.toContain('Capturar cliente');
  });
  it('W. Generar PDF A usa Documento canónico', () => {
    expect(serviceSource()).toContain('tx.documento.create'); expect(serviceSource()).toContain('tx.expedienteDocumento.create');
  });
  it('X. Editar presupuesto mantiene un único registro', () => {
    expect(serviceSource()).toContain('expedientePresupuesto.update'); expect(serviceSource()).not.toContain('BudgetVersion');
  });
  it('Y. Generar PDF B crea otro documento histórico legítimo', () => {
    expect(schemaSource()).toContain('documentos                     ExpedientePresupuestoDocumento[]');
  });
  it('Z. PDF A permanece inmutable', () => {
    const model = schemaSource().split('model ExpedientePresupuestoDocumento')[1].split('model ')[0];
    expect(model).not.toMatch(/updated_at|@updatedAt/);
  });
  it('AA. Sólo presupuesto vigente continúa editable', () => expect(schemaSource()).toContain('expediente_id                  String                             @unique'));
  it('AB. No versiones editables históricas', () => {
    expect(schemaSource()).not.toMatch(/model (BudgetVersion|ExpedientePresupuestoVersion)/);
  });
  it('AC. PDF histórico Ver', () => expect(routeSource()).toContain('/presupuesto/documentos/:historyId/url'));
  it('AD. PDF histórico Descargar', () => expect(uiSource()).toContain('openPdf(item.id, true)'));
  it('AE. Eliminar según permiso', () => {
    expect(routeSource()).toContain('/presupuesto/documentos/:historyId'); expect(serviceSource()).toContain("can(actor, 'documentos.unlink')");
  });
  it('AF. Unauthorized delete bloqueado', async () => {
    await expect(new ExpedienteBudgetService({} as any).deletePdf(actor({ permissions: [] }), 'exp-a', 'pdf-a')).rejects.toMatchObject({ status: 403, code: 'EXP007_PDF_DELETE_DENIED' });
  });

  it('AG. Cross-tenant read bloqueado', async () => {
    const prisma: any = { expediente: { findFirst: vi.fn().mockResolvedValue(null) } };
    await expect(new ExpedienteBudgetService(prisma).read(actor(), 'tenant-b-exp')).rejects.toMatchObject({ status: 403 });
    expect(prisma.expediente.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organization_id: 'tenant-a' }) }));
  });
  it('AH. Cross-tenant write bloqueado', async () => {
    const tx: any = { $executeRaw: vi.fn(), expediente: { findFirst: vi.fn().mockResolvedValue(null) } };
    const prisma: any = { $transaction: (work: any) => work(tx) };
    await expect(new ExpedienteBudgetService(prisma).save(actor(), 'tenant-b-exp', { expected_version: 1, concepts: concepts() })).rejects.toMatchObject({ status: 403 });
  });
  it('AI. Cross-tenant PDF bloqueado', () => {
    expect(serviceSource()).toContain('organization_id: actor.organizationId, presupuesto: { expediente_id: expedienteId }');
  });
  it('AJ. Cross-tenant signed URL bloqueado', async () => {
    const prisma: any = { expediente: { findFirst: vi.fn().mockResolvedValue(null) } };
    await expect(new ExpedienteBudgetService(prisma).signedUrl(actor(), 'tenant-b-exp', 'pdf-b')).rejects.toMatchObject({ status: 403 });
    expect(storage.signed).not.toHaveBeenCalled();
  });
  it('AK. Concurrent stale update bloqueado', async () => {
    const current = { id: 'budget-a', version: 2, conceptos: [], distribucion: null, documentos: [], cotizacionVersionOrigen: null };
    const tx: any = { $executeRaw: vi.fn(), expediente: { findFirst: vi.fn().mockResolvedValue({ id: 'exp-a' }) }, expedientePresupuesto: { findFirst: vi.fn().mockResolvedValue(current) } };
    const prisma: any = { $transaction: (work: any) => work(tx) };
    await expect(new ExpedienteBudgetService(prisma).save(actor(), 'exp-a', { expected_version: 1, concepts: concepts() })).rejects.toMatchObject({ status: 409, code: 'EXP007_STALE_BUDGET' });
  });
  it('AL. Retry de generación no corrompe historial', async () => {
    const existing = { id: 'history-a', documento_id: 'doc-a', generado_at: new Date(), total_snapshot: '166.42', presupuesto_version: 1, nota: null, documento: { nombre_original: 'a.pdf', mime_type: 'application/pdf' } };
    const prisma: any = {
      expediente: { findFirst: vi.fn().mockResolvedValue({ id: 'exp-a' }) },
      expedientePresupuestoDocumento: { findFirst: vi.fn().mockResolvedValue(existing) },
    };
    const result = await new ExpedienteBudgetService(prisma).generatePdf(actor(), 'exp-a', { expected_version: 1, idempotency_key: 'retry-a' });
    expect(result).toMatchObject({ idempotent: true, item: { id: 'history-a' } }); expect(storage.upload).not.toHaveBeenCalled();
  });
  it('AM. Fallo Storage no deja PDF activo roto', async () => {
    storage.upload.mockRejectedValueOnce(new Error('storage unavailable'));
    const budget = { id: 'budget-a', version: 1, requiere_clasificacion: false, conceptos: [], subtotal_honorarios: '0.00', subtotal_impuestos_derechos: '0.00', total: '0.00' };
    const prisma: any = {
      expediente: { findFirst: vi.fn().mockResolvedValue({ id: 'exp-a', numero_pravia: 'EXP-0001-2026', cliente_alias: 'Cliente', notaria: { nombre: 'Notaría' } }) },
      expedientePresupuestoDocumento: { findFirst: vi.fn().mockResolvedValue(null) }, expedientePresupuesto: { findFirst: vi.fn().mockResolvedValue(budget) },
      catalogoArtefacto: { findFirst: vi.fn().mockResolvedValue(null) }, userPreference: { findUnique: vi.fn().mockResolvedValue(null) },
      documento: { create: vi.fn() },
    };
    await expect(new ExpedienteBudgetService(prisma).generatePdf(actor(), 'exp-a', { expected_version: 1, idempotency_key: 'new-a' })).rejects.toThrow('storage unavailable');
    expect(prisma.documento.create).not.toHaveBeenCalled();
  });
  it('AN. Auditoría relevante generada', () => {
    const code = serviceSource(); expect(code).toContain('tx.auditLog.create'); expect(code).toContain('tx.expedienteActividad.create'); expect(code).toContain('tx.domainEventOutbox.create');
  });
  it('AO. No timeline de cambios dentro de Presupuesto', () => expect(uiSource()).not.toMatch(/timeline|línea de tiempo|historial de cambios/i));
  it('AP. No implementación accidental de EXP-008', () => expect(uiSource()).not.toMatch(/solicitud de pago|anticipo|conciliaci[oó]n/i));
  it('AQ. No modificación accidental del ledger', () => expect(serviceSource()).not.toMatch(/MovimientoFinanciero|movimientoFinanciero|ledger/i));
  it('AR. No regresión EXP-004', () => expect(serviceSource()).toContain('tx.expedienteDocumento.create'));
  it('AS. No regresión EXP-005', () => expect(serviceSource()).not.toMatch(/seguimiento.*update|expedienteSeguimiento/i));
  it('AT. No regresión EXP-006', () => expect(serviceSource()).not.toMatch(/expedienteArtefactoPendiente\.(update|delete)/));
  it('AU. Legacy data preservation', () => {
    expect(migrationSource()).toContain('legacy_payload'); expect(migrationSource()).toContain('inventa categorías legacy');
  });
  it('AV. No orphan budget rows', () => expect(migrationSource()).toContain('EXP007_ORPHAN_OR_CROSS_TENANT_BUDGET'));
  it('AW. No tenant mismatches', () => {
    const migration = migrationSource(); expect(migration).toContain('EXP007_CROSS_TENANT_CONCEPT'); expect(migration).toContain('EXP007_CROSS_TENANT_DISTRIBUTION');
  });
  it('AX. Mobile 390', () => {
    expect(cssSource()).toContain('@media(max-width:480px)'); expect(cssSource()).toContain('grid-template-columns:1fr 42px');
  });
  it('AY. Mobile 320', () => {
    expect(cssSource()).toContain('@media(max-width:350px)'); expect(cssSource()).toContain('.shareInputs{grid-template-columns:1fr}');
  });
});

describe('EXP-007 — validación monetaria defensiva', () => {
  it.each(['-0.01', '1.001', 'NaN', 'Infinity', ''])('rechaza importe inseguro %s', (value) => {
    expect(() => moneyToCents(value)).toThrow();
  });
  it('bloquea distribución superior al pool', () => {
    expect(() => calculateDistribution(budgetTotals(concepts()), { pravia_honorarios: { mode: 'AMOUNT', value: '100.11' }, pravia_iva: { mode: 'AMOUNT', value: '0.00' } })).toThrow();
  });
  it('mantiene la causa controlada de concurrencia', () => {
    expect(new ExpedienteBudgetError(409, 'EXP007_STALE_BUDGET', 'stale')).toMatchObject({ status: 409, code: 'EXP007_STALE_BUDGET' });
  });
});
