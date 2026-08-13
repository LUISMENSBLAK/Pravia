import { calculateFinanceAggregates, type CanonicalMovement } from './financeCore';

export type ReportingPeriodKey = 'ESTE_MES'|'MES_ANTERIOR'|'TRIMESTRE'|'ESTE_TRIMESTRE'|'ANO'|'ESTE_ANO'|'PERSONALIZADO';
export type ReportingPeriod = { key: ReportingPeriodKey; from: Date; to: Date; label: string };

const endOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
export function resolveReportingPeriod(input: {periodo?:string;fecha_desde?:string;fecha_hasta?:string}, now=new Date()):ReportingPeriod {
  const key=(input.periodo||'ESTE_MES') as ReportingPeriodKey;
  let from=new Date(now.getFullYear(),now.getMonth(),1); let to=endOfDay(now);
  if(key==='MES_ANTERIOR'){from=new Date(now.getFullYear(),now.getMonth()-1,1);to=endOfDay(new Date(now.getFullYear(),now.getMonth(),0));}
  if(key==='TRIMESTRE'||key==='ESTE_TRIMESTRE')from=new Date(now.getFullYear(),now.getMonth()-2,1);
  if(key==='ANO'||key==='ESTE_ANO')from=new Date(now.getFullYear(),0,1);
  if(key==='PERSONALIZADO'){from=new Date(`${input.fecha_desde||''}T00:00:00`);to=new Date(`${input.fecha_hasta||''}T23:59:59.999`);}
  if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||from>to)throw new Error('Selecciona un periodo válido.');
  const fmt=new Intl.DateTimeFormat('es-MX',{day:'numeric',month:'short',year:'numeric'});
  return {key,from,to,label:`${fmt.format(from)} – ${fmt.format(to)}`};
}
export function mondayWeek(date=new Date()){const day=(date.getDay()+6)%7;const from=new Date(date.getFullYear(),date.getMonth(),date.getDate()-day);const to=endOfDay(new Date(from.getFullYear(),from.getMonth(),from.getDate()+6));return{from,to};}
export function reportFinancialTotals(generated:number[],movements:CanonicalMovement[]){return calculateFinanceAggregates({generatedFees:generated,movements});}
export function targetProgress(target:{amount:number;base:'GENERADOS'|'COBRADOS'}|null,totals:{honorarios_generados:number;honorarios_cobrados:number}){if(!target)return null;const actual=target.base==='GENERADOS'?totals.honorarios_generados:totals.honorarios_cobrados;return{meta:target.amount,base:target.base,actual,pendiente:Math.max(0,target.amount-actual),cumplimiento:target.amount?Math.round(actual/target.amount*1000)/10:0};}
