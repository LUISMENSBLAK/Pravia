import { describe, expect, it } from 'vitest';
import { assessIsrCompleteness, evaluateUif } from './compliance';

const parameters = {
  uma: { valor_diario_mxn: 117.31 },
  reglas: {
    INMUEBLE: { aviso_siempre: false, umbral_uma: 8000, base: 'MAYOR_PRECIO_CATASTRAL_COMERCIAL_GARANTIZADO', fundamento: 'Artículo 17' },
    PODER: { aviso_siempre: true, fundamento: 'Artículo 17' },
  },
};

const complete = { identidad_verificada: true, beneficiario_controlador_identificado: true, actividad_ocupacion_acreditada: true, origen_recursos_documentado: true, pep_declarada: 'NO' };

describe('UIF configurable', () => {
  it('usa el mayor valor inmobiliario y el umbral de la versión', () => {
    const result = evaluateUif(parameters, { ...complete, tipo_acto_uif: 'INMUEBLE', precio_pactado: 800000, valor_comercial: 950000 });
    expect(result.requiere_aviso).toBe(true);
    expect(result.monto_base_mxn).toBe(950000);
    expect(result.umbral_mxn).toBe(938480);
  });

  it('respeta actos que siempre requieren aviso', () => {
    expect(evaluateUif(parameters, { ...complete, tipo_acto_uif: 'PODER' }).requiere_aviso).toBe(true);
  });

  it('no presenta una conclusión completa si falta debida diligencia', () => {
    const result = evaluateUif(parameters, { tipo_acto_uif: 'INMUEBLE', precio_pactado: 100000 });
    expect(result.clasificacion).toBe('INCOMPLETO');
    expect(result.faltantes.length).toBeGreaterThan(0);
  });
});

describe('ISR preparado', () => {
  it('solo evalúa completitud y nunca calcula impuesto', () => {
    const result = assessIsrCompleteness({ campos_minimos: ['precio', 'fecha'] }, { precio: 100 });
    expect(result.motor_estado).toBe('NO_CALCULADO');
    expect(result.faltantes).toEqual(['fecha']);
  });
});
