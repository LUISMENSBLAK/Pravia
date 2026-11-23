import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ extract: vi.fn() }));
vi.mock('../services/comparecienteAltaSession.service', () => ({ ComparecienteAltaSessionService: { extraerDatosConIA: mocks.extract } }));
import { ComparecienteAltaSessionController } from './comparecienteAltaSession.controller';
import { PlatformDomainError } from '../platform/platform.errors';

describe('Alta nueva: errores de IA accionables', () => {
  beforeEach(()=>vi.clearAllMocks());
  const req = { params: { sessionId: '11111111-1111-4111-8111-111111111111' }, body: {}, header: ()=>'request-key' } as any;
  const response = () => { const res:any={};res.status=vi.fn(()=>res);res.json=vi.fn(()=>res);return res; };
  it.each([['AI_EXTERNAL_DISABLED',503],['AI_BALANCE_EXHAUSTED',402],['AI_OPERATION_DISABLED',409]])('conserva %s sin convertirlo en error 500', async(code,status)=>{
    mocks.extract.mockRejectedValue(new PlatformDomainError(String(code),'Mensaje controlado',Number(status)));
    const res=response(); await ComparecienteAltaSessionController.extraerIA(req,res);
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith({success:false,ok:false,code,error:'Mensaje controlado'});
  });
  it('no publica trazas ni respuestas de proveedor en un fallo inesperado',async()=>{
    const log=vi.spyOn(console,'error').mockImplementation(()=>undefined);
    try {
      mocks.extract.mockRejectedValue(Object.assign(new Error('secret-source-content'),{finishReason:'private',rawLength:42}));
      const res=response();await ComparecienteAltaSessionController.extraerIA(req,res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(JSON.stringify(res.json.mock.calls)).not.toContain('secret-source-content');
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret-source-content');
    } finally {log.mockRestore();}
  });
});
