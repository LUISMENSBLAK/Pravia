import { render, screen } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { ExpedienteInformationHeader } from '../features/cases/components/ExpedienteInformationHeader';
vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { permissions: [] } }) }));
vi.mock('../features/cases/expedientes.service', () => ({ expedientesService: { actTypes: vi.fn().mockResolvedValue([]) } }));
it('el acto persistido fuera del catálogo no aparenta estar vacío ni se ofrece como nueva selección', async () => {
  render(<ExpedienteInformationHeader expediente={{ id: 'qa', numero_pravia: 'EXP-QA', version: 1, abogado: { id: 'qa', nombre: 'QA', apellido: 'QA' }, creador: { nombre: 'QA', apellido: 'QA' }, capabilities: { canWrite: false }, actos: [{ id: 'relation', tipo_acto_id: 'historical-act', estatus: 'ACTIVO', tipo_acto: { id: 'historical-act', nombre: 'Acto histórico canónico' } }] } as any} onChanged={vi.fn()} onAssistant={vi.fn()} onSeguimiento={vi.fn()} />);
  const option = await screen.findByRole('option', { name: 'Acto histórico canónico · fuera del catálogo activo' });
  expect(option).toBeDisabled(); expect((option as HTMLOptionElement).selected).toBe(true);
  expect(screen.getByRole('combobox', { name: /Acto Los actos adicionales/ })).toHaveValue('historical-act');
});
