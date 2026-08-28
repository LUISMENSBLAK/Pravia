import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PropertyWorkspace } from '../features/properties/PropertyWorkspace';
import { PropertiesTab } from '../features/cases/components/tabs/PropertiesTab';

const mocks = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn(), update: vi.fn(), uploadDocument: vi.fn(), documentUrl: vi.fn(), propose: vi.fn(), applyProposal: vi.fn() }));
const expedienteMocks = vi.hoisted(() => ({ listProperties: vi.fn(), propertyCatalogs: vi.fn(), searchProperties: vi.fn(), previewProperty: vi.fn(), applyProperty: vi.fn() }));
vi.mock('../features/properties/properties.service', () => ({ propertiesService: mocks }));
vi.mock('../features/cases/expedientes.service', () => ({ expedientesService: expedienteMocks }));
vi.mock('../features/auth/AuthProvider', () => ({ useAuth: () => ({ user: { permissions: ['expedientes.read', 'expedientes.write', 'documentos.read', 'documentos.write', 'ia.execute'] } }) }));

const record: any = {
  id: 'property-1', version: 2, apodo: 'Casa Bucerías', clave_catastral: 'CAT-001', cuenta_predial: 'PRED-001', folio_real: 'FR-001', datos_registrales: { libro: '12' },
  ubicacion_texto: 'Zona centro', calle: 'México', numero_exterior: '10', municipio: 'Bahía de Banderas', estado: 'Nayarit', pais: 'México',
  superficie_terreno_m2: '350.2500', superficie_construccion_m2: '180.0000', superficie_construccion_comercial_m2: null,
  valor_catastral: '1200000.00', valor_avaluo: '1800000.00', valor_operacion: '1900000.00', regimen: 'Propiedad privada', descripcion: 'Casa habitación',
  colindancias: [{ id: 'b-1', orden: 0, referencia: 'Del vértice 1 al 2', medida: '12.5', unidad: 'm', colindante: 'Lote 4', descripcion: '' }],
  documentos: [{ id: 'link-1', documento_id: 'doc-1', tipo_vinculo: 'TÍTULO', estatus: 'ACTIVO', documento: { id: 'doc-1', nombre_original: 'titulo.pdf', mime_type: 'application/pdf', size_bytes: 1200, fecha_carga: '2026-08-28T12:00:00Z' } }], expedientes: [],
};

const renderPath = (path: string) => render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/predios/nuevo" element={<PropertyWorkspace />} /><Route path="/predios/:id" element={<PropertyWorkspace />} /><Route path="/expedientes/:id" element={<div>Regreso seguro al expediente</div>} /></Routes></MemoryRouter>);

