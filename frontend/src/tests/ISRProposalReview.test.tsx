import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ISRProposalReview } from '../features/isr/ISRProposalReview';
import { ISRPartyIdentity } from '../features/isr/ISRPartyIdentity';
import type { ISRProposal, ISRV3Party } from '../features/isr/isr.types';

const api = vi.hoisted(() => ({ searchComparecientes: vi.fn() }));
vi.mock('../features/isr/isr.service', () => ({ isrService: api }));
const seller: ISRV3Party = { id: 'seller', role: 'ENAJENANTE', name: 'Persona QA', subjectType: 'PF', nationalityCode: 'MX', fiscalResidence: 'POR_DETERMINAR', percentage: '100' };
const proposal: ISRProposal = { id: 'p', field_path: 'rfc', proposed_value: 'AAAA800101AA1', status: 'PENDIENTE', source_document_id: 'doc', source_document_name: 'SINTÉTICO QA', source_page: 2, source_fragment: 'RFC: AAAA800101AA1', model_version: 'SYNTHETIC_TEST_ONLY' };

describe('ISR · aplicación humana y selección de ficha maestra', () => {
  it('exige seleccionar la persona antes de confirmar identidad y conserva procedencia', async () => {
    const review = vi.fn(); const user = userEvent.setup();
    render(<ISRProposalReview proposal={proposal} parties={[seller]} disabled={false} onReview={review} />);
    expect(screen.getByText('RFC: AAAA800101AA1')).toBeInTheDocument(); expect(screen.getByText(/pág. 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Usar este dato' })).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox'), 'seller'); await user.click(screen.getByRole('button', { name: 'Usar este dato' }));
    expect(review).toHaveBeenCalledExactlyOnceWith('ACEPTADA', 'seller');
  });
  it('permisos/proceso deshabilitan aceptar y descartar, no sólo ocultan el control', () => {
    const review = vi.fn(); render(<ISRProposalReview proposal={{ ...proposal, field_path: 'valor_operacion' }} parties={[seller]} disabled onReview={review} />);
    expect(screen.getByRole('button', { name: 'Usar este dato' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Descartar' })).toBeDisabled();
    expect(review).not.toHaveBeenCalled();
  });
  it('reutiliza búsqueda de maestros, sin inferir título fiscal de persona moral', async () => {
    api.searchComparecientes.mockResolvedValue([{ id: 'master', nombre: 'EMPRESA SINTÉTICA QA', tipo_persona: 'MORAL', rfc: 'AAA010101AA1' }]);
    const onChange = vi.fn(); const user = userEvent.setup(); render(<ISRPartyIdentity party={seller} disabled={false} onChange={onChange} />);
    await user.type(screen.getByRole('textbox', { name: 'Buscar compareciente para enajenante' }), 'EMPRESA');
    await waitFor(() => expect(api.searchComparecientes).toHaveBeenCalledWith('EMPRESA', expect.any(AbortSignal)));
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Seleccionar compareciente' }), 'master');
    expect(onChange).toHaveBeenCalledWith({ sourceComparecienteId: 'master', name: 'EMPRESA SINTÉTICA QA', rfc: 'AAA010101AA1', curp: '', subjectType: 'OTRO' });
    expect(screen.getByRole('textbox', { name: 'Nombre' })).toHaveValue('Persona QA'); // Parent owns the persisted draft; no fake local mutation.
  });
});
