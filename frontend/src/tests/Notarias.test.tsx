import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const initialProfile = {
  id: 'org-a', name: 'Notaría 45', notary_number: '45', notary_holder: 'Lic. María López',
  state: 'Nayarit', municipality: 'Tepic', address: 'Av. México 100',
  postal_code: '63000', phone: '311 555 0000', email: 'oficina@pravia.test',
  logo_storage_key: null, institutional_header: 'Notaría 45 · Tepic',
  updated_at: '2026-10-20T00:00:00.000Z',
};

function mockApi(options: { permissions?: string[]; readError?: boolean; writeError?: boolean } = {}) {
  let profile = { ...initialProfile };
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const method = init?.method || 'GET';
    requests.push({ url, method, body: typeof init?.body === 'string' ? init.body : undefined });
    if (url.endsWith('/auth/me')) return response({ user: { id: 'user-1', name: 'Andrea Ruiz', role: 'ADMINISTRACION', organization: { id: 'org-a' }, permissions: options.permissions ?? ['configuracion.manage', 'notarias.read', 'notarias.write'] } });
    if (url.endsWith('/settings/organization') && method === 'PATCH') {
      if (options.writeError) return response({ error: 'No se pudo guardar la organización.' }, 409);
      profile = { ...profile, ...JSON.parse(String(init?.body)) };
      return response({ profile });
    }
    if (url.endsWith('/settings/organization')) return options.readError ? response({ error: 'La ficha no está disponible.' }, 503) : response({ profile });
    return response({});
  }));
  return requests;
}

const show = (path = '/notarias') => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);

describe('Una organización por tenant: retiro del módulo Notarías', () => {
  beforeEach(() => { vi.restoreAllMocks(); mockApi(); });

  it('redirige /notarias a la ficha institucional del tenant', async () => {
    show();
    expect(await screen.findByRole('heading', { name: 'Ficha de la organización' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Notaría 45')).toBeInTheDocument();
  });

  it('redirige /notarias/:id sin abrir el detalle histórico', async () => {
    show('/notarias/notaria-legacy');
    expect(await screen.findByRole('heading', { name: 'Ficha de la organización' })).toBeInTheDocument();
    expect(screen.queryByText('Directorio y operación de notarías vinculadas.')).not.toBeInTheDocument();
  });

  it('el menú principal ya no ofrece Notarías', async () => {
    show();
    await screen.findByRole('heading', { name: 'Ficha de la organización' });
    expect(screen.queryByRole('link', { name: 'Notarías' })).not.toBeInTheDocument();
  });

  it('retira el alta de una notaría interna', async () => {
    show();
    await screen.findByRole('heading', { name: 'Ficha de la organización' });
    expect(screen.queryByRole('button', { name: /Nueva notaría/i })).not.toBeInTheDocument();
  });

  it('no llama a los endpoints del antiguo directorio al visitar la ruta legacy', async () => {
    const requests = mockApi(); show('/notarias/notaria-legacy');
    await screen.findByRole('heading', { name: 'Ficha de la organización' });
    expect(requests.filter(({ url }) => /\/api\/notarias(?:\/|\?|$)/.test(url))).toEqual([]);
  });

  it('muestra número, titular, jurisdicción, domicilio y contacto de la organización', async () => {
    show();
    await screen.findByRole('heading', { name: 'Ficha de la organización' });
    for (const value of ['45', 'Lic. María López', 'Nayarit', 'Tepic', 'Av. México 100', '63000', '311 555 0000', 'oficina@pravia.test']) {
      expect(screen.getByDisplayValue(value)).toBeInTheDocument();
    }
  });

  it('mantiene los datos en solo lectura para un usuario sin permiso de configuración', async () => {
    mockApi({ permissions: ['notarias.read'] }); show();
    await screen.findByRole('heading', { name: 'Ficha de la organización' });
    expect(screen.queryByRole('button', { name: 'Editar organización' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Denominación')).toBeDisabled();
  });

  it('edita únicamente la ficha organizacional mediante la ruta canónica', async () => {
    const requests = mockApi(); const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Editar organización' }));
    await user.clear(screen.getByLabelText('Titular'));
    await user.type(screen.getByLabelText('Titular'), 'Lic. Ana Ruiz');
    await user.click(screen.getByRole('button', { name: 'Guardar organización' }));
    await waitFor(() => expect(requests.some(({ url, method, body }) => url.endsWith('/settings/organization') && method === 'PATCH' && body?.includes('Lic. Ana Ruiz'))).toBe(true));
    expect(requests.some(({ url, method }) => /\/notarias(?:\/|$)/.test(url) && method !== 'GET')).toBe(false);
  });

  it('no envía un id de tenant ni clave de logo editable desde el formulario', async () => {
    const requests = mockApi(); const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Editar organización' }));
    await user.click(screen.getByRole('button', { name: 'Guardar organización' }));
    const body = JSON.parse(requests.find(({ url, method }) => url.endsWith('/settings/organization') && method === 'PATCH')?.body || '{}');
    expect(body.id).toBeUndefined();
    expect(body.logo_storage_key).toBeUndefined();
  });

  it('cancelar la edición no genera escritura', async () => {
    const requests = mockApi(); const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Editar organización' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(requests.some(({ method }) => method === 'PATCH')).toBe(false);
  });

  it('mantiene el formulario visible y muestra el error si falla el guardado', async () => {
    mockApi({ writeError: true }); const user = userEvent.setup(); show();
    await user.click(await screen.findByRole('button', { name: 'Editar organización' }));
    await user.click(screen.getByRole('button', { name: 'Guardar organización' }));
    expect(await screen.findByText('No se pudo guardar la organización.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar organización' })).toBeInTheDocument();
  });

  it('informa un fallo de lectura sin fingir una organización vacía', async () => {
    mockApi({ readError: true }); show();
    expect(await screen.findByText('La ficha no está disponible.')).toBeInTheDocument();
    expect(screen.queryByText('Sin notaría predeterminada')).not.toBeInTheDocument();
  });

  it('no presenta una carga ficticia de logo cuando no existe el archivo', async () => {
    show();
    expect(await screen.findByText('Sin logo configurado')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Subir logo/i })).not.toBeInTheDocument();
  });
});
