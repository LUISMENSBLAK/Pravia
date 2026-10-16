import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FinanceCard } from './FinanceCard';
import { ArchiveCard } from './ArchiveCard';

afterEach(cleanup);

describe('Mi Día · fuentes finales sin cifras inventadas', () => {
  it('distingue anticipo sin fuente de un saldo real cero', () => {
    const { rerender } = render(<MemoryRouter><FinanceCard title="Anticipos pendientes" loading={false} sourceHref="/finanzas"
      onRetry={vi.fn()} data={{ count: 0, amount: '0.00', items: [], available: false,
        message: 'Sin información: falta el anticipo requerido explícito.' }} /></MemoryRouter>);
    expect(screen.getByText('Sin información: falta el anticipo requerido explícito.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Revisar fuente en Finanzas' })).toHaveAttribute('href', '/finanzas');
    expect(screen.queryByText(/No hay ingresos recibidos/)).not.toBeInTheDocument();
    rerender(<MemoryRouter><FinanceCard title="Valor de producción" loading={false} onRetry={vi.fn()}
      data={{ count: 0, amount: '0.00', items: [] }} emptyMessage="No hay expedientes firmados en este periodo." /></MemoryRouter>);
    expect(screen.getByText('No hay expedientes firmados en este periodo.')).toBeInTheDocument();
  });

  it('muestra Archivo no configurado sin confundirlo con cero folios', () => {
    render(<MemoryRouter><ArchiveCard title="Folios restantes" loading={false} onRetry={vi.fn()}
      data={{ value: null, href: '/archivo', source: 'Archivo', available: false,
        message: 'Sin información: falta el rango final.' }} /></MemoryRouter>);
    expect(screen.getByText('Sin información: falta el rango final.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Revisar fuente en Archivo' })).toHaveAttribute('href', '/archivo');
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('permite desplegar toda la cohorte firmada que compone el valor de producción', () => {
    const items = Array.from({ length: 6 }, (_, index) => ({ id: `case-${index}`, folio: `EXP-${index}`,
      concepto: 'Cliente QA', amount: '35.00', received_at: '2026-10-14T12:00:00.000Z',
      href: `/expedientes/case-${index}#finanzas` }));
    render(<MemoryRouter><FinanceCard title="Valor de producción" loading={false} onRetry={vi.fn()}
      data={{ count: 6, amount: '210.00', items }} expandable itemLabel="expediente" /></MemoryRouter>);
    expect(screen.getAllByRole('link', { name: /Abrir EXP-/ })).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: 'Ver los 6 expedientes' }));
    expect(screen.getAllByRole('link', { name: /Abrir EXP-/ })).toHaveLength(6);
    expect(screen.getByRole('link', { name: 'Abrir EXP-5' })).toHaveAttribute('href', '/expedientes/case-5#finanzas');
  });
});
