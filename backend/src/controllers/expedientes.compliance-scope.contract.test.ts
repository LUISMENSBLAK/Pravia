import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Expediente compliance object serialization boundary', () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), 'src/controllers/expedientes.controller.ts'), 'utf8');

  it('queries and serializes reviews only with canonical compliance.read', () => {
    expect(source).toContain("permissions.includes('compliance.read')");
    expect(source).toContain('...(canReadCompliance ? { complianceReviews:');
    expect(source).toContain('delete serializedExpediente.complianceReviews');
    expect(source).not.toContain("permissions.includes('cumplimiento.read')");
  });

  it('does not expose internal exception details from the affected endpoint', () => {
    expect(source).toContain("code: 'EXPEDIENTE_DETAIL_UNAVAILABLE'");
    expect(source).not.toContain("error: 'Error al obtener detalle del expediente', detail: error.message");
  });
});
