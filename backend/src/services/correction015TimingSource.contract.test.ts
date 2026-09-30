import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(process.cwd(), '..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Corrección 015 · fuente única de tiempos operativos', () => {
  it('retira el configurador paralelo y conserva únicamente la lectura histórica', () => {
    const index = read('backend/src/index.ts');
    const routes = read('backend/src/routes/timingPolicy.routes.ts');
    const settings = read('frontend/src/features/settings/SettingsPage.tsx');
    expect(index).not.toContain("app.use('/api/settings/timing-policies'");
    expect(routes).not.toContain('publishTimingPolicy');
    expect(routes).toContain("timingSourceRoutes.get('/:type/:sourceId'");
    expect(settings).not.toContain("label: 'Políticas de tiempo'");
    expect(settings).toContain("segment === 'politicas-tiempo'");
    expect(settings).toContain('<Navigate to="/configuracion/actos-tiempos" replace />');
  });

  it('Seguimiento resuelve sus tiempos desde CFG-001 y no desde TimingPolicy', () => {
    const seguimiento = read('backend/src/services/expedienteSeguimiento.service.ts');
    expect(seguimiento).toContain('tx.configuracionActo.findMany');
    expect(seguimiento).toContain('duracion_estimada');
    expect(seguimiento).not.toContain('timingPolicyRevision');
    expect(seguimiento).not.toContain('calculateTimingReadModel');
  });

  it('preserva tablas históricas sin borrado destructivo', () => {
    const schema = read('backend/prisma/schema.prisma');
    expect(schema).toContain('model TimingPolicyRevision');
    expect(schema).toContain('model TimingInterval');
  });
});
