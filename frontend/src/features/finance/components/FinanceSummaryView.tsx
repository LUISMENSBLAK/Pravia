import { ArrowRight, BellRing, BriefcaseBusiness, Clock3, ReceiptText, Scale } from 'lucide-react';
import { Link } from 'react-router-dom';
import { FinancialBarChart } from '../../../components/analytics/FinancialBarChart';
import type { FinanceSummary } from '../finance.types';
import { financeDate, money } from '../finance.utils';
import { FinanceMetrics } from './FinanceMetrics';
import styles from '../Finance.module.css';

function RankedBars({ title, rows, onOpen }: { title: string; rows: Array<{label:string;generated:number;collected:number}>; onOpen:()=>void }) {
  const max = Math.max(...rows.flatMap((row) => [row.generated, row.collected]), 1);
  return <section className={styles.analysisCard}><header><div><h2>{title}</h2><p>Importes reconocidos y cobrados del ledger canónico.</p></div><button type="button" onClick={onOpen}>Ver detalle <ArrowRight size={14}/></button></header>{rows.length ? <div className={styles.rankedBars}>{rows.slice(0, 7).map((row) => <button type="button" key={row.label} onClick={onOpen}><span>{row.label}</span><div><i data-series="generated" style={{width:`${Math.max(1,row.generated/max*100)}%`}}/><i data-series="collected" style={{width:`${Math.max(1,row.collected/max*100)}%`}}/></div><small>{money(row.generated)} / {money(row.collected)}</small></button>)}</div> : <div className={styles.compactEmpty}>NO HAY MOVIMIENTOS PARA ESTE PERIODO</div>}</section>;
}

export function FinanceSummaryView({summary,onOpen}:{summary:FinanceSummary;onOpen:(view:'movimientos'|'cartera'|'proyeccion')=>void}) {
  const series = summary.series || summary.cashFlow.map((row) => ({ period: row.periodo, generated: row.honorarios, collected: row.ingresos, difference: row.honorarios - row.ingresos }));
  const byLawyer = summary.byLawyer || [];
  const byAct = summary.byAct || [];
  const collectionStatus = summary.collectionStatus || { collected: summary.kpis.honorarios_cobrados, outstanding: summary.kpis.honorarios_por_cobrar, overdue: 0 };
  const projection = summary.projection || { months: [], noDate: { fees: 0, otherIncome: 0, expenses: 0 } };
  const collectionAlerts = summary.collectionAlerts || [];
  const recentMovements = summary.recentMovements || [];
  const statusTotal = collectionStatus.collected + collectionStatus.outstanding;
  return <>
    <FinanceMetrics kpis={summary.kpis} onOpen={onOpen}/>
    <section className={styles.chartCard}><header><div><h2>Generado vs. cobrado</h2><p>{summary.period.label} · fuente financiera canónica</p></div><div className={styles.chartLegend}><span data-tone="gold"/>Generado<span data-tone="blue"/>Cobrado</div></header><FinancialBarChart data={series} onSelect={() => onOpen('movimientos')}/></section>
    <div className={styles.analysisGrid}>
      <RankedBars title="Honorarios por abogado" rows={byLawyer} onOpen={()=>onOpen('cartera')}/>
      <RankedBars title="Ingresos por tipo de acto" rows={byAct} onOpen={()=>onOpen('cartera')}/>
      <section className={styles.analysisCard}><header><div><h2>Estado de cobranza</h2><p>Cobrado, por cobrar y vencido con fechas reales.</p></div></header>{statusTotal ? <div className={styles.collectionState}><div className={styles.stackBar}><i data-state="collected" style={{width:`${collectionStatus.collected/statusTotal*100}%`}}/><i data-state="outstanding" style={{width:`${collectionStatus.outstanding/statusTotal*100}%`}}/></div><dl><div><dt><i data-state="collected"/>Cobrado</dt><dd>{money(collectionStatus.collected)}</dd></div><div><dt><i data-state="outstanding"/>Por cobrar</dt><dd>{money(collectionStatus.outstanding)}</dd></div><div><dt><i data-state="overdue"/>Vencido</dt><dd>{money(collectionStatus.overdue)}</dd></div></dl></div> : <div className={styles.compactEmpty}>NO HAY MOVIMIENTOS PARA ESTE PERIODO</div>}</section>
    </div>
    {collectionAlerts.length > 0 && <section className={styles.collectionAlerts}><header><span><BellRing size={18}/></span><div><h2>Cobranza próxima a firma</h2><p>Saldo real del presupuesto vigente · sólo en Finanzas → Resumen</p></div></header>{collectionAlerts.map((alert) => <Link key={alert.id} to={`/expedientes/${alert.expediente_id}?tab=finanzas`}><strong>{alert.folio}</strong><span>{alert.client||'Cliente'} · firma {financeDate(alert.signature_date)}</span><b>{alert.business_days === 0 ? 'Hoy' : `${alert.business_days} días hábiles`} · {money(alert.outstanding)}</b></Link>)}</section>}
    <section className={styles.recentMovements}><header><div><h2>Movimientos recientes</h2><p>Operaciones financieras reales del periodo.</p></div><button type="button" onClick={()=>onOpen('movimientos')}>Todos <ArrowRight size={14}/></button></header>{recentMovements.length ? recentMovements.map((item) => <Link key={item.id} to={item.href}><span data-kind={item.nature}>{item.nature==='INGRESO'?<ReceiptText size={15}/>:<Scale size={15}/>}</span><p><strong>{item.concept}</strong><small>{financeDate(item.date)} · {item.origin==='EXPEDIENTE'?item.expediente?.numero_pravia:'Externo'}</small></p><b>{item.nature==='EGRESO'?'−':'+'}{money(item.amount)}</b></Link>) : <div className={styles.compactEmpty}>NO HAY MOVIMIENTOS PARA ESTE PERIODO</div>}</section>
    <section className={styles.insightStrip}><div><span><BriefcaseBusiness size={18}/></span><p><strong>{money(summary.kpis.honorarios_generados)}</strong><small>Honorarios reconocidos a la fecha</small></p></div><div><span><Clock3 size={18}/></span><p><strong>{money(projection.noDate.fees)}</strong><small>Honorarios proyectados sin fecha de firma</small></p></div><button type="button" onClick={()=>onOpen('proyeccion')}>Abrir proyección <ArrowRight size={15}/></button></section>
  </>;
}
