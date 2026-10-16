import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ actCreationDefaults: vi.fn(), createCatalogAct: vi.fn() }));
vi.mock('../features/settings/settings.service', () => ({ settingsService: api }));

import { ActCreationConfigurator } from '../features/settings/catalogs/ActCreationConfigurator';

describe('configurador integral de acto', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.actCreationDefaults.mockResolvedValue({
      REGISTRABLE: [
        { code: 'REVISION_INICIAL', name: 'Revisión de expediente', stage: 'Prefirma', duration: 3, dayType: 'HABILES', nature: 'INTERNA' },
        { code: 'FIRMA', name: 'Firma', stage: 'Firma', duration: 0, dayType: 'HABILES', nature: 'CLIENTE_HITO' },
      ],
      NO_REGISTRABLE: [{ code: 'REVISION_INICIAL', name: 'Revisión de expediente', stage: 'Prefirma', duration: 3, dayType: 'HABILES', nature: 'INTERNA' }],
      ESPECIAL: [],
    });
    api.createCatalogAct.mockResolvedValue({ id: 'act-new', nombre: 'COMPRAVENTA', complete: true });
  });

  it('no guarda con sólo el nombre y exige procesos y carácter principal', async () => {
    const user = userEvent.setup();
    render(<ActCreationConfigurator acts={[]} returnTo={null} onCancel={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByRole('button', { name: /Procesos registrables/i });
    await user.type(screen.getByLabelText('Nombre del acto'), 'Compraventa');
    await user.type(screen.getByLabelText('Familia'), 'Compraventas');
    await user.type(screen.getByLabelText('Jurisdicción'), 'Nayarit');
    await user.click(screen.getByRole('button', { name: 'Guardar acto' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Aplica un default');
    expect(api.createCatalogAct).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Procesos registrables/i }));
    await user.click(screen.getByRole('button', { name: 'Guardar acto' }));
    expect(screen.getByRole('alert')).toHaveTextContent('carácter principal');
  });

  it('guarda juntos datos generales, tiempos editados y caracteres seleccionados', async () => {
    const user = userEvent.setup(); const onSaved = vi.fn();
    render(<ActCreationConfigurator acts={[]} returnTo="/prospectos/11111111-1111-4111-8111-111111111111" onCancel={vi.fn()} onSaved={onSaved} />);
    await screen.findByRole('button', { name: /Procesos registrables/i });
    await user.type(screen.getByLabelText('Nombre del acto'), 'Compraventa');
    await user.type(screen.getByLabelText('Familia'), 'Compraventas');
    await user.type(screen.getByLabelText('Jurisdicción'), 'Nayarit');
    await user.click(screen.getByRole('button', { name: /Procesos registrables/i }));
    await user.clear(screen.getByLabelText('Duración de Revisión de expediente'));
    await user.type(screen.getByLabelText('Duración de Revisión de expediente'), '4');
    const roles = screen.getByRole('group', { name: 'Principales' });
    await user.click(within(roles).getByLabelText('VENDEDOR'));
    await user.click(within(roles).getByLabelText('COMPRADOR'));
    await user.click(screen.getByRole('button', { name: 'Guardar acto' }));
    expect(api.createCatalogAct).toHaveBeenCalledWith(expect.objectContaining({
      nombre: 'Compraventa', jurisdiccion: 'Nayarit', registrable: true,
      processes: expect.arrayContaining([expect.objectContaining({ code: 'REVISION_INICIAL', duration: 4 })]),
      characters: [{ name: 'VENDEDOR', principal: true }, { name: 'COMPRADOR', principal: true }],
    }));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'act-new', complete: true }));
  });

  it('envía dependencias, paralelismo, condición y excepción con el alta', async () => {
    const user = userEvent.setup();
    render(<ActCreationConfigurator acts={[]} returnTo={null} onCancel={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByRole('button', { name: /Procesos registrables/i });
    await user.type(screen.getByLabelText('Nombre del acto'), 'Compraventa');
    await user.type(screen.getByLabelText('Familia'), 'Compraventas');
    await user.type(screen.getByLabelText('Jurisdicción'), 'Jalisco');
    await user.click(screen.getByRole('button', { name: /Procesos registrables/i }));
    await user.click(screen.getAllByText('Dependencias, paralelismo y excepciones')[1]);
    const advanced = screen.getByLabelText('Grupo paralelo de Firma').closest('details')!;
    await user.type(within(advanced).getByLabelText('Grupo paralelo de Firma'), 'PREFIRMA');
    await user.click(within(advanced).getByLabelText('Revisión de expediente'));
    fireEvent.change(within(advanced).getByLabelText('Condición de Firma'), { target: { value: '{"op":"exists","field":"expediente.tiene_credito"}' } });
    await user.click(within(advanced).getByRole('button', { name: 'Agregar excepción' }));
    await user.type(within(advanced).getByLabelText('Jurisdicción'), 'Jalisco');
    await user.click(screen.getByLabelText('VENDEDOR'));
    await user.click(screen.getByRole('button', { name: 'Guardar acto' }));
    expect(api.createCatalogAct).toHaveBeenCalledWith(expect.objectContaining({
      processes: expect.arrayContaining([expect.objectContaining({
        code: 'FIRMA', parallelGroup: 'PREFIRMA', dependencyCodes: ['REVISION_INICIAL'],
        condition: { op: 'exists', field: 'expediente.tiene_credito' },
        exceptions: [expect.objectContaining({ selector: 'JURISDICCION', jurisdiction: 'Jalisco' })],
      })]),
    }));
  });
});
