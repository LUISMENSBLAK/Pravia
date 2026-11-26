import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TemplatesFormatsTab } from '../features/cases/components/tabs/TemplatesFormatsTab';

const mocks = vi.hoisted(() => ({ artifacts: vi.fn() }));
vi.mock('../features/cases/expedientes.service', () => ({ expedientesService: mocks }));
vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { permissions: [] } }) }));
vi.mock('../features/cases/components/CaseSheetPanel', () => ({ CaseSheetPanel: () => null }));
vi.mock('../features/cases/components/CaseInstitutions', () => ({ CaseInstitutions: () => null }));
vi.mock('../features/cases/components/CaseManualFormats', () => ({
  CaseManualFormats: ({ id, onChanged }: { id: string; onChanged(): void }) => (
    <section aria-label={`Selección ${id}`}>
      <input aria-label="Borrador local" defaultValue="" />
      <button onClick={onChanged}>Refrescar selección</button>
    </section>
  ),
}));
const result = { data: [], preview: { revision: 'qa' } };
const expediente = (id: string) => ({ id, capabilities: { canWrite: true, canUploadDocuments: true } }) as any;
const deferred = () => { let resolve!: (value: typeof result) => void; const promise = new Promise<typeof result>(done => { resolve = done; }); return { promise, resolve }; };

beforeEach(() => { vi.clearAllMocks(); mocks.artifacts.mockResolvedValue(result); });
describe('Plantillas y formatos conserva el contexto al refrescar', () => {
  it('no desmonta los selectores ni borra su estado mientras reconsulta pendientes', async () => {
    const next = deferred();
    mocks.artifacts.mockResolvedValueOnce(result).mockReturnValueOnce(next.promise);
    render(<TemplatesFormatsTab expediente={expediente('case-a')} />);
    const input = await screen.findByLabelText('Borrador local');
    await userEvent.type(input, 'Selección guardada');
    await userEvent.click(screen.getByRole('button', { name: 'Refrescar selección' }));
    expect(screen.getByLabelText('Borrador local')).toBe(input);
    expect(input).toHaveValue('Selección guardada');
    await act(async () => { next.resolve(result); });
    expect(screen.getByLabelText('Borrador local')).toBe(input);
  });
  it('ignora una respuesta tardía del expediente anterior', async () => {
    const first = deferred(), second = deferred();
    mocks.artifacts.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const view = render(<TemplatesFormatsTab expediente={expediente('case-a')} />);
    view.rerender(<TemplatesFormatsTab expediente={expediente('case-b')} />);
    await act(async () => { second.resolve(result); });
    expect(await screen.findByRole('region', { name: 'Selección case-b' })).toBeInTheDocument();
    await act(async () => { first.resolve(result); });
    expect(screen.getByRole('region', { name: 'Selección case-b' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Selección case-a' })).not.toBeInTheDocument();
  });
  it('muestra el error inicial sin quedarse en la pantalla de carga', async () => {
    mocks.artifacts.mockRejectedValueOnce(Error('QA_NETWORK'));
    render(<TemplatesFormatsTab expediente={expediente('case-a')} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos cargar');
    await waitFor(() => expect(screen.queryByText('Resolviendo Plantillas y formatos…')).not.toBeInTheDocument());
  });
});
