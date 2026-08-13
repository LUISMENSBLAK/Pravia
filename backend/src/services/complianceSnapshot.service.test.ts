import { describe, expect, it } from 'vitest';
import { prefillFromSnapshot, snapshotRule } from './complianceSnapshot.service';

describe('snapshots de cumplimiento', () => {
  it('congela versión, vigencia, fuente y parámetros del RuleSet', () => {
    const rule = { id:'rule-1', tipo:'UIF', clave:'UIF-NOTARIAL', version:'2026.1', nombre:'UIF notarial', estatus:'REFERENCIA_VERIFICADA', vigencia_desde:new Date('2026-02-01'), vigencia_hasta:null, fuente_nombre:'LFPIORPI', fuente_url:'https://example.test/ley.pdf', fuente_publicada_at:new Date('2025-07-16'), parametros:{ uma:{valor_diario_mxn:117.31} }, cuestionario:[{clave:'pep_declarada'}], notas:'Revisión humana' };
    expect(snapshotRule(rule)).toMatchObject({ version:'2026.1', fuente_nombre:'LFPIORPI', parametros:{uma:{valor_diario_mxn:117.31}}, vigencia_desde:'2026-02-01T00:00:00.000Z' });
  });

  it('prellena PEP sólo desde el master capturado y conserva pendiente como pendiente', () => {
    const snapshot:any={expediente:{valor_operacion_mxn:900000},comparecientes:[{pep_estado:'PENDIENTE',rfc:'RFC1',identificaciones:[],datos_validados:false}]};
    expect(prefillFromSnapshot('UIF',snapshot)).toMatchObject({pep_declarada:'PENDIENTE',precio_pactado:900000});
    snapshot.comparecientes[0].pep_estado='SI';
    expect(prefillFromSnapshot('UIF',snapshot).pep_declarada).toBe('SI');
  });

  it('no inventa beneficiario controlador ni origen de fondos como master', () => {
    const result=prefillFromSnapshot('UIF',{expediente:{},comparecientes:[{pep_estado:'NO',identificaciones:[],datos_validados:false}]});
    expect(result).not.toHaveProperty('beneficiario_controlador_identificado');
    expect(result).not.toHaveProperty('origen_recursos_documentado');
  });

  it('ISR sólo reutiliza identificador y no calcula impuesto', () => {
    expect(prefillFromSnapshot('ISR',{comparecientes:[{rfc:'LORM900101AA1',curp:'CURP'}]})).toEqual({enajenante_rfc_curp:'LORM900101AA1'});
  });
});
