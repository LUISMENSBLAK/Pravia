import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const service = () => read('backend/src/services/midBaseSource.service.ts');
const domain = () => read('backend/src/domain/midBaseSources.ts');
const controller = () => read('backend/src/controllers/miDia.controller.ts');
const routes = () => read('backend/src/routes/miDia.routes.ts');
const matrix = () => read('docs/requirements/g1-mid-base-traceability.md');

describe('G1 MID-BASE · contrato estático y trazabilidad', () => {
  it('mantiene exactamente cinco categorías canónicas', () => {
    expect(domain()).toContain("'PROSPECT',\n  'QUOTE',\n  'PRE_SIGNATURE',\n  'POST_SIGNATURE',\n  'ADMINISTRATION'");
  });

  it('publica sources antes del dashboard legacy y conserva ambas rutas', () => {
    expect(routes()).toContain("router.get('/sources', MiDiaController.sources)");
    expect(routes()).toContain("router.get('/', MiDiaController.dashboard)");
    expect(routes().indexOf("'/sources'")).toBeLessThan(routes().indexOf("'/'"));
  });

  it('no usa updated_at, created_at genérico ni notas como fecha de etapa Prospecto', () => {
    const prospectBlock = service().slice(service().indexOf('prospects.forEach'), service().indexOf('const firstSendByQuote'));
    expect(prospectBlock).not.toContain('updated_at');
    expect(prospectBlock).not.toContain('created_at');
    expect(prospectBlock).not.toMatch(/ultima_nota|last_note/i);
    expect(prospectBlock).toContain('transition?.effective_at');
  });

  it('no consulta pagos/compliance para aceptación ni mezcla CUM-PAG en Administración', () => {
    expect(service()).not.toMatch(/compliance(?:Operation)?Payment|cum[_-]?pag|movimientoFinanciero|\.pago\.find/i);
    expect(service()).toContain("source: 'EXP-008'");
  });

  it('no crea persistencia ni ejecuta transacciones/escrituras desde la lectura', () => {
    expect(service()).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
    expect(service()).not.toContain('$transaction');
    expect(service()).not.toContain('$executeRaw');
  });

  it('no implementa algoritmo final, score o urgencia transversal', () => {
    expect(`${service()}\n${domain()}`).not.toMatch(/priority_(?:rank|score|points)|global_urgency|my_day_order/i);
    expect(service()).toContain('finalPriorityAlgorithm: null');
  });

  it('legacy 3/5/7 no participa en la capa G1', () => {
    expect(`${service()}\n${domain()}`).not.toMatch(/dias_sin_actualizacion|daysWithoutUpdate|nextWeek|\+\s*[357]\s*\*\s*86_400_000/);
  });

  it('usa límites y consultas batch en lugar de N+1', () => {
    expect(service()).toContain('Math.min(250');
    expect(service()).toContain('expediente_id: { in: caseIds }');
    expect(service()).toContain('id: { in: revisionIds }');
  });

  it('el controlador no acepta reloj externo ni expone detalle interno de error', () => {
    const block = controller().slice(controller().indexOf('static async sources'), controller().indexOf('static async dashboard'));
    expect(block).not.toMatch(/req\.query\.(now|clock|date)/);
    expect(block).not.toMatch(/MID_BASE_INTERNAL_ERROR[^}]*error\.message/s);
  });

  it('congela 35 IDs únicos, 33 implementados y sólo dos deferred aprobados', () => {
    const ids = [...matrix().matchAll(/\| (G1-MID-\d{3}) \|/g)].map((match) => match[1]);
    expect(ids).toHaveLength(35);
    expect(new Set(ids).size).toBe(35);
    expect((matrix().match(/\| IMPLEMENTED\+TESTED \|/g) ?? [])).toHaveLength(33);
    expect((matrix().match(/\| DEFERRED \|/g) ?? [])).toHaveLength(2);
    expect(matrix()).toContain('G1-MID-034');
    expect(matrix()).toContain('G1-MID-035');
  });
});
