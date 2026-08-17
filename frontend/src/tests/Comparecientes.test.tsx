import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../app/App';

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: vi.fn().mockResolvedValue({
        getViewport: ({ scale }: { scale: number }) => ({ width: 612 * scale, height: 792 * scale }),
        render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
      }),
    }),
    destroy: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf.worker.min.mjs' }));

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const grants=['comparecientes.read','comparecientes.write','documentos.read','documentos.write','documentos.unlink','ia.execute','expedientes.read'];
const session={user:{id:'user-1',name:'Andrea Ruiz',role:'ADMINISTRACION',permissions:grants}};
const row={id:'party-1',tipo_persona:'FISICA',nombre:'MARÍA FERNANDA LÓPEZ RAMÍREZ',rfc:'LORM900101AA1',curp:'LORM900101MNLPZR08',expedientes_vinculados:3,documentos:{total:1},updated_at:'2026-08-12T17:00:00.000Z'};
const list={success:true,data:[row],metrics:{total:5,physical:3,legal:2},meta:{total:1,page:1,limit:20,pageSize:20,totalPages:1,hasPreviousPage:false,hasNextPage:false},definitions:{documents:'Documentos activos'}};
const detail:any={...row,nombre_busqueda:row.nombre,estatus:'ACTIVO',created_at:'2026-07-01T10:00:00.000Z',updated_at_material:row.updated_at,observaciones:'Revisión notarial pendiente',creado_por:{id:'user-1',nombre:'Andrea',apellido:'Ruiz'},personaFisica:{nombre:'MARÍA FERNANDA',apellido_paterno:'LÓPEZ',apellido_materno:'RAMÍREZ',nombre_completo_calculado:row.nombre,nacionalidad:'Mexicana',pep_estado:'NO',rfc:row.rfc,curp:row.curp},personaMoral:null,aliases:[],domicilios:[{id:'address-1',tipo:'PARTICULAR',calle:'Av. México',exterior:'120',colonia:'Centro',municipio:'Tepic',localidad:'Tepic',estado:'Nayarit',codigo_postal:'63000',pais:'México'}],contactos:[{id:'email-1',tipo:'CORREO',valor:'maria@example.mx'},{id:'phone-1',tipo:'TELEFONO',valor:'3111234567'}],identificaciones:[{id:'identity-1',principal:true,tipo_identificacion:'INE',numero:'4401',pais_emisor:'México'}],documentos:[{id:'link-1',categoria:'IDENTIFICACION',documento:{id:'doc-1',nombre_original:'INE.pdf',mime_type:'application/pdf',size_bytes:22000,fecha_carga:'2026-08-01T10:00:00.000Z'}},{id:'link-2',categoria:'DOMICILIO',documento:{id:'doc-2',nombre_original:'domicilio.png',mime_type:'image/png',size_bytes:12000,fecha_carga:'2026-08-02T10:00:00.000Z'}}],datosFuente:[],expedientes:[{id:'link-exp-1',expediente:{id:'exp-1',numero_pravia:'EXP-2026-0041',complianceReviews:[]}}],representacionesComoRepresentante:[],representacionesComoRepresentado:[],complianceSnapshots:[],actividad:[],health:[],capabilities:{canEdit:true,canUploadDocuments:true,canReadDocuments:true,canDeleteDocuments:true,canExtractWithAI:true,canArchive:true,allowsSoftDuplicateOverride:true,blocksExactIdentityDuplicate:true}};

