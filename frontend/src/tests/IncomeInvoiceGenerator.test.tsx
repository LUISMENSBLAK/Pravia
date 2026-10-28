import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IncomeInvoiceGenerator } from '../features/finance/components/IncomeInvoiceGenerator';
import { financeService } from '../features/finance/finance.service';
import { comparecientesService } from '../features/comparecientes/comparecientes.service';

vi.mock('../features/finance/finance.service', () => ({ financeService: {
  fiscalIncomeContext: vi.fn(), fiscalEntities: vi.fn(), fiscalConcepts: vi.fn(), fiscalStatus: vi.fn(),
  createFiscalDraft: vi.fn(), updateFiscalDraft: vi.fn(), deleteFiscalDraft: vi.fn(), extractCsf: vi.fn(),
  confirmFiscalReceiver: vi.fn(),
  prefacturaVersions: vi.fn(), prefacturaVersionUrl: vi.fn(), generatePrefactura: vi.fn(),
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
    vi.mocked(financeService.prefacturaVersions).mockResolvedValue({ draft_id: 'draft-1', internal_folio: 'FAC-BOR-000001', versions: [] });
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
    const save = within(dialog).getByRole('button', { name: 'Guardar borrador' });
    fireEvent.click(save);
    fireEvent.click(save);
    expect(financeService.createFiscalDraft).toHaveBeenCalledTimes(1);
    const firstKey = vi.mocked(financeService.createFiscalDraft).mock.calls[0][0].idempotency_key;
    expect(typeof firstKey).toBe('string');

    rejectFirst(new Error('Fallo transitorio de red'));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Fallo transitorio de red');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(financeService.createFiscalDraft).toHaveBeenCalledTimes(2));
    expect(vi.mocked(financeService.createFiscalDraft).mock.calls[1][0].idempotency_key).toBe(firstKey);
  });

  it('conserva la CSF y distingue un fallo posterior de extracción', async () => {
    vi.mocked(financeService.fiscalIncomeContext).mockResolvedValue({ ...context,
      receivers: [{ id: 'receiver-link-1', compareciente: { id: 'party-1', nombre_busqueda: 'Cliente QA', fiscalProfile: null } }],
    } as never);
    vi.mocked(comparecientesService.uploadDocument).mockResolvedValue({ success:true,
      data:{docMaster:{id:'doc-1',checksum_sha256:'synthetic-hash'},vinculo:{id:'link-1'}} } as never);
    vi.mocked(financeService.extractCsf).mockRejectedValue(new Error('Texto no legible'));
    const user = userEvent.setup();
    render(<IncomeInvoiceGenerator incomeId="income-1" onClose={vi.fn()} onChanged={vi.fn()}/>);
    const dialog = await screen.findByRole('dialog', { name: 'Generar factura CFDI' });
    await user.upload(within(dialog).getByLabelText('Cargar CSF para extraer datos'), new File(['%PDF-'], 'csf-sintetica.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(comparecientesService.uploadDocument).toHaveBeenCalledOnce());
    await waitFor(() => expect(financeService.extractCsf).toHaveBeenCalledOnce());
    expect(await within(dialog).findByText('CSF cargada — error de extracción. El documento sigue disponible.')).toBeVisible();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('La CSF se cargó y permanece disponible');
    expect(within(dialog).getByRole('button', { name: 'Confirmar y guardar datos fiscales' })).toBeEnabled();
  });

  it('permite guardar un borrador incompleto sin importar saldo ni crear una prefactura falsa', async () => {
    vi.mocked(financeService.fiscalIncomeContext).mockResolvedValue({ ...context,
      receivers: [{ id: 'receiver-link-1', compareciente: { id: 'party-1', nombre_busqueda: 'Cliente QA', fiscalProfile: null } }],
    } as never);
    vi.mocked(financeService.createFiscalDraft).mockResolvedValue({ cfdi: { id: 'draft-incomplete' } } as never);
    const user = userEvent.setup();
    render(<IncomeInvoiceGenerator incomeId="income-1" onClose={vi.fn()} onChanged={vi.fn()}/>);
    const dialog = await screen.findByRole('dialog', { name: 'Generar factura CFDI' });
    await user.click(within(dialog).getByRole('button', { name: 'Guardar borrador incompleto' }));
    await waitFor(() => expect(financeService.createFiscalDraft).toHaveBeenCalledWith(expect.objectContaining({
      allow_incomplete: true, ingreso_reportado_id: 'income-1', receptor_compareciente_id: 'party-1',
      subtotal: '0.00', total: '0.00', conceptos: [],
    })));
    expect(await within(dialog).findByText(/Borrador incompleto guardado sin importes ni reserva/)).toBeVisible();
  });

  it('envía el ID y hash del archivo cargado junto a todos los regímenes extraídos para confirmación', async () => {
    vi.mocked(financeService.fiscalIncomeContext).mockResolvedValue({...context,receivers:[{
      id:'receiver-link-1',compareciente:{id:'party-1',nombre_busqueda:'Cliente QA',fiscalProfile:null},
    }]} as never);
    vi.mocked(comparecientesService.uploadDocument).mockResolvedValue({success:true,
      data:{docMaster:{id:'csf-doc-1',checksum_sha256:'hash-qa'},vinculo:{id:'link-qa'}}} as never);
    vi.mocked(financeService.extractCsf).mockResolvedValue({rfc:'QAFA010101QA1',
      razon_social:'PERSONA FISICA SINTETICA',codigo_postal:'63735',sha256:'hash-qa',status:'EXTRACTED',
      source:'DETERMINISTIC_PDF_TEXT',requiresReview:true,
      regimenes_fiscales:[{clave:'901',descripcion:'Sintético A'},{clave:'902',descripcion:'Sintético B'}],
    } as never);
    vi.mocked(financeService.confirmFiscalReceiver).mockResolvedValue({} as never);
    const user=userEvent.setup();
    render(<IncomeInvoiceGenerator incomeId="income-1" onClose={vi.fn()} onChanged={vi.fn()}/>);
    const dialog=await screen.findByRole('dialog',{name:'Generar factura CFDI'});
    await user.upload(within(dialog).getByLabelText('Cargar CSF para extraer datos'),
      new File(['%PDF-'], 'CSF_SINTETICA_SIN_VALIDEZ_FISCAL.pdf', {type:'application/pdf'}));
    await within(dialog).findByText('Se conservarán los 2 regímenes detectados; después elegirás uno para esta factura.');
    await user.selectOptions(within(dialog).getByLabelText('Régimen'),'902');
    await user.click(within(dialog).getByRole('button',{name:'Confirmar y guardar datos fiscales'}));
    await waitFor(()=>expect(financeService.confirmFiscalReceiver).toHaveBeenCalledWith('income-1','party-1',
      expect.objectContaining({csf_documento_id:'csf-doc-1',csf_sha256:'hash-qa',regimen_fiscal:'902',
        regimenes_fiscales:[{clave:'901',descripcion:'Sintético A'},{clave:'902',descripcion:'Sintético B'}]})));
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

  it('exige elegir un régimen confirmado para la factura sin borrar los demás del perfil', async () => {
    vi.mocked(financeService.fiscalIncomeContext).mockResolvedValue({...context,receivers:[{
      id:'receiver-link-1',compareciente:{id:'party-1',nombre_busqueda:'Cliente QA',fiscalProfile:{
        rfc:'XAXX010101000',razon_social:'Cliente QA',regimen_fiscal:'901',codigo_postal:'63735',version:2,
        regimenes_fiscales:[{clave:'901',descripcion:'Régimen sintético A'},{clave:'902',descripcion:'Régimen sintético B'}],
      }},
    }]} as never);
    vi.mocked(financeService.createFiscalDraft).mockResolvedValue({cfdi:{id:'draft-regime'}} as never);
    const user=userEvent.setup();
    render(<IncomeInvoiceGenerator incomeId="income-1" onClose={vi.fn()} onChanged={vi.fn()}/>);
    const dialog=await screen.findByRole('dialog',{name:'Generar factura CFDI'});
    const selector=within(dialog).getByLabelText('Régimen para esta factura');
    expect(within(selector).getAllByRole('option')).toHaveLength(3);
    expect(selector).toHaveValue('');
    await user.selectOptions(selector,'902');
    await user.type(within(dialog).getByLabelText('Uso CFDI'),'G03');
    await user.selectOptions(within(dialog).getByLabelText('Concepto 1'),'concept-1');
    await user.clear(within(dialog).getByLabelText('Valor unitario sin impuestos'));
    await user.type(within(dialog).getByLabelText('Valor unitario sin impuestos'),'500');
    await user.click(within(dialog).getByRole('button',{name:'Guardar borrador'}));
    await waitFor(()=>expect(financeService.createFiscalDraft).toHaveBeenCalledWith(expect.objectContaining({
      receptor_regimen:'902',receptor_compareciente_id:'party-1',
    })));
  });
  it('no habilita un botón de timbrado sin operación real aunque el proveedor informe conexión', async () => {
    vi.mocked(financeService.fiscalStatus).mockResolvedValue({configured:true,realStampingVerified:true} as never);
    vi.mocked(financeService.fiscalIncomeContext).mockResolvedValue({...context,documents:[{
      id:'draft-qa',estado:'PREFACTURA',entidad_fiscal_id:'entity-1',receptor_compareciente_id:'party-1',
      receptor_regimen:'616',uso_cfdi:'G03',metodo_pago:'PPD',forma_pago:'99',moneda:'MXN',
      draft_payload:{fiscal_comprobante:{lugar_expedicion:'63735'},concepts:[{
        concepto_fiscal_id:'concept-1',cantidad:'1',valor_unitario:'1000.00',
      }]},
    }]} as never);
    vi.mocked(financeService.fiscalEntities).mockResolvedValue([{id:'entity-1',activa:true,
      razon_social:'Notaría QA',rfc:'AAA010101AAA',regimen_fiscal:'601',codigo_postal:'63735',
      csd_key_configured:true,csd_password_configured:true}] as never);
    render(<IncomeInvoiceGenerator incomeId="income-1" onClose={vi.fn()} onChanged={vi.fn()}/>);
    const dialog=await screen.findByRole('dialog',{name:'Generar factura CFDI'});
    expect(within(dialog).getByRole('button',{name:'Timbrar CFDI'})).toBeDisabled();
    expect(within(dialog).getByText('Timbrado no disponible: La operación de timbrado real aún no está implementada ni certificada.')).toBeVisible();
  });
});
