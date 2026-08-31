import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProspectWorkflowPanel } from '../features/prospects/components/ProspectWorkflowPanel';
import { prospectsService } from '../features/prospects/prospects.service';
import { ApiError } from '../services/api/client';
import type { Prospect, ProspectWorkflow } from '../features/prospects/prospects.types';
vi.mock('../features/prospects/prospects.service', () => ({ prospectsService: { act:vi.fn(),prepare:vi.fn(),update:vi.fn(),uploadDocument:vi.fn() } }));
const prospect = { id:'p1',user_id:'u1',nombre:'PRUEBA',estado:'NUEVO',prioridad:'MEDIA',created_at:'2025-01-01',updated_at:'2026-08-31' } as Prospect;
const date='2026-08-31T10:00:00.000Z';
const stages=[
  ['NUEVO','Nuevo'],['RECABANDO_INFORMACION','Recabando información/documentos'],['LISTO_PARA_SOLICITAR','Listo para solicitar cotización'],
  ['SOLICITUD_ENVIADA_NOTARIA','Solicitud enviada a Notaría'],['EN_ESPERA_COTIZACION','En espera de cotización'],['COTIZACION_RECIBIDA','Cotización recibida'],['CONVERTIDO_COTIZACION','Convertido en cotización'],
].map(([code,label])=>({code,label}));
const initial = (overrides:Partial<ProspectWorkflow>={}):ProspectWorkflow => ({
  stage:'NUEVO',stageLabel:'Nuevo',stageEnteredAt:date,knowledge:'KNOWN',version:1,folio:'PRO-0001-2026',
  wait:{type:null,knowledge:'NOT_APPLICABLE',label:'Sin espera correspondiente a esta etapa'},stages,
  actions:[{code:'MARCAR_LISTO',label:'Confirmar listo para solicitar'}],
  notaria:null,notaries:[{id:'n1',nombre:'Notaría de prueba'}],responsibles:[],source:null,sourceHistory:[],canReadSource:true,quote:null,events:[],
  ...overrides,
});
const testDocument={id:'d1',nombre_original:'respuesta.pdf',mime_type:'application/pdf'};
const source={id:'s1',version:1,received_at:date,recorded_at:date,motivo:'Recepción confirmada',documento:testDocument,notaria:{id:'n1',nombre:'Notaría de prueba'}};
const changed=vi.fn().mockResolvedValue(undefined), open=vi.fn();
const show=(w=initial(), canWrite=true) => render(<MemoryRouter><ProspectWorkflowPanel prospect={prospect} workflow={w} documents={[testDocument]} canWrite={canWrite} canUpload={canWrite} onChanged={changed} openDocument={open}/></MemoryRouter>);
describe('G0-A UI contractual',()=>{
  beforeEach(()=>{vi.clearAllMocks();vi.mocked(prospectsService.act).mockResolvedValue({idempotent:false,quoteId:null});});
  it('nuevo y siete labels humanos sin enums técnicos',async()=>{
    show(); await userEvent.click(screen.getByText('Ver las siete etapas'));
    for(const stage of stages) expect(screen.getAllByText(stage.label).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain('EN_ESPERA_COTIZACION');
  });
  it('histórico muestra desconocimiento sin inferir fecha desde timestamps',()=>{
    show(initial({stage:null,stageLabel:'Etapa por confirmar',stageEnteredAt:null,knowledge:'UNKNOWN_LEGACY'}));
    expect(screen.getByText('Fecha de etapa no acreditada')).toBeInTheDocument();
    expect(screen.getByText(/no tiene una transición contractual acreditada/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('UNKNOWN_LEGACY');
  });
  it('sin notaría, fuente ni documentos comunica estados vacíos',()=>{
    show(); expect(screen.getByText('Notaría: Sin notaría asignada')).toBeInTheDocument();
    expect(screen.getByText('Sin cotización de Notaría recibida y confirmada.')).toBeInTheDocument();
  });
  it('confirmación humana y versión esperada son obligatorias',async()=>{
    show(); const user=userEvent.setup(); await user.click(screen.getByRole('button',{name:'Confirmar listo para solicitar'}));
    expect(screen.getByRole('button',{name:'Confirmar acción'})).toBeDisabled();
    await user.click(screen.getByRole('checkbox',{name:'He revisado los datos y confirmo esta acción.'}));
    await user.click(screen.getByRole('button',{name:'Confirmar acción'}));
    await waitFor(()=>expect(prospectsService.act).toHaveBeenCalledWith('p1',expect.objectContaining({action:'MARCAR_LISTO',confirm:true,expectedVersion:1,idempotencyKey:expect.any(String)})));
  });
  it('foco y teclado Enter/Space, cancelar no escribe',async()=>{
    show(); const user=userEvent.setup(); const action=screen.getByRole('button',{name:'Confirmar listo para solicitar'});
    action.focus(); await user.keyboard('{Enter}');
    await waitFor(()=>expect(screen.getByRole('heading',{name:'Confirmar listo para solicitar'})).toHaveFocus());
    await user.tab(); expect(screen.getByRole('checkbox')).toHaveFocus(); await user.keyboard(' ');
    expect(screen.getByRole('checkbox')).toBeChecked(); await user.tab();
    expect(screen.getByRole('button',{name:'Confirmar acción'})).toHaveFocus();
    await user.tab({shift:true}); expect(screen.getByRole('checkbox')).toHaveFocus();
    await user.tab(); await user.tab(); await user.keyboard('{Enter}');
    expect(screen.queryByRole('form',{name:'Confirmar acción'})).not.toBeInTheDocument(); expect(prospectsService.act).not.toHaveBeenCalled();
  });
  it('timeout conserva idempotency key en Reintentar',async()=>{
    vi.mocked(prospectsService.act).mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce({idempotent:true,quoteId:null});
    show(); const user=userEvent.setup(); await user.click(screen.getByRole('button',{name:'Confirmar listo para solicitar'})); await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button',{name:'Confirmar acción'})); expect(await screen.findByRole('alert')).toHaveTextContent('Puedes reintentar');
    const payload=vi.mocked(prospectsService.act).mock.calls[0][1];
    await user.click(screen.getByRole('button',{name:'Confirmar acción'}));
    expect(vi.mocked(prospectsService.act).mock.calls[1][1]).toEqual(payload);
  });
  it('doble click durante petición en curso no repite el POST',async()=>{
    let finish!:()=>void;vi.mocked(prospectsService.act).mockImplementation(()=>new Promise(resolve=>{finish=()=>resolve({idempotent:false,quoteId:null});}));
    show(); await userEvent.click(screen.getByRole('button',{name:'Confirmar listo para solicitar'})); await userEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button',{name:'Confirmar acción'})); fireEvent.click(screen.getByRole('button',{name:'Confirmando…'}));
    expect(prospectsService.act).toHaveBeenCalledTimes(1); finish(); await waitFor(()=>expect(changed).toHaveBeenCalled());
  });
  it('stale muestra error humano sin sobrescribir ni reintentar automáticamente',async()=>{
    vi.mocked(prospectsService.act).mockRejectedValue(new ApiError('La ficha cambió en otra sesión. Actualízala.',409));
    show(); await userEvent.click(screen.getByRole('button',{name:'Confirmar listo para solicitar'})); await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button',{name:'Confirmar acción'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('La ficha cambió'); expect(prospectsService.act).toHaveBeenCalledTimes(1);
  });
  it('preparar/copy no registra envío y adjuntos empiezan deseleccionados',async()=>{
    const user=userEvent.setup();
    vi.mocked(prospectsService.prepare).mockResolvedValue({preparedOnly:true,deliveryConfirmedByProvider:false,version:1,attachmentIds:['d1'],recipient:'notaria@example.test',subject:'Solicitud',content:'Texto real de prueba'});
    show(initial({stage:'LISTO_PARA_SOLICITAR',stageLabel:'Listo para solicitar cotización',notaria:{id:'n1',nombre:'Notaría de prueba'},actions:[{code:'REGISTRAR_ENVIO',label:'Registrar envío realizado'}]}));
    expect(screen.getByRole('checkbox',{name:'respuesta.pdf'})).not.toBeChecked();
    await user.click(screen.getByRole('checkbox',{name:'respuesta.pdf'})); await user.click(screen.getByRole('button',{name:'Preparar solicitud'}));
    expect(await screen.findByLabelText('Contenido para revisión')).toHaveValue('Texto real de prueba');
    await user.click(screen.getByRole('button',{name:'Copiar contenido'}));
    expect(prospectsService.prepare).toHaveBeenCalledWith('p1',1,['d1']); expect(prospectsService.act).not.toHaveBeenCalled();
  });
  it('envío externo conserva contenido revisado, adjuntos, evidencia y fecha',async()=>{
    vi.mocked(prospectsService.prepare).mockResolvedValue({preparedOnly:true,deliveryConfirmedByProvider:false,version:1,attachmentIds:[],recipient:'notaria@example.test',subject:'Solicitud',content:'Texto para revisar'});
    show(initial({stage:'LISTO_PARA_SOLICITAR',stageLabel:'Listo para solicitar cotización',notaria:{id:'n1',nombre:'Notaría de prueba'},actions:[{code:'REGISTRAR_ENVIO',label:'Registrar envío realizado'}]}));
    const user=userEvent.setup(); await user.click(screen.getByRole('button',{name:'Preparar solicitud'}));
    await user.clear(screen.getByLabelText('Contenido para revisión')); await user.type(screen.getByLabelText('Contenido para revisión'),'Revisado por mí');
    await user.click(screen.getByRole('button',{name:'Registrar envío realizado'}));
    await user.type(screen.getByLabelText('Evidencia o referencia del envío'),'Enviado por correo');
    expect(screen.getByLabelText('Evidencia o referencia del envío')).toHaveValue('Enviado por correo');
    expect(screen.getByLabelText('Destinatario')).toHaveValue('notaria@example.test');
    await user.click(screen.getByRole('checkbox',{name:'Confirmo que el envío ya se realizó fuera de PRAVIA.'})); await user.click(screen.getByRole('button',{name:'Confirmar acción'}));
    await waitFor(()=>expect(prospectsService.act).toHaveBeenCalledWith('p1',expect.objectContaining({action:'REGISTRAR_ENVIO',content:'Revisado por mí',evidence:'Enviado por correo',effectiveAt:expect.any(String),attachmentIds:[]})));
  });
  it('carga de respuesta no confirma recepción ni cambia etapa',async()=>{
    vi.mocked(prospectsService.uploadDocument).mockResolvedValue(testDocument);
    show(initial({stage:'EN_ESPERA_COTIZACION',actions:[{code:'REGISTRAR_RECEPCION',label:'Registrar cotización recibida'}]}));
    await userEvent.upload(screen.getByLabelText('Adjuntar respuesta de Notaría'),new File(['test'],'respuesta.pdf',{type:'application/pdf'}));
    await userEvent.click(screen.getByRole('button',{name:'Cargar archivo sin confirmar recepción'}));
    await waitFor(()=>expect(prospectsService.uploadDocument).toHaveBeenCalled()); expect(prospectsService.act).not.toHaveBeenCalled();
  });
  it('recepción explícita envía documento y fecha al backend',async()=>{
    show(initial({stage:'EN_ESPERA_COTIZACION',actions:[{code:'REGISTRAR_RECEPCION',label:'Registrar cotización recibida'}]}));
    await userEvent.click(screen.getByRole('button',{name:'Registrar cotización recibida'}));
    await userEvent.selectOptions(screen.getByLabelText('Archivo recibido'),'d1'); await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button',{name:'Confirmar acción'}));
    await waitFor(()=>expect(prospectsService.act).toHaveBeenCalledWith('p1',expect.objectContaining({action:'REGISTRAR_RECEPCION',documentId:'d1',effectiveAt:expect.any(String)})));
  });
  it('fuente versionada se presenta separada, primera recepción y visor existente',async()=>{
    show(initial({stage:'COTIZACION_RECIBIDA',source,sourceHistory:[source],actions:[]}));
    const section=screen.getByRole('region',{name:'Cotización de Notaría'});
    expect(within(section).getByText(/Primera recepción/)).toBeInTheDocument();
    await userEvent.click(within(section).getAllByRole('button',{name:'Abrir respuesta.pdf'})[0]); expect(open).toHaveBeenCalledWith(testDocument);
  });
  it('conversión requiere confirmación y no muestra otro envío notarial',async()=>{
    show(initial({stage:'COTIZACION_RECIBIDA',source,sourceHistory:[source],actions:[{code:'CONVERTIR',label:'Crear cotización'}]}));
    await userEvent.click(screen.getByRole('button',{name:'Crear cotización'})); await userEvent.click(screen.getByRole('checkbox')); await userEvent.click(screen.getByRole('button',{name:'Confirmar acción'}));
    await waitFor(()=>expect(prospectsService.act).toHaveBeenCalledWith('p1',expect.objectContaining({action:'CONVERTIR'})));
  });
  it('convertido conserva enlace trazable sin ofrecer segunda conversión',()=>{
    show(initial({stage:'CONVERTIDO_COTIZACION',stageLabel:'Convertido en cotización',actions:[],quote:{id:'q1',estado:'BORRADOR',numero_cotizacion:'COT-0001-2026'}}));
    expect(screen.getByRole('link',{name:'Abrir COT-0001-2026'})).toHaveAttribute('href','/cotizaciones/q1');
    expect(screen.queryByRole('button',{name:'Crear cotización'})).not.toBeInTheDocument();
  });
  it('read-only y sin documentos.read no filtra fuente ni ofrece escrituras',()=>{
    show(initial({actions:[],canReadSource:false,source:null,sourceHistory:[]}),false);
    expect(screen.getByText(/Tu perfil no permite consultar/)).toBeInTheDocument();
    expect(screen.queryByRole('button',{name:'Guardar asignación'})).not.toBeInTheDocument();
  });
});