function mockApi(options:{empty?:boolean;fail?:boolean;permissions?:string[]}={}){
  return vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);
    if(url.endsWith('/auth/me'))return json({user:{...session.user,permissions:options.permissions||grants}});
    if(url.includes('/comparecientes/duplicados?'))return json({success:true,data:[]});
    if(url.includes('/comparecientes?'))return options.fail?json({error:'No disponible'},500):json(options.empty?{...list,data:[],metrics:{total:0,physical:0,legal:0},meta:{...list.meta,total:0}}:list);
    if(url.endsWith('/comparecientes/altas')&&init?.method==='POST')return json({session:{id:'11111111-1111-4111-8111-111111111111'}},201);
    if(url.includes('/comparecientes/altas/')&&url.endsWith('/documentos')&&init?.method==='POST')return json({documento:{id:'temp-1',nombre_original:'constancia.pdf'}},201);
    if(url.includes('/comparecientes/altas/')&&url.endsWith('/extraer')&&init?.method==='POST')return json({borrador_actualizado:{rfc:'LORM900101AA1',_ia_propuesta:{rfc:{valor:'LORM900101AA1',fuente:'Constancia Fiscal.pdf',estado:'PENDIENTE_CONFIRMACION'}}}});
    if(url.includes('/comparecientes/altas/')&&url.endsWith('/confirmar')&&init?.method==='POST')return json({compareciente:{id:'created-party'}});
    if(url.endsWith('/comparecientes/party-1/extraer-ia')&&init?.method==='POST')return json({success:true,data:{values:{ocupacion:'ARQUITECTA'},proposals:{ocupacion:{valor:'ARQUITECTA',fuente:'INE.pdf',estado:'PENDIENTE_CONFIRMACION'}},conflicts:[],domicilios_detectados:[]}});
    if(url.includes('/comparecientes/party-1/documentos/')&&url.endsWith('/visualizar'))return new Response(new Blob(['preview'],{type:url.includes('doc-2')?'image/png':'application/pdf'}),{status:200});
    if(url.includes('/comparecientes/party-1/documentos/')&&url.endsWith('/descargar'))return new Response(new Blob(['download'],{type:'application/pdf'}),{status:200,headers:{'Content-Disposition':'attachment; filename="documento.pdf"'}});
    if(url.endsWith('/comparecientes/party-1')&&init?.method==='PATCH')return json({success:true,data:{}});
    if(url.endsWith('/comparecientes/party-1')){const permissions=options.permissions||grants;return json({success:true,data:{...detail,capabilities:{...detail.capabilities,canEdit:permissions.includes('comparecientes.write'),canUploadDocuments:permissions.includes('documentos.write'),canDeleteDocuments:permissions.includes('documentos.unlink'),canExtractWithAI:permissions.includes('ia.execute')}}})}
    if(url.endsWith('/comparecientes/party-1/documentos')&&init?.method==='POST')return json({success:true,data:{}},201);
    if(url.includes('/comparecientes/party-1/documentos/doc-1')&&init?.method==='DELETE')return json({success:true,data:{}});
    return json({},200);
  }));
}
const renderPath=(path:string)=>render(<MemoryRouter initialEntries={[path]}><App/></MemoryRouter>);

