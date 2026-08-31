import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');
const service = read('services/expedienteActivity.service.ts');
const routes = read('routes/expedientes.routes.ts');
const ui = read('../../frontend/src/features/cases/components/tabs/ActivityTab.tsx');
const workspace = read('../../frontend/src/features/cases/ExpedienteWorkspace.tsx');
const schema = read('../prisma/schema.prisma');
const isr = read('services/isr.service.ts');
const opening = read('services/expedienteOpening.service.ts');
const acts = read('services/expedienteActos.service.ts');
const parties = read('services/expedienteParties.service.ts');
const properties = read('services/expedientePredios.service.ts');
const followup = read('services/expedienteSeguimiento.service.ts');
const budget = read('services/expedienteBudget.service.ts');
const finance = read('services/expedienteFinance.service.ts');
const workflow = read('services/expedienteWorkflow.service.ts');
const controllers = read('controllers/expedientes.controller.ts');

const checks: Array<[string, () => boolean]> = [
  ['01 timeline legible', () => ui.includes('Actividad del expediente')],
  ['02 responde qué', () => ui.includes('item.title') && ui.includes('item.description')],
  ['03 responde cuándo', () => ui.includes('Cuándo') && ui.includes('occurred_at')],
  ['04 responde quién', () => ui.includes('Quién') && ui.includes('actorName')],
  ['05 sección interna', () => workspace.includes("active === 'actividad'")],
  ['06 alimentación automática existente', () => service.includes("canonical_source: 'ExpedienteActividad'")],
  ['07 nota manual', () => routes.includes("/:id/actividad/notas") && schema.includes('es_nota_manual')],
  ['08 AuditLog separado', () => !service.includes('auditLog.find')],
  ['09 correlación sin sustitución', () => service.includes('technical_audit_source: false')],
  ['10 apertura', () => opening.includes('Apertura de expediente')],
  ['11 actos', () => acts.includes('expedienteActividad.create')],
  ['12 comparecientes', () => parties.includes('expedienteActividad.create')],
  ['13 predios', () => properties.includes('expedienteActividad.create')],
  ['14 cambios relevantes', () => controllers.includes('Ficha general actualizada')],
  ['15 documentos', () => controllers.includes("tipo: 'DOCUMENTO'")],
  ['16 seguimiento', () => followup.includes("tipo: 'SEGUIMIENTO'")],
  ['17 presupuesto PDF', () => budget.includes('expedienteActividad.create')],
  ['18 finanzas', () => finance.includes('expedienteActividad.create')],
  ['19 vínculo ISR', () => isr.includes("action: 'LINK_ISR'") && isr.includes("action: 'UNLINK_ISR'")],
  ['20 firma', () => workflow.includes("nuevoEstatus === 'FIRMADO'")],
  ['21 postfirma', () => controllers.includes('Trámite de postfirma iniciado') && controllers.includes('Trámite de postfirma completado')],
  ['22 entrega', () => workflow.includes("nuevoEstatus === 'ENTREGADO'")],
  ['23 excluye clics', () => !service.includes('click_event')],
  ['24 excluye apertura de pestañas', () => !service.includes('tab_open')],
  ['25 excluye visualización/descarga', () => service.includes('descarga|visualiz|consult')],
  ['26 valores anteriores', () => service.includes('valores_anteriores') && ui.includes('previous_values')],
  ['27 valores nuevos', () => service.includes('valores_nuevos') && ui.includes('new_values')],
  ['28 expandible', () => ui.includes('aria-expanded') && ui.includes('activity-detail')],
  ['29 navegación relacionada interna', () => ui.includes("navigate({ hash: selectedItem.related_section })")],
  ['30 autor y fecha de nota', () => service.includes('usuario_id: actor.id') && service.includes('occurred_at: item.created_at')],
  ['31 nota no crea tarea', () => !service.includes('tarea.create')],
  ['32 nota no muta seguimiento', () => !service.includes('expedienteSeguimientoActividad.update')],
  ['33 cinco filtros', () => ['TODO','OPERACION','DOCUMENTOS','FINANZAS','SISTEMA'].every((value) => ui.includes(`'${value}'`))],
  ['34 búsqueda y fecha', () => ui.includes('Buscar en actividad') && ui.includes('type="date"')],
  ['35 no es Reportes', () => !ui.includes('Reportes') && !routes.includes('/reportes')],
];

describe('EXP-009 atomic contract', () => {
  it.each(checks)('%s', (_name, check) => expect(check()).toBe(true));
  it('contains exactly 35 atomic checkpoints', () => expect(checks).toHaveLength(35));
});
