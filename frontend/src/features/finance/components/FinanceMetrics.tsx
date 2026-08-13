import { ArrowDownToLine, ArrowUpFromLine, BriefcaseBusiness, HandCoins, Landmark } from 'lucide-react';
import type { FinanceSummary } from '../finance.types';
import { money } from '../finance.utils';
import styles from '../Finance.module.css';

export function FinanceMetrics({kpis,onOpen}:{kpis:FinanceSummary['kpis'];onOpen:(view:'movimientos'|'cartera')=>void}){const items=[
{key:'income',label:'Ingresos recibidos',value:kpis.ingresos_recibidos,help:'Efectivo total aplicado del periodo',icon:ArrowDownToLine,tone:'blue',view:'movimientos' as const},
{key:'fees',label:'Honorarios cobrados',value:kpis.honorarios_cobrados,help:`${money(kpis.honorarios_generados)} generados`,icon:BriefcaseBusiness,tone:'gold',view:'cartera' as const},
{key:'third',label:'Recursos no propios',value:kpis.fondos_terceros+kpis.otros_destinos,help:`${money(kpis.fondos_terceros)} terceros · ${money(kpis.otros_destinos)} otros`,icon:Landmark,tone:'teal',view:'movimientos' as const},
{key:'due',label:'Por cobrar',value:kpis.honorarios_por_cobrar,help:'Honorarios aún pendientes',icon:HandCoins,tone:'orange',view:'cartera' as const},
{key:'expense',label:'Egresos',value:kpis.egresos,help:'Salidas aplicadas del periodo',icon:ArrowUpFromLine,tone:'red',view:'movimientos' as const},
];return <section className={styles.metrics} aria-label="Indicadores financieros">{items.map(({icon:Icon,...item})=><button type="button" key={item.key} className={styles.metric} data-tone={item.tone} onClick={()=>onOpen(item.view)}><span className={styles.metricIcon}><Icon size={19}/></span><span><small>{item.label}</small><strong>{money(item.value)}</strong><em>{item.help}</em></span></button>)}</section>}
