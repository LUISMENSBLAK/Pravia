import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MiniCalendar } from '../features/agenda/components/MiniCalendar';
import { agendaService } from '../features/agenda/agenda.service';

vi.mock('../features/agenda/agenda.service', () => ({ agendaService: { markers: vi.fn() } }));
afterEach(() => vi.restoreAllMocks());
const event = (start: string, end: string, user_id = 'own', estatus = 'ACTIVO') => ({ fecha_inicio: start, fecha_fin: end, user_id, estatus } as any);
describe('permission-scoped monthly agenda indicators', () => {
  it('marks only unfinished visible events, outside the selected week too; filters and expires without reload', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(+new Date('2026-11-24T17:00:00Z'));
    vi.mocked(agendaService.markers).mockResolvedValue({ eventos: [event('2026-11-25T17:00:00Z','2026-11-25T18:00:00Z'), event('2026-11-29T17:00:00Z','2026-11-29T18:00:00Z','team'), event('2026-11-23T17:00:00Z','2026-11-23T18:00:00Z'), event('2026-11-26T17:00:00Z','2026-11-26T18:00:00Z','own','CANCELADO')] });
    const { rerender } = render(<MiniCalendar selected={new Date(2026,10,24)} onSelect={() => {}}/>);
    await screen.findByRole('button', { name: /25 de noviembre.*Con pendientes/ });
    expect(screen.getByRole('button', { name: /29 de noviembre.*Con pendientes/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Con pendientes/ })).toHaveLength(2);
    rerender(<MiniCalendar selected={new Date(2026,10,24)} selectedUsers={['own']} onSelect={() => {}}/>);
    expect(screen.getAllByRole('button', { name: /Con pendientes/ })).toHaveLength(1);
    now.mockReturnValue(+new Date('2026-11-25T18:01:00Z'));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(screen.queryByRole('button', { name: /Con pendientes/ })).not.toBeInTheDocument());
  });
  it('does not turn query failure into a false empty success', async () => {
    vi.mocked(agendaService.markers).mockRejectedValue(Error('offline'));
    render(<MiniCalendar selected={new Date(2026,10,24)} onSelect={() => {}}/>);
    expect(await screen.findByRole('status')).toHaveTextContent('No se pudieron consultar');
  });
});
