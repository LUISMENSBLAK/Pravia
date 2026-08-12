import { describe, expect, it } from 'vitest';
import { permissionsForRole, roleHasPermission, validatePasswordStrength } from './permissions';

describe('RBAC de PRAVIA', () => {
  it('reserva finanzas y administración de usuarios', () => {
    expect(roleHasPermission('DIRECCION', 'usuarios.manage')).toBe(true);
    expect(roleHasPermission('ADMINISTRACION', 'finanzas.validate')).toBe(true);
    expect(roleHasPermission('ABOGADO', 'finanzas.read')).toBe(false);
    expect(roleHasPermission('RECEPCION', 'finanzas.read')).toBe(false);
  });

  it('da a gestoría acceso operativo acotado', () => {
    expect(roleHasPermission('GESTORIA', 'expedientes.read')).toBe(true);
    expect(roleHasPermission('GESTORIA', 'expedientes.write')).toBe(false);
    expect(roleHasPermission('GESTORIA', 'documentos.write')).toBe(true);
    expect(roleHasPermission('GESTORIA', 'expedientes.postfirma.manage')).toBe(true);
    expect(roleHasPermission('GESTORIA', 'expedientes.deliver')).toBe(false);
    expect(roleHasPermission('GESTORIA', 'expedientes.project.read')).toBe(false);
    expect(roleHasPermission('GESTORIA', 'finanzas.write')).toBe(false);
  });

  it('limita recepción a lectura de entrega y registro de entrega', () => {
    expect(roleHasPermission('RECEPCION', 'expedientes.read')).toBe(true);
    expect(roleHasPermission('RECEPCION', 'expedientes.deliver')).toBe(true);
    expect(roleHasPermission('RECEPCION', 'expedientes.write')).toBe(false);
    expect(roleHasPermission('RECEPCION', 'expedientes.postfirma.manage')).toBe(false);
    expect(roleHasPermission('RECEPCION', 'expedientes.project.read')).toBe(false);
    expect(roleHasPermission('RECEPCION', 'finanzas.write')).toBe(false);
    expect(roleHasPermission('RECEPCION', 'ai.expedientes.read')).toBe(true);
    expect(roleHasPermission('RECEPCION', 'ai.finanzas.read')).toBe(false);
  });

  it('mantiene Consulta en solo lectura', () => {
    expect(permissionsForRole('CONSULTA').some((item) => item.endsWith('.write') || item.endsWith('.manage'))).toBe(false);
  });
});

describe('contraseñas', () => {
  it('acepta una frase fuerte', () => {
    expect(validatePasswordStrength('Pravia-Segura-2026!')).toEqual([]);
  });

  it('explica todos los requisitos faltantes', () => {
    expect(validatePasswordStrength('corta')).toHaveLength(4);
  });
});
