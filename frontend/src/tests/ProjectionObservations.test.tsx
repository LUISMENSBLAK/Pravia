import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ProjectionObservations } from '../features/cases/components/ProjectionObservations';

describe('Observaciones de proyección', () => {
  it('muestra cuatro categorías y no inventa observaciones en las vacías', () => {
    render(<ProjectionObservations observations={[{ id: 'qa', titulo: 'RFC no encontrado', nivel_riesgo: 'MEDIO', tipo_discrepancia: 'FALTANTE', dato_proyecto: 'RFC pendiente', dato_fuente: 'No consta', documento_fuente: 'Fuente sintética', ubicacion: 'Generales', recomendacion: 'Aportar documento.' }]}/>);
    for (const category of ['CRÍTICAS', 'REVISAR', 'INFORMATIVAS']) expect(within(screen.getByRole('region', { name: category })).getByText('SIN OBSERVACIONES.')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'PENDIENTES' })).getByText('RFC pendiente')).toBeInTheDocument();
    expect(screen.getByText('Fuente sintética')).toBeInTheDocument();
    expect(screen.getByText('No consta')).toBeInTheDocument();
  });
});
