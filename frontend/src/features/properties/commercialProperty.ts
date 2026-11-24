import { apiRequest } from '../../services/api/client';
export type CommercialPropertyKind = 'cotizacion' | 'prospecto';
export type CommercialProperty = { id:string;apodo?:string|null;clave_catastral?:string|null;cuenta_predial?:string|null;folio_real?:string|null;ubicacion_texto?:string|null;version:number;archived_at?:string|null;
  valor_operacion?:string|number|null;valor_catastral?:string|number|null;valor_avaluo?:string|number|null };
export type CommercialPropertyState = { property:CommercialProperty|null;source:'MANUAL'|'PREDIO_MASTER';expected_updated_at:string;
  values:{operationValue:string|null;cadastralValue:string|null;appraisalValue:string|null};capabilities:{canWrite:boolean;canCreateProperty:boolean;canOpenProperty:boolean} };
const base=(kind:CommercialPropertyKind,id:string)=>`/${kind==='cotizacion'?'cotizaciones':'prospectos'}/${encodeURIComponent(id)}/inmueble`;
export const commercialPropertyService={
  read:(kind:CommercialPropertyKind,id:string,signal?:AbortSignal)=>apiRequest<{data:CommercialPropertyState}>(base(kind,id),{signal}).then(r=>r.data),
  options:(kind:CommercialPropertyKind,id:string,search:string,signal?:AbortSignal)=>apiRequest<{data:CommercialProperty[]}>(`${base(kind,id)}/opciones?${new URLSearchParams({search})}`,{signal}).then(r=>r.data),
  select:(kind:CommercialPropertyKind,id:string,state:CommercialPropertyState,property:CommercialProperty|null)=>apiRequest<{data:CommercialPropertyState}>(base(kind,id),{method:'PUT',body:JSON.stringify({predio_id:property?.id??null,expected_updated_at:state.expected_updated_at,expected_property_version:property?.version,confirm:true})}).then(r=>r.data),
};
const safeId=/^[a-zA-Z0-9_-]{1,128}$/;
export function commercialPropertyContext(kind:CommercialPropertyKind,id:string){
  if(!safeId.test(id)) throw Error('Identificador inválido.');
  return new URLSearchParams({[kind==='cotizacion'?'fromQuote':'fromProspect']:id}).toString();
}
export function resolveCommercialPropertyReturn(search:string){
  const p=new URLSearchParams(search);const quote=p.get('fromQuote'),prospect=p.get('fromProspect');
  if(Boolean(quote)===Boolean(prospect)) return null;
  const id=quote||prospect;if(!id||!safeId.test(id))return null;
  return {kind:quote?'cotizacion' as const:'prospecto' as const,id,returnPath:`/${quote?'cotizaciones':'prospectos'}/${encodeURIComponent(id)}#inmueble`};
}
