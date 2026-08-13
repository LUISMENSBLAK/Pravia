import { apiRequest } from '../../services/api/client';
import type { CollectionsReport, EightyTwentyReport, FinanceReport, LawyersReport, PotentialClientsReport, ReportingCatalogs, SignaturesReport, SummaryReport } from './reporting.types';

const unwrap=<T>(value:{success:boolean;data:T}|T):T=>value&&typeof value==='object'&&'data'in value?(value as {data:T}).data:value as T;
const query=(filters:Record<string,string>)=>{const p=new URLSearchParams();Object.entries(filters).forEach(([k,v])=>{if(v)p.set(k,v);});return p.toString();};
const get=async<T>(path:string,filters:Record<string,string>,signal?:AbortSignal)=>unwrap(await apiRequest<{success:boolean;data:T}>(`/reportes/${path}?${query(filters)}`,{signal}));
export const reportingService={
  catalogs:(signal?:AbortSignal)=>get<ReportingCatalogs>('catalogos',{},signal),
  summary:(filters:Record<string,string>,signal?:AbortSignal)=>get<SummaryReport>('resumen',filters,signal),
  finance:(filters:Record<string,string>,signal?:AbortSignal)=>get<FinanceReport>('finanzas',filters,signal),
  collections:(filters:Record<string,string>,signal?:AbortSignal)=>get<CollectionsReport>('cobranza',filters,signal),
  lawyers:(filters:Record<string,string>,signal?:AbortSignal)=>get<LawyersReport>('abogados',filters,signal),
  signatures:(filters:Record<string,string>,signal?:AbortSignal)=>get<SignaturesReport>('firmas',filters,signal),
  eightyTwenty:(filters:Record<string,string>,signal?:AbortSignal)=>get<EightyTwentyReport>('80-20',filters,signal),
  potentialClients:(filters:Record<string,string>,signal?:AbortSignal)=>get<PotentialClientsReport>('clientes-potenciales',filters,signal),
  createTarget:async(input:Record<string,unknown>)=>unwrap(await apiRequest('/reportes/metas',{method:'POST',body:JSON.stringify(input)})),
};