describe('PRD-001 ficha maestra inmobiliaria', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue(record); mocks.create.mockResolvedValue({ ...record, id: 'property-new' }); mocks.update.mockResolvedValue(record); mocks.propose.mockResolvedValue({ extraccion_id: 'extract-1', documento: { id: 'doc-1', nombre: 'titulo.pdf' }, propuestas: [{ campo: 'folio_real', valor_actual: 'FR-001', valor_propuesto: 'FR-002', confianza: 'LECTURA_CLARA', fragmento_fuente: 'Folio real FR-002' }], alertas: [], persisted_master: false }); mocks.applyProposal.mockResolvedValue({ ...record, version: 3, folio_real: 'FR-002' }); expedienteMocks.listProperties.mockResolvedValue({ data: [] }); expedienteMocks.propertyCatalogs.mockResolvedValue({ acts: [] }); });
  it('muestra las cinco secciones contractuales en una ficha completa', async () => { renderPath('/predios/property-1'); expect(await screen.findByRole('heading', { name: 'Casa Bucerías' })).toBeInTheDocument(); for (const heading of ['Datos generales', 'Registro y catastro', 'Superficies y valores', 'Medidas y colindancias', 'Documentos']) expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument(); });
  it('separa clave catastral, cuenta predial y folio real', async () => { renderPath('/predios/property-1'); await screen.findByDisplayValue('Casa Bucerías'); expect(screen.getByDisplayValue('CAT-001')).toBeInTheDocument(); expect(screen.getByDisplayValue('PRED-001')).toBeInTheDocument(); expect(screen.getByDisplayValue('FR-001')).toBeInTheDocument(); });
  it('permite cinco o más colindancias sin formulario cardinal rígido', async () => { const user = userEvent.setup(); renderPath('/predios/property-1'); await screen.findByText('Segmento 1'); for (let index = 0; index < 5; index += 1) await user.click(screen.getByRole('button', { name: 'Agregar colindancia' })); expect(screen.getByText('Segmento 6')).toBeInTheDocument(); expect(screen.queryByLabelText('Norte')).not.toBeInTheDocument(); });
  it('requiere selección explícita antes de analizar IA', async () => { const user = userEvent.setup(); renderPath('/predios/property-1'); await screen.findByText('Extracción asistida'); expect(mocks.propose).not.toHaveBeenCalled(); const button = screen.getByRole('button', { name: 'Analizar documento seleccionado' }); expect(button).toBeDisabled(); await user.selectOptions(screen.getByLabelText('Documento fuente para extracción'), 'doc-1'); await user.click(button); await waitFor(() => expect(mocks.propose).toHaveBeenCalledWith('property-1', 'doc-1')); });
  it('muestra conflicto actual contra propuesto y conserva por defecto', async () => { const user = userEvent.setup(); renderPath('/predios/property-1'); await screen.findByText('Extracción asistida'); await user.selectOptions(screen.getByLabelText('Documento fuente para extracción'), 'doc-1'); await user.click(screen.getByRole('button', { name: 'Analizar documento seleccionado' })); const dialog = await screen.findByRole('dialog', { name: /Propuesta desde titulo.pdf/ }); expect(within(dialog).getByText('FR-001')).toBeInTheDocument(); expect(within(dialog).getByText('FR-002')).toBeInTheDocument(); expect(within(dialog).getByLabelText('Conservar actual')).toBeChecked(); expect(mocks.applyProposal).not.toHaveBeenCalled(); });
  it('acepta una propuesta sólo tras decisión humana', async () => { const user = userEvent.setup(); renderPath('/predios/property-1'); await screen.findByText('Extracción asistida'); await user.selectOptions(screen.getByLabelText('Documento fuente para extracción'), 'doc-1'); await user.click(screen.getByRole('button', { name: 'Analizar documento seleccionado' })); const dialog = await screen.findByRole('dialog'); await user.click(within(dialog).getByLabelText('Aceptar propuesto')); await user.click(within(dialog).getByRole('button', { name: 'Aplicar decisiones' })); await waitFor(() => expect(mocks.applyProposal).toHaveBeenCalledWith('property-1', 'extract-1', 2, { folio_real: 'ACCEPT' })); });
  it('regresa al mismo expediente al crear desde contexto autorizado', async () => { const user = userEvent.setup(); renderPath('/predios/nuevo?fromExpediente=exp-1&fromSection=predios'); await user.type(screen.getByLabelText('Apodo / nombre corto'), 'Casa nueva'); await user.click(screen.getByRole('button', { name: 'Guardar ficha' })); expect(await screen.findByText('Regreso seguro al expediente')).toBeInTheDocument(); expect(mocks.create).toHaveBeenCalled(); });
  it('no presenta como error una búsqueda anterior cancelada al escribir', async () => {
    expedienteMocks.searchProperties.mockImplementation((_id: string, search: string, signal: AbortSignal) => new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => resolve({ data: search ? [record] : [] }), search ? 10 : 500);
      signal.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError')); });
    }));
    const user = userEvent.setup();
    render(<MemoryRouter><PropertiesTab expediente={{ id: 'exp-1', predios: [] } as any} /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Predios / Inmuebles' });
    await user.click(screen.getByRole('button', { name: 'Vincular existente' }));
    await new Promise((resolve) => window.setTimeout(resolve, 220));
    await user.type(screen.getByPlaceholderText('Apodo, clave, cuenta, folio o domicilio'), 'Casa');
    expect(await screen.findByRole('button', { name: /Casa Bucerías/ })).toBeInTheDocument();
    expect(screen.queryByText('No pudimos buscar en el maestro inmobiliario.')).not.toBeInTheDocument();
  });
});
