import { describe, expect, it } from 'vitest';
import { buildExpedienteReadiness } from './expedienteReadiness.service';

describe('readiness estructurado de expediente', () => {
  it('no convierte ausencia de configuración en un falso completo', () => {
    const result = buildExpedienteReadiness({ estatus: 'ABIERTO', comparecientes: [], requisitos_docs: [], tareas: [], tareas_externas: [], complianceReviews: [] }, false);
    expect(result.indicators.find((item) => item.key === 'identidad')?.state).toBe('NO_CONFIGURADO');
    expect(result.indicators.find((item) => item.key === 'documentos')?.state).toBe('NO_CONFIGURADO');
    expect(result.indicators.find((item) => item.key === 'cumplimiento')?.state).toBe('NO_CONFIGURADO');
    expect(result.indicators.find((item) => item.key === 'proyecto')?.state).toBe('PENDIENTE');
  });

  it('deriva bloqueos únicamente de requisitos y tareas registrados', () => {
    const result = buildExpedienteReadiness({ estatus: 'POST_FIRMA', comparecientes: [{ datos_validados: true, forma_comparecencia: 'PROPIO_DERECHO' }], requisitos_docs: [{ obligatorio: true, estatus: 'PENDIENTE', nombre: 'Identificación' }], tareas: [{ estatus: 'PENDIENTE', titulo: 'Solicitar certificado', fecha_limite: '2020-01-01' }], tareas_externas: [{ estatus: 'BLOQUEADA', descripcion: 'Registro Público' }], complianceReviews: [] }, true);
    expect(result.blockers.map((item) => item.type)).toEqual(['REQUISITO_FALTANTE', 'TAREA_VENCIDA', 'POSTFIRMA_PENDIENTE']);
  });
});
