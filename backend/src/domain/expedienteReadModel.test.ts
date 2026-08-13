import { describe, expect, it } from 'vitest';
import { complianceAttention, complianceLabel, macrophaseForStatus, parseExpedienteQuery } from './expedienteReadModel';

describe('modelo de lectura de expedientes', () => {
  it('normaliza paginación, filtros y orden sin aceptar valores arbitrarios', () => {
    expect(parseExpedienteQuery({ page: '2', pageSize: '500', macrofase: 'firma', riesgo: 'attention', sort: 'folio:asc' })).toMatchObject({ page: 2, pageSize: 100, macrophase: 'FIRMA', risk: 'ATTENTION', sort: 'numero_pravia:asc' });
    expect(parseExpedienteQuery({ page: '-1', sort: 'DROP TABLE' })).toMatchObject({ page: 1, sort: 'updated_at:desc' });
  });

  it('mantiene estado real separado de la macrofase de presentación', () => {
    expect(macrophaseForStatus('PENDIENTE_CLIENTE')).toBe('INTEGRACION');
    expect(macrophaseForStatus('FIRMADO')).toBe('FIRMA');
    expect(macrophaseForStatus('LISTO_ENTREGA')).toBe('POSTFIRMA');
    expect(macrophaseForStatus('CANCELADO')).toBe('OTROS');
  });

  it('solo marca atención cuando la revisión real contiene una clasificación conocida', () => {
    expect(complianceAttention(null)).toBe(false);
    expect(complianceLabel(null)).toBe('Sin evaluar');
    expect(complianceAttention({ clasificacion: 'REQUIERE_AVISO' })).toBe(true);
    expect(complianceLabel({ clasificacion: 'SIN_AVISO_POR_UMBRAL' })).toBe('Revisado');
  });
});
