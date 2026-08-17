import { apiRequest } from '../../services/api/client';
import type { FinanceAccount, FinanceCatalogs, FinanceMovement, FinanceSummary, MovementDraft, Paginated, Receipt, Receivable, ReconciliationData } from './finance.types';

const data = <T>(value: { success:boolean;data:T }|T):T => value && typeof value === 'object' && 'data' in value ? (value as {data:T}).data : value as T;
const params = (input:Record<string,string|number|undefined>) => { const result=new URLSearchParams(); Object.entries(input).forEach(([key,value])=>{if(value!==undefined&&value!=='')result.set(key,String(value));}); return result.toString(); };

export const financeService = {
  async summary(filters:Record<string,string>, signal?:AbortSignal){return data(await apiRequest<{success:boolean;data:FinanceSummary}>(`/finanzas/resumen?${params(filters)}`,{signal}));},
  async catalogs(signal?:AbortSignal){return data(await apiRequest<{success:boolean;data:FinanceCatalogs}>('/finanzas/catalogos',{signal}));},
  async movements(filters:Record<string,string|number|undefined>,signal?:AbortSignal){return data(await apiRequest<{success:boolean;data:Paginated<FinanceMovement>}>(`/finanzas/movimientos?${params(filters)}`,{signal}));},
  async receipts(filters:Record<string,string|number|undefined>,signal?:AbortSignal){return data(await apiRequest<{success:boolean;data:Paginated<Receipt>}>(`/finanzas/comprobantes?${params(filters)}`,{signal}));},
  async accounts(signal?:AbortSignal){return data(await apiRequest<{success:boolean;data:FinanceAccount[]}>('/finanzas/cuentas',{signal}));},
  async receivables(filters:Record<string,string|number|undefined>,signal?:AbortSignal){return data(await apiRequest<{success:boolean;data:Paginated<Receivable>}>(`/finanzas/cartera?${params(filters)}`,{signal}));},
  async reconciliation(filters:Record<string,string|undefined>,signal?:AbortSignal){return data(await apiRequest<{success:boolean;data:ReconciliationData}>(`/finanzas/conciliacion?${params(filters)}`,{signal}));},
  async createMovement(draft:MovementDraft){return data(await apiRequest('/finanzas/movimientos',{method:'POST',body:JSON.stringify(draft)}));},
  async generateReceipt(id:string,observaciones=''){return data(await apiRequest(`/finanzas/movimientos/${encodeURIComponent(id)}/comprobante`,{method:'POST',body:JSON.stringify({observaciones})}));},
  async applyMovement(id:string){return data(await apiRequest(`/finanzas/movimientos/${encodeURIComponent(id)}/aplicar`,{method:'POST',body:'{}'}));},
  async uploadReceipt(id:string,file:File){const form=new FormData();form.append('archivo',file);form.append('tipo','COMPROBANTE_PAGO');form.append('categoria','OTROS');form.append('movimiento_id',id);return apiRequest<{id:string;nombre_original:string;mime_type?:string;size_bytes?:number}>('/documentos',{method:'POST',body:form});},
  async receiptUrl(documentId:string){return apiRequest<{url:string}>(`/documentos/${encodeURIComponent(documentId)}/url`);},
  async downloadReceipt(documentId:string,name:string){const {url}=await this.receiptUrl(documentId);const response=await fetch(url);if(!response.ok)throw new Error('El comprobante no está disponible.');const objectUrl=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=objectUrl;link.download=name;link.click();window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);},
  async retireReceipt(movementId:string,documentId:string,motivo:string){return data(await apiRequest(`/finanzas/movimientos/${encodeURIComponent(movementId)}/comprobantes/${encodeURIComponent(documentId)}`,{method:'DELETE',body:JSON.stringify({motivo})}));},
  async createAccount(input:Record<string,unknown>){return data(await apiRequest('/finanzas/cuentas',{method:'POST',body:JSON.stringify(input)}));},
  async reconcile(movimiento_id:string,transaccion_bancaria_id:string,metodo='MANUAL'){return data(await apiRequest('/finanzas/conciliacion',{method:'POST',body:JSON.stringify({movimiento_id,transaccion_bancaria_id,metodo})}));},
};
