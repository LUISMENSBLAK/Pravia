import { ArrowRight, FileWarning, ReceiptText } from 'lucide-react';
import type { FinanceSummary } from '../finance.types';
import { money } from '../finance.utils';
import { CashFlowChart } from './CashFlowChart';
import { FinanceMetrics } from './FinanceMetrics';
import { IncomeAllocationChart } from './IncomeAllocationChart';
import styles from '../Finance.module.css';

export function FinanceSummaryView({summary,onOpen}:{summary:FinanceSummary;onOpen:(view:'movimientos'|'cartera'|'comprobantes'|'conciliacion')=>void}){return <><FinanceMetrics kpis={summary.kpis} onOpen={onOpen}/><div className={styles.summaryGrid}><CashFlowChart data={summary.cashFlow}/><IncomeAllocationChart allocation={summary.allocation}/></div><section className={styles.insightStrip}><div><span><ReceiptText size={18}/></span><p><strong>{money(summary.kpis.honorarios_generados)}</strong><small>Honorarios reconocidos a la fecha</small></p></div><div><span><FileWarning size={18}/></span><p><strong>{money(summary.kpis.fondos_terceros_pendientes)}</strong><small>Recursos pendientes de entregar</small></p></div><button type="button" onClick={()=>onOpen('cartera')}>Revisar cartera <ArrowRight size={15}/></button></section></>}
