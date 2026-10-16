import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PersonalNotebook } from './PersonalNotebook';
import { miDiaNotebookService } from '../miDiaNotebook.service';

vi.mock('../miDiaNotebook.service', () => ({ miDiaNotebookService: {
  list: vi.fn(), create: vi.fn(), update: vi.fn(),
} }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Agenda personal · proyección de sistema', () => {
  it('abre el objeto fuente sin ofrecer checkbox ni duplicar una tarea personal', async () => {
    vi.mocked(miDiaNotebookService.list).mockResolvedValue({ today: '2026-10-14', selected: '2026-10-14', view: 'DAY',
      tasks: [], hasMore: false, systemHasMore: false, systemItems: [{ id: 'task-1', origin: 'SYSTEM', title: 'Preparar firma',
        status: 'PENDIENTE', dueAt: '2026-10-14T16:00:00.000Z', completedAt: null,
        href: '/expedientes/case-1#seguimiento' }] });
    render(<MemoryRouter><PersonalNotebook /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText('Del sistema · solo lectura')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Preparar firma' })).toHaveAttribute('href', '/expedientes/case-1#seguimiento');
    });
    expect(screen.queryByRole('checkbox', { name: 'Preparar firma' })).not.toBeInTheDocument();
    expect(miDiaNotebookService.create).not.toHaveBeenCalled();
    expect(miDiaNotebookService.update).not.toHaveBeenCalled();
  });
});
