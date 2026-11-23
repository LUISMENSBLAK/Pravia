import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SandboxStampAction } from '../features/finance/components/SandboxStampAction';
import { financeService } from '../features/finance/finance.service';
const auth=vi.hoisted(()=>({permissions:['finanzas.validate','documentos.write']}));
vi.mock('../features/auth/AuthProvider',()=>({useAuth:()=>({user:auth})}));
vi.mock('../features/finance/finance.service',()=>({financeService:{stampSandboxDraft:vi.fn()}}));
const provider={configured:true,provider:'FACTURAMA_SANDBOX',cfdiEnabled:true,environment:'SANDBOX' as const,sandboxStampingEnabled:true,realStampingVerified:false,manualUploadEnabled:true,localDraftsEnabled:true,message:'SANDBOX'};
const item={id:'synthetic',estado:'DRAFT',updated_at:'2026-11-23T10:00:00Z',emisor_rfc:'EKU9003173C9',receptor_rfc:'URE180429TM6'};
beforeEach(()=>{vi.clearAllMocks();auth.permissions=['finanzas.validate','documentos.write'];});
describe('Timbrado sandbox visible and explicit',()=>{
  it('requires explicit confirmation and prevents double click while pending',async()=>{
    let resolve!:(value:unknown)=>void;vi.mocked(financeService.stampSandboxDraft).mockReturnValue(new Promise(r=>{resolve=r;}) as any);
    const onChanged=vi.fn();render(<SandboxStampAction item={item} provider={provider} onChanged={onChanged}/>);
    expect(screen.getByRole('button')).toBeDisabled();fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button'));fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Esperando respuesta del sandbox…')).toBeInTheDocument();expect(financeService.stampSandboxDraft).toHaveBeenCalledTimes(1);
    resolve({});await waitFor(()=>expect(onChanged).toHaveBeenCalledTimes(1));expect(screen.getByRole('status')).toHaveTextContent('Sin validez fiscal');
  });
  it('never enables for a real customer identity or missing permissions',()=>{
    auth.permissions=[];render(<SandboxStampAction item={{...item,receptor_rfc:'REAL010101AA1'}} provider={provider} onChanged={()=>{}}/>);expect(screen.getByRole('button')).toBeDisabled();
  });
  it('does not expose sandbox action when disabled',()=>{const {container}=render(<SandboxStampAction item={item} provider={{...provider,sandboxStampingEnabled:false}} onChanged={()=>{}}/>);expect(container).toBeEmptyDOMElement();});
  it('marks completed test distinctly and never offers another stamp',()=>{render(<SandboxStampAction item={{...item,estado:'TIMBRADO_SANDBOX'}} provider={provider} onChanged={()=>{}}/>);expect(screen.queryByRole('button',{name:'Timbrar PRUEBA sandbox'})).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Ver PDF de prueba'})).toBeInTheDocument();expect(screen.getByRole('status')).toHaveTextContent('Prueba terminada');});
  it('shows actual failure instead of success and reloads persisted status',async()=>{
    vi.mocked(financeService.stampSandboxDraft).mockRejectedValue(new Error('Resultado desconocido; conciliar'));const changed=vi.fn();render(<SandboxStampAction item={item} provider={provider} onChanged={changed}/>);fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button'));expect(await screen.findByRole('alert')).toHaveTextContent('Resultado desconocido');expect(changed).toHaveBeenCalled();
  });
});
