import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncomeInvoiceGenerator } from '../features/finance/components/IncomeInvoiceGenerator';
import { financeService } from '../features/finance/finance.service';
import { comparecientesService } from '../features/comparecientes/comparecientes.service';

vi.mock('../features/finance/finance.service', () => ({ financeService: {
  fiscalIncomeContext: vi.fn(), fiscalEntities: vi.fn(), fiscalConcepts: vi.fn(), fiscalStatus: vi.fn(),
  createFiscalDraft: vi.fn(), updateFiscalDraft: vi.fn(), deleteFiscalDraft: vi.fn(), extractCsf: vi.fn(),
} }));
vi.mock('../features/comparecientes/comparecientes.service', () => ({ comparecientesService: { uploadDocument: vi.fn() } }));

const context = {
  income: { id: 'income-1', expediente_id: 'exp-1', concepto_contexto: 'Honorarios', estado: 'PENDIENTE',
    expediente: { numero_pravia: 'EXP-QA-1', cliente_alias: 'Cliente QA' } },
  receivers: [{ id: 'receiver-link-1', compareciente: { id: 'party-1', nombre_busqueda: 'Cliente QA',
    fiscalProfile: { rfc: 'XAXX010101000', razon_social: 'Cliente QA', regimen_fiscal: '616', codigo_postal: '63735', version: 1 } } }],
  acts: [{ tipo_acto_id: 'act-1', tipo_acto: { nombre: 'Acto QA' } }],
  facturableAmount: '1000.00', invoicedAmount: '0.00', reservedDraftAmount: '0.00',
  remainingInvoiceableAmount: '1000.00', documents: [],
};

describe('Generador contextual de prefacturas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(financeService.fiscalIncomeContext).mockResolvedValue(context as never);
    vi.mocked(financeService.fiscalEntities).mockResolvedValue([{ id: 'entity-1', activa: true,
      razon_social: 'Notaría QA', rfc: 'AAA010101AAA', regimen_fiscal: '601', codigo_postal: '63735' }] as never);
    vi.mocked(financeService.fiscalConcepts).mockResolvedValue([{ id: 'concept-1', entidad_fiscal_id: 'entity-1', activo: true,
      descripcion: 'Honorarios QA', clave_prod_serv: '84111506', clave_unidad: 'E48', iva_tasa: '0.000000',
      iva_retencion_tasa: '0.000000', isr_retencion_tasa: '0.000000' }] as never);
    vi.mocked(financeService.fiscalStatus).mockResolvedValue({ configured: false, realStampingVerified: false } as never);
  });

  it('bloquea doble clic inmediato y conserva la clave idempotente al reintentar un error', async () => {
    let rejectFirst!: (reason: Error) => void;
    vi.mocked(financeService.createFiscalDraft)
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))
      .mockResolvedValueOnce({ cfdi: { id: 'draft-1' } } as never);
    const user = userEvent.setup();
    render(<IncomeInvoiceGenerator incomeId="income-1" onClose={vi.fn()} onChanged={vi.fn()}/>);
    const dialog = await screen.findByRole('dialog', { name: 'Generar factura CFDI' });
    await user.type(within(dialog).getByLabelText('Uso CFDI'), 'G03');
    await user.selectOptions(within(dialog).getByLabelText('Concepto 1'), 'concept-1');
    await user.clear(within(dialog).getByLabelText('Valor unitario sin impuestos'));
    await user.type(within(dialog).getByLabelText('Valor unitario sin impuestos'), '500');
    const save = within(dialog).getByRole('button', { name: 'Guardar prefactura' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(financeService.createFiscalDraft).toHaveBeenCalledTimes(1);
    const firstKey = vi.mocked(financeService.createFiscalDraft).mock.calls[0][0].idempotency_key;
    expect(typeof firstKey).toBe('string');

    rejectFirst(new Error('Fallo transitorio de red'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Fallo transitorio de red');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar prefactura' }));
    await waitFor(() => expect(financeService.createFiscalDraft).toHaveBeenCalledTimes(2));
    expect(vi.mocked(financeService.createFiscalDraft).mock.calls[1][0].idempotency_key).toBe(firstKey);
  });

  it('conserva la CSF y distingue un fallo posterior de extracción', async () => {
    vi.mocked(financeService.fiscalIncomeContext).mockResolvedValue({ ...context,
      receivers: [{ id: 'receiver-link-1', compareciente: { id: 'party-1', nombre_busqueda: 'Cliente QA', fiscalProfile: null } }],
    } as never);
    vi.mocked(comparecientesService.uploadDocument).mockResolvedValue({ id: 'doc-1' } as never);
    vi.mocked(financeService.extractCsf).mockRejectedValue(new Error('Texto no legible'));
    const user = userEvent.setup();
    render(<IncomeInvoiceGenerator incomeId="income-1" onClose={vi.fn()} onChanged={vi.fn()}/>);
    const dialog = await screen.findByRole('dialog', { name: 'Generar factura CFDI' });
    await user.upload(within(dialog).getByLabelText('Cargar CSF para extraer datos'), new File(['RFC: XAXX010101000'], 'csf-qa.txt', { type: 'text/plain' }));
    await waitFor(() => expect(comparecientesService.uploadDocument).toHaveBeenCalledOnce());
    await waitFor(() => expect(financeService.extractCsf).toHaveBeenCalledOnce());
    expect(await within(dialog).findByText('CSF cargada — error de extracción. El documento sigue disponible.')).toBeVisible();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('La CSF se cargó y permanece disponible');
    expect(within(dialog).getByRole('button', { name: 'Confirmar y guardar datos fiscales' })).toBeEnabled();
  });

  it('precarga concepto y valor unitario desde el ingreso y la tasa fiscal configurada, sin presumir IVA fijo', async () => {
    vi.mocked(financeService.fiscalIncomeContext).mockResolvedValue({ ...context,
      facturableAmount: '1160.00', remainingInvoiceableAmount: '1160.00',
    } as never);
    vi.mocked(financeService.fiscalConcepts).mockResolvedValue([{ id: 'concept-1', entidad_fiscal_id: 'entity-1', activo: true,
      descripcion: 'Honorarios QA', clave_prod_serv: '84111506', clave_unidad: 'E48', iva_tasa: '0.160000',
      iva_retencion_tasa: '0.000000', isr_retencion_tasa: '0.000000',
    }] as never);
    render(<IncomeInvoiceGenerator incomeId="income-1" onClose={vi.fn()} onChanged={vi.fn()}/>);
    const dialog = await screen.findByRole('dialog', { name: 'Generar factura CFDI' });
    await waitFor(() => expect(within(dialog).getByLabelText('Concepto 1')).toHaveValue('concept-1'));
    expect(within(dialog).getByLabelText('Valor unitario sin impuestos')).toHaveValue('1000.00');
    expect(within(dialog).getByText('Total prefactura').parentElement).toHaveTextContent('$1,160.00');
  });
});