describe('Comparecientes client workspace',()=>{
  beforeEach(()=>{vi.restoreAllMocks();window.localStorage.clear();vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({} as CanvasRenderingContext2D);vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>undefined);Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=>`blob:local-preview-${Math.random()}`)});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()})});

  it('muestra únicamente Total, Personas físicas y Personas morales',async()=>{mockApi();renderPath('/comparecientes');expect(await screen.findByText('Total comparecientes')).toBeInTheDocument();expect(screen.getByText('Personas físicas')).toBeInTheDocument();expect(screen.getByText('Personas morales')).toBeInTheDocument();expect(screen.queryByText('Identidad verificada')).not.toBeInTheDocument();expect(screen.queryByText('Pendientes')).not.toBeInTheDocument();expect(screen.queryByText('Con observación')).not.toBeInTheDocument()});

  it('mantiene solo búsqueda, Tipo, Actualización y Orden',async()=>{mockApi();const user=userEvent.setup();renderPath('/comparecientes');await screen.findByLabelText('Vista de tarjetas de comparecientes');expect(screen.getByLabelText('Tipo de persona')).toBeInTheDocument();expect(screen.getByLabelText('Actualización')).toBeInTheDocument();expect(screen.getByLabelText('Ordenar')).toBeInTheDocument();expect(screen.queryByLabelText(/identidad/i)).not.toBeInTheDocument();expect(screen.queryByLabelText(/cumplimiento/i)).not.toBeInTheDocument();await user.type(screen.getByPlaceholderText(/Nombre, razón social/),'López');await user.selectOptions(screen.getByLabelText('Tipo de persona'),'FISICA');await waitFor(()=>expect(fetch).toHaveBeenCalledWith(expect.stringContaining('tipo_persona=FISICA'),expect.anything()))});

  it('comparte datos entre Tarjetas y Lista y conserva la preferencia',async()=>{mockApi();const user=userEvent.setup();renderPath('/comparecientes');const card=await screen.findByRole('link',{name:`Abrir ficha de ${row.nombre}`});expect(within(card).getByText('3')).toBeInTheDocument();expect(within(card).getByText('1 vinculado')).toBeInTheDocument();expect(screen.queryByText(/Verificada/)).not.toBeInTheDocument();await user.click(screen.getByRole('button',{name:'Lista'}));expect(await screen.findByRole('table')).toBeInTheDocument();expect(window.localStorage.getItem('pravia:comparecientes:view')).toBe('list')});

  it('abre alta como una sola superficie sin wizard ni tabs',async()=>{mockApi();renderPath('/comparecientes/nuevo');expect(await screen.findByRole('heading',{name:'Nuevo compareciente'})).toBeInTheDocument();expect(screen.getByRole('heading',{name:'Datos notariales'})).toBeInTheDocument();expect(screen.getByRole('heading',{name:'Documentación'})).toBeInTheDocument();expect(screen.getByRole('heading',{name:'Extracción con IA'})).toBeInTheDocument();expect(screen.queryByText('Siguiente')).not.toBeInTheDocument();expect(screen.queryByRole('tab')).not.toBeInTheDocument()});

  it('usa la misma superficie para existente y guarda edición directa',async()=>{mockApi();const user=userEvent.setup();renderPath('/comparecientes/party-1');expect(await screen.findByRole('heading',{name:row.nombre})).toBeInTheDocument();const occupation=screen.getByLabelText('Ocupación o profesión');await user.type(occupation,'Arquitecta');await user.click(screen.getByRole('button',{name:'Guardar cambios'}));await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url,init])=>String(url).endsWith('/comparecientes/party-1')&&init?.method==='PATCH')).toBe(true));expect(screen.queryByRole('button',{name:/Editar/})).not.toBeInTheDocument()});

  it('respeta read-only sin ocultar información',async()=>{mockApi({permissions:['comparecientes.read','documentos.read']});renderPath('/comparecientes/party-1');expect(await screen.findByText('Solo lectura')).toBeInTheDocument();expect(screen.getByLabelText(/Nombre\(s\)/)).toHaveAttribute('readonly');expect(screen.queryByRole('button',{name:'Guardar cambios'})).not.toBeInTheDocument()});

  it('carga sin metadata, previsualiza contenido PDF/imagen y ofrece descarga y eliminación confirmada',async()=>{mockApi();const user=userEvent.setup();renderPath('/comparecientes/party-1');await screen.findByText('INE.pdf');const input=screen.getByLabelText(/Arrastra archivos aquí/) as HTMLInputElement;await user.upload(input,new File(['pdf'],'nuevo.pdf',{type:'application/pdf'}));await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url,init])=>String(url).endsWith('/party-1/documentos')&&init?.method==='POST')).toBe(true));expect(screen.queryByLabelText(/categoría/i)).not.toBeInTheDocument();await user.click(screen.getByRole('button',{name:'Previsualizar INE.pdf'}));const canvas=await screen.findByLabelText('Página 1 de INE.pdf');await waitFor(()=>expect(canvas).toHaveAttribute('data-preview-loaded','true'));await user.click(screen.getByRole('button',{name:'Cerrar vista previa'}));await user.click(screen.getByRole('button',{name:'Previsualizar domicilio.png'}));const image=await screen.findByAltText('Vista previa de domicilio.png');expect(image).toHaveAttribute('src',expect.stringContaining('blob:local-preview-'));fireEvent.load(image);expect(image).toHaveAttribute('data-preview-loaded','true');await user.click(screen.getByRole('button',{name:'Cerrar vista previa'}));await user.click(screen.getByRole('button',{name:'Descargar INE.pdf'}));await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url])=>String(url).includes('/documentos/doc-1/descargar'))).toBe(true));await user.click(screen.getByRole('button',{name:'Eliminar INE.pdf'}));const dialog=screen.getByRole('alertdialog');expect(within(dialog).getByText(/conservará la trazabilidad/)).toBeInTheDocument();await user.click(within(dialog).getByRole('button',{name:'Eliminar documento'}));await waitFor(()=>expect(vi.mocked(fetch).mock.calls.some(([url,init])=>String(url).includes('/documentos/doc-1')&&init?.method==='DELETE')).toBe(true))});

  it('aplica propuesta IA al borrador sin guardarla automáticamente',async()=>{mockApi();const user=userEvent.setup();renderPath('/comparecientes/party-1');await screen.findByText('INE.pdf');await user.click(screen.getByRole('button',{name:'Extraer información con IA'}));expect(await screen.findByDisplayValue('ARQUITECTA')).toBeInTheDocument();expect(screen.getByText('Fuente: INE.pdf')).toBeInTheDocument();expect(vi.mocked(fetch).mock.calls.some(([url,init])=>String(url).endsWith('/party-1')&&init?.method==='PATCH')).toBe(false)});

  it('adapta el mismo formulario a Persona moral sin campos inventados',async()=>{mockApi();const user=userEvent.setup();renderPath('/comparecientes/nuevo');await user.click(await screen.findByRole('button',{name:'Persona moral'}));expect(screen.getByLabelText('Razón social *')).toBeInTheDocument();expect(screen.getByLabelText('Folio mercantil')).toBeInTheDocument();expect(screen.getByLabelText('Objeto social resumido')).toBeInTheDocument();expect(screen.queryByLabelText('CURP')).not.toBeInTheDocument()});

  it('muestra estados vacío y error humanos',async()=>{mockApi({empty:true});const first=renderPath('/comparecientes');expect(await screen.findByText('No hay comparecientes.')).toBeInTheDocument();first.unmount();mockApi({fail:true});renderPath('/comparecientes');expect(await screen.findByText('No pudimos cargar los comparecientes.')).toBeInTheDocument()});
});
