import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TenantBoardSettings } from '../features/my-day/components/TenantBoardSettings';
import { miDiaConfigurationService } from '../features/my-day/miDiaConfiguration.service';

vi.mock('../features/my-day/miDiaConfiguration.service', () => ({ miDiaConfigurationService: { saveTenant: vi.fn() } }));

const card = (key: string, name: string) => ({ key, name, family: 'OPERACION', sourceModule: 'Expedientes',
  allowedSizes: ['S', 'M'] as const, allowedScopes: ['OWN', 'ORGANIZATION'] as const,
  defaultSize: 'S' as const, drillDown: '/expedientes', parameters: [], maxScope: 'ORGANIZATION' as const, recommended: false });

describe('Mi Día · configuración de notaría', () => {
  it('sólo guarda tarjetas habilitadas y orden predeterminado, con versión de concurrencia', async () => {
    vi.mocked(miDiaConfigurationService.saveTenant).mockResolvedValue({ version: 3 });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<TenantBoardSettings administration={{ version: 2, catalog: [card('CASES', 'Expedientes'), card('URGENT_TASKS', 'Tareas urgentes')] as any,
      enabledCards: ['CASES', 'URGENT_TASKS'], defaultLayout: [{ key: 'CASES', size: 'S', scope: 'ORGANIZATION', parameters: {} }],
      recommendedCards: [] }} onSaved={onSaved} />);
    const urgent = screen.getByText('Tareas urgentes').parentElement?.parentElement as HTMLElement;
    fireEvent.click(within(urgent).getByRole('checkbox', { name: 'Tareas urgentes: en tablero inicial' }));
    fireEvent.click(within(urgent).getByRole('checkbox', { name: 'Tareas urgentes: recomendada' }));
    fireEvent.click(within(urgent).getByRole('checkbox', { name: 'Tareas urgentes: fija' }));
    fireEvent.change(within(urgent).getByRole('combobox', { name: 'Tareas urgentes: tamaño' }), { target: { value: 'M' } });
    fireEvent.click(screen.getByRole('button', { name: 'Subir Tareas urgentes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    await waitFor(() => expect(miDiaConfigurationService.saveTenant).toHaveBeenCalledWith(expect.objectContaining({
      version: 2, enabled_cards: ['CASES', 'URGENT_TASKS'], fixed_cards: ['URGENT_TASKS'], recommended_cards: ['URGENT_TASKS'],
      default_layout: [expect.objectContaining({ key: 'URGENT_TASKS', fixed: true, size: 'M' }), expect.objectContaining({ key: 'CASES' })],
    })));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it('deshabilitar una tarjeta también la quita del default y de recomendadas', async () => {
    vi.mocked(miDiaConfigurationService.saveTenant).mockResolvedValue({ version: 4 });
    render(<TenantBoardSettings administration={{ version: 3, catalog: [card('CASES', 'Expedientes')] as any,
      enabledCards: ['CASES'], defaultLayout: [{ key: 'CASES', size: 'S', scope: 'ORGANIZATION', parameters: {}, fixed: true }],
      recommendedCards: ['CASES'] }} onSaved={vi.fn().mockResolvedValue(undefined)} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Expedientes: habilitada' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar configuración' }));
    await waitFor(() => expect(miDiaConfigurationService.saveTenant).toHaveBeenCalledWith({
      version: 3, enabled_cards: [], default_layout: [], fixed_cards: [], recommended_cards: [],
    }));
  });
});
