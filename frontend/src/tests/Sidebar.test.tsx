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

  it('muestra Finanzas y Reportes únicamente cuando la sesión concede sus permisos', () => {
    const { rerender } = render(
      <MemoryRouter initialEntries={['/notarias']}>
        <Sidebar
          collapsed={false}
          mobileOpen={false}
          onToggle={vi.fn()}
          onCloseMobile={vi.fn()}
          user={{ name: 'Andrea Ruiz', role: 'ADMINISTRACION', permissions: ['notarias.read', 'notarias.write', 'expedientes.read'] }}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: 'Finanzas' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reportes' })).not.toBeInTheDocument();

    rerender(
      <MemoryRouter initialEntries={['/notarias']}>
        <Sidebar
          collapsed={false}
          mobileOpen={false}
          onToggle={vi.fn()}
          onCloseMobile={vi.fn()}
          user={{ name: 'Andrea Ruiz', role: 'ADMINISTRACION', permissions: ['notarias.read', 'finanzas.read', 'reportes.read'] }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Finanzas' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reportes' })).toBeInTheDocument();
  });
});
