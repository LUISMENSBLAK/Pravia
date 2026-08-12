import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from '../components/layout/Sidebar';

describe('Sidebar', () => {
  it('respeta el orden del menú y excluye Inteligencia', () => {
    render(
      <MemoryRouter initialEntries={['/mi-dia']}>
        <Sidebar collapsed={false} mobileOpen={false} onToggle={vi.fn()} onCloseMobile={vi.fn()} />
      </MemoryRouter>,
    );

    const labels = ['Mi Día', 'Prospectos', 'Cotizaciones', 'Expedientes', 'Notarías', 'Comparecientes', 'Finanzas', 'Agenda', 'Reportes', 'Riesgos / UIF'];
    labels.forEach((label) => expect(screen.getByRole('link', { name: label })).toBeInTheDocument());
    expect(screen.queryByText('Inteligencia')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mi Día' })).toHaveAttribute('aria-current', 'page');
  });
});
