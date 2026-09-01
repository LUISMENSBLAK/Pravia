import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ timingPolicies: vi.fn(), publishTimingPolicy: vi.fn() }));
const auth = vi.hoisted(() => ({ user: { permissions: ['configuracion.catalogos.read', 'configuracion.actos_tiempos.manage'] } }));
vi.mock('../features/settings/settings.service', () => ({ settingsService: api }));
vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => auth }));

import { TimingPolicies } from '../features/settings/timing/TimingPolicies';

const definitions = [
  ['PROSPECT_INFO_COLLECTION', 'COMMERCIAL', 'Prospecto · Recabando información'],
  ['PROSPECT_READY_TO_REQUEST', 'COMMERCIAL', 'Prospecto · Listo para solicitar'],
  ['PROSPECT_NOTARY_WAIT', 'COMMERCIAL', 'Prospecto · Espera de Notaría'],
  ['ADMIN_PAYMENT_REQUEST_PENDING', 'ADMINISTRATIVE', 'Solicitud de pago pendiente'],
  ['ADMIN_RECEIPT_PENDING_APPLICATION', 'ADMINISTRATIVE', 'Comprobante pendiente de aplicación'],
].map(([type, domain, label]) => ({ type, domain, label, description: `Descripción ${label}`, status: 'NOT_CONFIGURED', current: null, history: [] }));

describe('G0-C · configuración visual de cinco políticas', () => {
  beforeEach(() => { vi.clearAllMocks(); auth.user.permissions = ['configuracion.catalogos.read', 'configuracion.actos_tiempos.manage']; api.timingPolicies.mockResolvedValue(definitions); });

  it('muestra exactamente cinco tipos, tres comerciales y dos administrativos sin defaults', async () => {
    render(<TimingPolicies />);
    expect(await screen.findAllByText('No configurada')).toHaveLength(5);
    expect(screen.getAllByText('Comercial')).toHaveLength(3);
    expect(screen.getAllByText('Administrativa')).toHaveLength(2);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.queryByDisplayValue(/^(3|5|7|24|48|72|120)$/)).not.toBeInTheDocument();
  });

  it('abre formulario accesible con campos vacíos y no publica incompleto', async () => {
    const user = userEvent.setup(); render(<TimingPolicies />);
    const buttons = await screen.findAllByRole('button', { name: 'Configurar política' });
    await user.click(buttons[0]);
    const dialog = screen.getByRole('dialog', { name: 'Prospecto · Recabando información' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByLabelText('Duración')).toHaveValue('');
    expect(screen.getByLabelText('Unidad')).toHaveValue('');
    expect(screen.getByLabelText('Cómputo temporal')).toHaveValue('');
    expect(screen.getByLabelText('Procedencia')).toHaveValue('');
    await user.click(screen.getByRole('button', { name: 'Publicar revisión' }));
    expect(api.publishTimingPolicy).not.toHaveBeenCalled();
  });

  it('publica una revisión completa y recarga el read model', async () => {
    const user = userEvent.setup(); api.publishTimingPolicy.mockResolvedValue({});
    render(<TimingPolicies />);
    await user.click((await screen.findAllByRole('button', { name: 'Configurar política' }))[0]);
    await user.type(screen.getByLabelText('Duración'), '12');
    await user.selectOptions(screen.getByLabelText('Unidad'), 'HOURS');
    await user.selectOptions(screen.getByLabelText('Cómputo temporal'), 'ELAPSED_UTC');
    await user.type(screen.getByLabelText('Procedencia'), 'Acuerdo administrativo aprobado');
    await user.click(screen.getByRole('button', { name: 'Publicar revisión' }));
    await waitFor(() => expect(api.publishTimingPolicy).toHaveBeenCalledWith({ policyType: 'PROSPECT_INFO_COLLECTION', duration: 12, unit: 'HOURS', calendarSemantics: 'ELAPSED_UTC', provenance: 'Acuerdo administrativo aprobado' }));
    await waitFor(() => expect(api.timingPolicies).toHaveBeenCalledTimes(2));
  });

  it('modo consulta no expone acciones de publicación', async () => {
    auth.user.permissions = ['configuracion.catalogos.read'];
    render(<TimingPolicies />);
    expect(await screen.findByText('Vista de consulta')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Configurar política|Publicar nueva revisión/ })).not.toBeInTheDocument();
  });

  it('Escape cierra el diálogo y devuelve el foco al disparador', async () => {
    const user = userEvent.setup(); render(<TimingPolicies />);
    const trigger = (await screen.findAllByRole('button', { name: 'Configurar política' }))[0];
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('mantiene el foco dentro del diálogo con Tab y Shift+Tab', async () => {
    const user = userEvent.setup(); render(<TimingPolicies />);
    await user.click((await screen.findAllByRole('button', { name: 'Configurar política' }))[0]);
    const close = screen.getByRole('button', { name: 'Cerrar' });
    const publish = screen.getByRole('button', { name: 'Publicar revisión' });
    close.focus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(publish).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
  });
});
