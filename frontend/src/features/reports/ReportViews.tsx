import {
  ArrowRight,
  CalendarCheck2,
  CircleDollarSign,
  FileCheck2,
  LayoutGrid,
  List,
  Plus,
  Scale,
  Target,
  TrendingUp,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { settingsService } from '../settings/settings.service';
import styles from './Reports.module.css';
import type {
  CollectionsReport,
  ComparisonRow,
  EightyTwentyReport,
  FinanceReport,
  GoalProgress,
  LawyerRow,
  LawyersReport,
  PotentialClientsReport,
  SignaturesReport,
  SummaryReport,
} from './reporting.types';

const money = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const number = new Intl.NumberFormat('es-MX');
const date = (value?: string | null) => value ? new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : 'Por definir';
const pct = (value: number | null | undefined) => value === null || value === undefined ? 'Sin meta' : `${value.toFixed(1)}%`;
const statusLabel = (value: string) => value.toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
const moneyOrRestricted = (value: number | null | undefined) => value === null || value === undefined ? 'Sin acceso' : money.format(value);

type MetricProps = {
  label: string;
  value: string;
  helper?: string;
  icon?: React.ReactNode;
  tone?: string;
  definition?: string;
  onClick?: () => void;
};

export function Metric({ label, value, helper, icon, tone = 'gold', definition, onClick }: MetricProps) {
  const body = <>
    <span className={styles.metricTop}><span className={styles.metricIcon} data-tone={tone}>{icon}</span>{definition && <span className={styles.info} title={definition} aria-label={`Definición de ${label}`}>i</span>}</span>
    <strong>{value}</strong><span className={styles.metricLabel}>{label}</span>{helper && <small>{helper}</small>}
  </>;
  return onClick
    ? <button type="button" className={`${styles.metric} ${styles.metricButton}`} onClick={onClick}>{body}</button>
    : <article className={styles.metric}>{body}</article>;
}

export function Restricted() {
  return <section className={styles.restricted}><Scale /><h2>Vista financiera restringida</h2><p>Puedes consultar indicadores operativos, pero tu rol no tiene acceso a importes financieros.</p></section>;
}

export function Empty({ title = 'Sin datos para este periodo', detail = 'Ajusta los filtros o selecciona otro periodo para consultar información.' }: { title?: string; detail?: string }) {
  return <section className={styles.empty}><FileCheck2 /><h3>{title}</h3><p>{detail}</p></section>;
}

function TrendChart({ data = [] }: { data?: Array<{ periodo: string; generados: number; cobrados: number }> }) {
  if (!data.length) return <Empty />;
  const max = Math.max(1, ...data.flatMap((item) => [item.generados, item.cobrados]));
  const points = (key: 'generados' | 'cobrados') => data.map((item, index) => `${22 + index * (420 / Math.max(1, data.length - 1))},${142 - (item[key] / max) * 112}`).join(' ');
  return <div className={styles.chart}>
    <svg viewBox="0 0 470 175" preserveAspectRatio="none" role="img" aria-label="Tendencia mensual de honorarios generados y cobrados">
      <title>Tendencia de honorarios generados y cobrados</title>
      {[30, 67, 104, 142].map((y) => <line key={y} x1="20" y1={y} x2="450" y2={y} className={styles.gridLine} />)}
      <polyline points={points('generados')} className={styles.generatedLine} />
      <polyline points={points('cobrados')} className={styles.collectedLine} />
      {data.map((item, index) => <g key={item.periodo}>
        <circle cx={22 + index * (420 / Math.max(1, data.length - 1))} cy={142 - (item.generados / max) * 112} r="4" className={styles.generatedPoint}><title>{`${item.periodo}: ${money.format(item.generados)} generados`}</title></circle>
        <circle cx={22 + index * (420 / Math.max(1, data.length - 1))} cy={142 - (item.cobrados / max) * 112} r="4" className={styles.collectedPoint}><title>{`${item.periodo}: ${money.format(item.cobrados)} cobrados`}</title></circle>
        <text x={22 + index * (420 / Math.max(1, data.length - 1))} y="166" textAnchor="middle">{item.periodo.slice(5)}</text>
      </g>)}
    </svg>
    <div className={styles.legend}><span><i data-series="generated" />Generados</span><span><i data-series="collected" />Cobrados</span></div>
    <table className={styles.srOnly}><caption>Datos de tendencia financiera</caption><thead><tr><th>Periodo</th><th>Generados</th><th>Cobrados</th></tr></thead><tbody>{data.map((item) => <tr key={item.periodo}><td>{item.periodo}</td><td>{money.format(item.generados)}</td><td>{money.format(item.cobrados)}</td></tr>)}</tbody></table>
  </div>;
}

function ComparisonChart({ rows = [], title, limit = 5 }: { rows?: ComparisonRow[]; title: string; limit?: number }) {
  const visible = rows.slice(0, limit);
  if (!visible.length) return <Empty />;
  const max = Math.max(1, ...visible.map((item) => item.generated));
  return <div className={styles.comparisonChart}>
    <div className={styles.comparisonPlot} role="img" aria-label={title}>
      {visible.map((item) => <div className={styles.comparisonRow} key={item.id}>
        <div><strong>{item.nombre}</strong><span>{item.expedientes} expediente{item.expedientes === 1 ? '' : 's'}</span></div>
        <div className={styles.comparisonBars}>
          <span style={{ width: `${Math.max(2, (item.generated / max) * 100)}%` }} data-series="generated"><i>{money.format(item.generated)}</i></span>
          <span style={{ width: `${Math.max(item.collected ? 2 : 0, (item.collected / max) * 100)}%` }} data-series="collected"><i>{money.format(item.collected)}</i></span>
        </div>
      </div>)}
      <div className={styles.legend}><span><i data-series="generated" />Generado</span><span><i data-series="collected" />Cobrado</span></div>
    </div>
    <table className={styles.srOnly}><caption>{title}</caption><thead><tr><th>Nombre</th><th>Expedientes</th><th>Generado</th><th>Cobrado</th><th>Pendiente</th></tr></thead><tbody>{visible.map((item) => <tr key={item.id}><td>{item.nombre}</td><td>{item.expedientes}</td><td>{money.format(item.generated)}</td><td>{money.format(item.collected)}</td><td>{money.format(item.pending)}</td></tr>)}</tbody></table>
  </div>;
}

function GoalPanel({ goal }: { goal?: GoalProgress | null }) {
  if (!goal || goal.cumplimiento === null) return <Empty title="Sin meta configurada" detail="La operación se muestra sin inventar un porcentaje de cumplimiento." />;
  return <div className={styles.goal}>
    <div className={styles.goalCircle} style={{ '--progress': `${Math.min(goal.cumplimiento, 100) * 3.6}deg` } as React.CSSProperties}><span><strong>{pct(goal.cumplimiento)}</strong><small>{goal.base === 'COBRADOS' ? 'Cobrados' : 'Generados'}</small></span></div>
    <div><strong>{money.format(goal.actual)}</strong><p>de {money.format(goal.meta)}</p><small>Faltan {money.format(goal.pendiente)} para la meta.</small></div>
  </div>;
}

export function SummaryView({ summary, finance, collections, signatures, eightyTwenty, potential, errors, onOpen }: { summary: SummaryReport; finance?: FinanceReport; collections?: CollectionsReport; signatures?: SignaturesReport; eightyTwenty?: EightyTwentyReport; potential?: PotentialClientsReport; errors: Set<string>; onOpen: (view: string) => void }) {
  const financial = summary.financial;
  const signatureMetrics = signatures?.metrics;
  return <div className={styles.reportStack}>
    {errors.size > 0 && <div className={styles.partialError} role="status">Algunos indicadores no pudieron actualizarse. El resto del reporte sigue disponible.</div>}
    <section className={styles.metrics} aria-label="Indicadores principales">
      {financial && <>
        <Metric label="Honorarios generados" value={money.format(financial.honorarios_generados)} helper="Reconocidos en el periodo" icon={<WalletCards />} definition="Honorarios reconocidos en el periodo mediante el registro financiero canónico." onClick={() => onOpen('finanzas')} />
        <Metric label="Honorarios cobrados" value={money.format(financial.honorarios_cobrados)} helper="Aplicados a honorarios" icon={<CircleDollarSign />} tone="green" definition="Distribuciones aplicadas y vinculadas a los honorarios reconocidos; no incluye fondos de terceros." onClick={() => onOpen('finanzas')} />
        <Metric label="Por cobrar" value={money.format(financial.honorarios_por_cobrar)} helper="Generados menos cobrados" icon={<Scale />} tone="blue" onClick={() => onOpen('cobranza')} />
      </>}
      <Metric label="Firmas realizadas" value={number.format(summary.operations.firmas_realizadas)} helper="Confirmadas en el periodo" icon={<CalendarCheck2 />} tone="purple" onClick={() => onOpen('firmas')} />
    </section>
    <div className={styles.summaryGrid}>
      <section className={`${styles.panel} ${styles.panelWide}`}><PanelHeader eyebrow="Evolución" title="Generado vs. cobrado" action="Ver finanzas" onAction={() => onOpen('finanzas')} />{errors.has('finance') ? <WidgetError /> : <TrendChart data={finance?.tendency} />}</section>
      <section className={styles.panel}><PanelHeader eyebrow="Objetivo" title="Meta de honorarios" /><GoalPanel goal={summary.goal} /></section>
      <section className={styles.panel}><PanelHeader eyebrow="Ranking" title="Desempeño por abogado" action="Ver abogados" onAction={() => onOpen('abogados')} />{errors.has('finance') ? <WidgetError /> : <ComparisonChart rows={finance?.byLawyer} title="Top cinco abogados por honorarios generados y cobrados" />}</section>
      <section className={styles.panel}><PanelHeader eyebrow="Ranking" title="Desempeño por notaría" action="Ver finanzas" onAction={() => onOpen('finanzas')} />{errors.has('finance') ? <WidgetError /> : <ComparisonChart rows={finance?.byNotaria} title="Top cinco notarías por honorarios generados y cobrados" />}</section>
      <section className={styles.panel}><PanelHeader eyebrow="Operación" title="Firmas y cotizaciones" action="Ver firmas" onAction={() => onOpen('firmas')} /><div className={styles.miniStats}>
        <div><strong>{summary.operations.firmas_restantes_semana}</strong><span>Firmas programadas esta semana</span><small>{moneyOrRestricted(summary.operations.honorarios_programados_semana)} vinculados</small></div>
        <div><strong>{summary.operations.presupuestos_aceptados}/{summary.operations.presupuestos_solicitados}</strong><span className={styles.definedLabel}>Cotizaciones aceptadas <i className={styles.info} tabIndex={0} role="note" title={summary.definitions.clientes} aria-label={`Definición de clientes generados: ${summary.definitions.clientes}`}>i</i></span><small>{moneyOrRestricted(summary.operations.importe_cotizado)} cotizados</small></div>
        <div><strong>{signatureMetrics?.realizadas_semana_anterior || 0}</strong><span>Realizadas la semana anterior</span><small>Confirmación explícita</small></div>
      </div></section>
      <section className={styles.panel}><PanelHeader eyebrow="Cobranza" title="Cartera pendiente" action="Ver cobranza" onAction={() => onOpen('cobranza')} />{errors.has('collections') ? <WidgetError /> : collections?.restricted ? <Restricted /> : <div className={styles.collectionHighlight}>
        <div><small>Pendiente</small><strong>{money.format(collections?.totals?.pending || 0)}</strong></div>
        <div><small>Vencido con fecha válida</small><strong className={styles.danger}>{money.format(collections?.totals?.overdue || 0)}</strong></div>
        <div className={styles.progress}><span style={{ width: `${collections?.totals?.generated ? Math.min(100, ((collections.totals.collected || 0) / collections.totals.generated) * 100) : 0}%` }} /><small>{collections?.totals?.generated ? pct(((collections.totals.collected || 0) / collections.totals.generated) * 100) : '0%'} cobrado</small></div>
      </div>}</section>
      <section className={styles.panel}><PanelHeader eyebrow="Relevancia económica" title="Principales expedientes" action="Ver 80/20" onAction={() => onOpen('80-20')} />{errors.has('eightyTwenty') ? <WidgetError /> : <CompactRanking rows={(eightyTwenty?.rows || []).slice(0, 5).map((item) => ({ id: item.id, label: item.expediente, detail: item.cliente, value: item.importe_computable, link: item.link }))} empty="Sin importes computables en el periodo" />}</section>
      <section className={styles.panel}><PanelHeader eyebrow="Oportunidad comercial" title="Clientes potenciales" action="Ver oportunidades" onAction={() => onOpen('clientes-potenciales')} />{errors.has('potential') ? <WidgetError /> : <CompactRanking rows={(potential?.rows || []).slice(0, 5).map((item) => ({ id: item.id, label: item.cliente, detail: item.acto, value: item.honorarios, link: item.link }))} empty="Sin oportunidades activas en el periodo" />}</section>
    </div>
  </div>;
}

function CompactRanking({ rows, empty }: { rows: Array<{ id: string; label: string; detail: string; value: number; link: string }>; empty: string }) {
  if (!rows.length) return <Empty title={empty} detail="No se muestran registros ficticios." />;
  return <ol className={styles.compactRanking}>{rows.map((item, index) => <li key={item.id}><span>{index + 1}</span><div><Link to={item.link}>{item.label}</Link><small>{item.detail}</small></div><strong>{money.format(item.value)}</strong></li>)}</ol>;
}

function PanelHeader({ eyebrow, title, action, onAction }: { eyebrow: string; title: string; action?: string; onAction?: () => void }) {
  return <header><div><span className={styles.eyebrow}>{eyebrow}</span><h2>{title}</h2></div>{action && onAction && <button type="button" onClick={onAction}>{action}<ArrowRight /></button>}</header>;
}

function WidgetError() {
  return <div className={styles.widgetError}>No fue posible actualizar este bloque.</div>;
}

export function FinanceView({ data }: { data: FinanceReport }) {
  if (data.restricted || !data.financial) return <Restricted />;
  const financial = data.financial;
  return <div className={styles.reportStack}>
    <section className={styles.metrics}>
      <Metric label="Honorarios generados" value={money.format(financial.honorarios_generados)} helper="Reconocidos" icon={<WalletCards />} />
      <Metric label="Honorarios cobrados" value={money.format(financial.honorarios_cobrados)} helper="Aplicados a honorarios" icon={<CircleDollarSign />} tone="green" />
      <Metric label="Por cobrar" value={money.format(financial.honorarios_por_cobrar)} helper="Generados menos cobrados" icon={<Scale />} tone="blue" />
      <Metric label="Ingresos totales" value={money.format(financial.ingresos_recibidos)} helper="Ledger aplicado del periodo" icon={<TrendingUp />} tone="purple" definition="Incluye todos los ingresos aplicados: honorarios, fondos de terceros y otros destinos." />
    </section>
    <div className={styles.twoCols}>
      <section className={`${styles.panel} ${styles.panelWide}`}><PanelHeader eyebrow="Últimos seis meses" title="Evolución financiera" /><TrendChart data={data.tendency} /></section>
      <section className={styles.panel}><PanelHeader eyebrow="Objetivo" title="Progreso de meta" /><GoalPanel goal={data.goal} /></section>
      <section className={styles.panel}><PanelHeader eyebrow="Comparativo" title="Honorarios por abogado" /><ComparisonChart rows={data.byLawyer} title="Comparación de honorarios generados y cobrados por abogado" limit={8} /><GroupTable rows={data.byLawyer || []} label="Abogado" showGoal /></section>
      <section className={styles.panel}><PanelHeader eyebrow="Comparativo" title="Honorarios por notaría" /><ComparisonChart rows={data.byNotaria} title="Comparación de honorarios generados y cobrados por notaría" limit={8} /></section>
      <section className={`${styles.panel} ${styles.panelWide}`}><PanelHeader eyebrow="Destino contable" title="Composición de ingresos aplicados" /><div className={styles.distribution}>
        <Distribution label="Honorarios del despacho" value={financial.honorarios_cobrados} total={financial.ingresos_recibidos} />
        <Distribution label="Fondos de terceros" value={financial.fondos_terceros} total={financial.ingresos_recibidos} />
        <Distribution label="Otros destinos" value={financial.otros_destinos} total={financial.ingresos_recibidos} />
      </div></section>
    </div>
  </div>;
}

function Distribution({ label, value, total }: { label: string; value: number; total: number }) {
  const valuePct = total ? (value / total) * 100 : 0;
  return <div><span><b>{label}</b><strong>{money.format(value)}</strong></span><i><em style={{ width: `${Math.min(100, valuePct)}%` }} /></i><small>{pct(valuePct)} del total aplicado</small></div>;
}

export function CollectionsView({ data }: { data: CollectionsReport }) {
  if (data.restricted || !data.totals) return <Restricted />;
  return <div className={styles.reportStack}>
    <section className={styles.metrics}>
      <Metric label="Honorarios reconocidos" value={money.format(data.totals.generated)} icon={<WalletCards />} />
      <Metric label="Cobrado y aplicado" value={money.format(data.totals.collected)} icon={<CircleDollarSign />} tone="green" />
      <Metric label="Pendiente" value={money.format(data.totals.pending)} icon={<Scale />} tone="blue" />
      <Metric label="Vencido" value={money.format(data.totals.overdue)} helper="Sólo con vencimiento válido" icon={<FileCheck2 />} tone="red" />
    </section>
    <div className={styles.collectionGroups}>
      <section className={styles.panel}><PanelHeader eyebrow="Evolución" title="Cobrado vs. reconocido" /><TrendChart data={data.tendency} /></section>
      <section className={styles.panel}><PanelHeader eyebrow="Vencimiento verificable" title="Composición del pendiente" /><DueBreakdown data={data.dueBreakdown} /></section>
    </div>
    <div className={styles.collectionGroups}>
      <section className={styles.panel}><PanelHeader eyebrow="Responsables" title="Cobranza por abogado" />{data.byLawyer?.length ? <><ComparisonChart rows={data.byLawyer} title="Cobranza por abogado" limit={6} /><GroupTable rows={data.byLawyer} label="Abogado" /></> : <Empty />}</section>
      <section className={styles.panel}><PanelHeader eyebrow="Procedencia" title="Cobranza por notaría" />{data.byNotaria?.length ? <><ComparisonChart rows={data.byNotaria} title="Cobranza por notaría" limit={6} /><GroupTable rows={data.byNotaria} label="Notaría" /></> : <Empty />}</section>
    </div>
    <section className={styles.panel}><PanelHeader eyebrow="Detalle trazable" title="Honorarios pendientes" />{data.rows?.length ? <div className={styles.tableWrap}><table><thead><tr><th>Expediente</th><th>Cliente</th><th>Responsable</th><th>Notaría</th><th>Vencimiento</th><th>Estado</th><th className={styles.numeric}>Pendiente</th></tr></thead><tbody>{data.rows.map((item) => <tr key={item.id}><td data-label="Expediente"><Link to={item.link}>{item.expediente}</Link></td><td data-label="Cliente">{item.cliente}</td><td data-label="Responsable">{item.abogado}</td><td data-label="Notaría">{item.notaria}</td><td data-label="Vencimiento">{date(item.due)}</td><td data-label="Estado"><span className={item.overdue ? styles.risk : styles.status}>{item.overdue ? 'Vencido' : item.due ? 'Vigente' : 'Sin vencimiento'}</span></td><td data-label="Pendiente" className={styles.numeric}>{money.format(item.pending)}</td></tr>)}</tbody></table></div> : <Empty title="Sin honorarios pendientes" detail="No hay cartera pendiente dentro del periodo y alcance seleccionados." />}</section>
  </div>;
}

function DueBreakdown({ data }: { data?: CollectionsReport['dueBreakdown'] }) {
  if (!data || data.overdue + data.notOverdue + data.withoutDue === 0) return <Empty />;
  const total = data.overdue + data.notOverdue + data.withoutDue;
  const rows = [{ label: 'Vencido', value: data.overdue, tone: 'red' }, { label: 'No vencido', value: data.notOverdue, tone: 'green' }, { label: 'Sin vencimiento', value: data.withoutDue, tone: 'gray' }];
  return <div className={styles.dueBreakdown}><div role="img" aria-label="Pendiente vencido, no vencido y sin fecha de vencimiento">{rows.map((item) => item.value > 0 && <span key={item.label} data-tone={item.tone} style={{ width: `${(item.value / total) * 100}%` }} title={`${item.label}: ${money.format(item.value)}`} />)}</div><ul>{rows.map((item) => <li key={item.label}><i data-tone={item.tone} /><span>{item.label}</span><strong>{money.format(item.value)}</strong></li>)}</ul></div>;
}

function GroupTable({ rows, label, showGoal = false }: { rows: ComparisonRow[]; label: 'Abogado' | 'Notaría'; showGoal?: boolean }) {
  return <div className={`${styles.tableWrap} ${styles.compactTable}`}><table><thead><tr><th>{label}</th><th>Expedientes</th><th className={styles.numeric}>Generado</th><th className={styles.numeric}>Cobrado</th><th className={styles.numeric}>Pendiente</th><th>Avance</th>{showGoal && <th>Meta</th>}</tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td data-label={label}><strong>{item.nombre}</strong></td><td data-label="Expedientes">{item.expedientes}</td><td data-label="Generado" className={styles.numeric}>{money.format(item.generated)}</td><td data-label="Cobrado" className={styles.numeric}>{money.format(item.collected)}</td><td data-label="Pendiente" className={styles.numeric}>{money.format(item.pending)}</td><td data-label="Avance"><span className={item.porcentaje_cobrado === null ? styles.neutralStatus : styles.status}>{item.porcentaje_cobrado === null ? '—' : pct(item.porcentaje_cobrado)}</span></td>{showGoal && <td data-label="Meta">{item.goal?.cumplimiento === null || !item.goal ? <span className={styles.neutralStatus}>Sin meta</span> : <span className={styles.status}>{pct(item.goal.cumplimiento)} · faltan {money.format(item.goal.pendiente)}</span>}</td>}</tr>)}</tbody></table></div>;
}

export function LawyersView({ data, canManageTargets, onConfigureTarget }: { data: LawyersReport; canManageTargets: boolean; onConfigureTarget: () => void }) {
  const [view, setView] = useState<'list' | 'cards'>('list');
  useEffect(() => {
    let active = true;
    settingsService.preferences().then((payload) => {
      if (active) setView(payload.preferences.default_view === 'CARDS' ? 'cards' : 'list');
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const changeView = (next: 'list' | 'cards') => {
    setView(next);
    void settingsService.updatePreferences({ default_view: next === 'cards' ? 'CARDS' : 'LIST' }).catch(() => undefined);
  };
  return <div className={styles.reportStack}>
    <section className={styles.viewToolbar} aria-label="Controles de desempeño por abogado">
      <div><span className={styles.eyebrow}>Desempeño</span><h2>Operación por abogado</h2><p>Expedientes, honorarios, firmas y metas dentro del alcance permitido.</p></div>
      <div className={styles.toolbarActions}>
        <div className={styles.viewSwitch} role="group" aria-label="Vista de abogados"><button type="button" aria-pressed={view === 'list'} onClick={() => changeView('list')}><List />Lista</button><button type="button" aria-pressed={view === 'cards'} onClick={() => changeView('cards')}><LayoutGrid />Tarjetas</button></div>
        {canManageTargets && <button type="button" className={styles.targetButton} onClick={onConfigureTarget}><Plus />Configurar meta</button>}
      </div>
    </section>
    {!data.rows.length ? <Empty /> : view === 'list' ? <LawyerList rows={data.rows} /> : <LawyerCards rows={data.rows} />}
  </div>;
}

function LawyerList({ rows }: { rows: LawyerRow[] }) {
  return <section className={styles.panel}><div className={styles.tableWrap}><table><thead><tr><th>Abogado</th><th>Expedientes</th><th className={styles.numeric}>Generados del periodo</th><th className={styles.numeric}>Honorarios semana</th><th className={styles.numeric}>Honorarios mes</th><th>Firmas semana</th><th>Firmas mes</th><th>Próximo mes</th><th>Realizadas sem. anterior</th><th>Meta</th></tr></thead><tbody>{rows.map((item) => {
    const remainingPercent = item.goal?.cumplimiento === null || !item.goal ? null : Math.max(0, 100 - item.goal.cumplimiento);
    return <tr key={item.id}><td data-label="Abogado"><strong>{item.nombre}</strong></td><td data-label="Expedientes">{item.expedientes_periodo}</td><td data-label="Generados del periodo" className={styles.numeric}>{moneyOrRestricted(item.honorarios_generados)}</td><td data-label="Honorarios semana" className={styles.numeric}>{moneyOrRestricted(item.honorarios_semana)}</td><td data-label="Honorarios mes" className={styles.numeric}>{moneyOrRestricted(item.honorarios_mes)}</td><td data-label="Firmas semana">{item.firmas_semana}</td><td data-label="Firmas mes">{item.firmas_mes}</td><td data-label="Próximo mes">{item.firmas_proximo_mes}</td><td data-label="Realizadas sem. anterior">{item.firmas_realizadas_semana_anterior}</td><td data-label="Meta">{remainingPercent === null || !item.goal ? <span className={styles.neutralStatus}>Sin meta configurada</span> : <span className={styles.goalDetail}><strong>{pct(item.goal.cumplimiento)} alcanzado</strong><small>Falta {pct(remainingPercent)}</small><small>Faltan {money.format(item.goal.pendiente)}</small></span>}</td></tr>;
  })}</tbody></table></div></section>;
}

function LawyerCards({ rows }: { rows: LawyerRow[] }) {
  return <section className={styles.lawyerCards} aria-label="Tarjetas de desempeño por abogado">{rows.map((item) => {
    const remainingPercent = item.goal?.cumplimiento === null || !item.goal ? null : Math.max(0, 100 - item.goal.cumplimiento);
    return <article className={styles.lawyerCard} key={item.id}>
    <header><div className={styles.avatar}>{item.nombre.split(' ').map((part) => part[0]).slice(0, 2).join('')}</div><div><h3>{item.nombre}</h3><p>{item.expedientes_periodo} expedientes en el periodo</p></div></header>
    <div className={styles.lawyerMoney}><span><small>Generados del periodo</small><strong>{moneyOrRestricted(item.honorarios_generados)}</strong></span><span><small>Honorarios esta semana</small><strong>{moneyOrRestricted(item.honorarios_semana)}</strong></span><span><small>Honorarios este mes</small><strong>{moneyOrRestricted(item.honorarios_mes)}</strong></span></div>
    <dl><div><dt>Firmas esta semana</dt><dd>{item.firmas_semana}</dd></div><div><dt>Firmas este mes</dt><dd>{item.firmas_mes}</dd></div><div><dt>Firmas próximo mes</dt><dd>{item.firmas_proximo_mes}</dd></div><div><dt>Realizadas sem. anterior</dt><dd>{item.firmas_realizadas_semana_anterior}</dd></div></dl>
    <div className={styles.cardGoal}>{remainingPercent === null || !item.goal ? <><Target /><span>Sin meta configurada</span></> : <><span><b style={{ width: `${Math.min(100, item.goal.cumplimiento ?? 0)}%` }} /></span><div><strong>{pct(item.goal.cumplimiento)} alcanzado</strong><small>Falta {pct(remainingPercent)}</small><small>Faltan {money.format(item.goal.pendiente)}</small></div></>}</div>
  </article>})}</section>;
}

export function SignaturesView({ data }: { data: SignaturesReport }) {
  const metrics = data.metrics;
  const definitions = data.definitions || {
    realizada: 'Una firma realizada requiere fecha real confirmada.',
    programada: 'Una firma programada requiere fecha estimada y no cuenta como realizada.',
  };
  return <div className={styles.reportStack}>
    <section className={styles.metrics}>
      <Metric label="Realizadas en el periodo" value={number.format(metrics.realizadas_periodo || 0)} helper="Fecha real confirmada" icon={<CalendarCheck2 />} />
      <Metric label="Programadas esta semana" value={number.format(metrics.programadas_semana || 0)} helper="Futuras sin firma real" icon={<FileCheck2 />} tone="green" />
      <Metric label="Programadas este mes" value={number.format(metrics.programadas_mes || 0)} icon={<Scale />} tone="blue" />
      <Metric label="Atrasadas sin confirmar" value={number.format(metrics.atrasadas_sin_confirmar || 0)} helper="No cuentan como realizadas" icon={<CalendarCheck2 />} tone="red" />
    </section>
    <div className={styles.signatureCompare} role="img" aria-label="Comparación de firmas programadas y realizadas">
      <div><span>Semana anterior realizadas</span><strong>{number.format(metrics.realizadas_semana_anterior || 0)}</strong></div>
      <div><span>Esta semana programadas</span><strong>{number.format(metrics.programadas_semana || 0)}</strong></div>
      <div><span>Próximo mes programadas</span><strong>{number.format(metrics.programadas_proximo_mes || 0)}</strong></div>
      <div><span>Honorarios realizados</span><strong>{moneyOrRestricted(metrics.honorarios_realizados_periodo)}</strong></div>
    </div>
    <div className={styles.definition}><strong>Definición operativa</strong><span>{definitions.realizada} {definitions.programada}</span></div>
    <section className={styles.panel}><PanelHeader eyebrow="Calendario operativo" title="Programadas vs. realizadas" />{data.rows.length ? <div className={styles.tableWrap}><table><thead><tr><th>Expediente</th><th>Cliente</th><th>Abogado</th><th>Firma estimada</th><th>Firma real</th><th>Estado</th><th className={styles.numeric}>Honorarios</th></tr></thead><tbody>{data.rows.map((item) => <tr key={item.id}><td data-label="Expediente"><Link to={item.link}>{item.numero_pravia}</Link></td><td data-label="Cliente">{item.cliente_alias || 'Sin cliente'}</td><td data-label="Abogado">{item.abogado}</td><td data-label="Firma estimada">{date(item.fecha_estimada_firma)}</td><td data-label="Firma real">{date(item.fecha_real_firma)}</td><td data-label="Estado"><span className={item.estado === 'ATRASADA_SIN_CONFIRMAR' ? styles.risk : item.estado === 'REALIZADA' ? styles.status : styles.blueStatus}>{statusLabel(item.estado)}</span></td><td data-label="Honorarios" className={styles.numeric}>{moneyOrRestricted(item.honorarios)}</td></tr>)}</tbody></table></div> : <Empty />}</section>
  </div>;
}

export function EightyTwentyView({ data }: { data: EightyTwentyReport }) {
  if (data.restricted) return <Restricted />;
  const rows = data.rows || [];
  const totals = rows.reduce((accumulator, item) => ({
    fees: accumulator.fees + (item.honorarios || 0),
    computable: accumulator.computable + item.importe_computable,
    collected: accumulator.collected + (item.cobrado_honorarios_acumulado || 0),
    pending: accumulator.pending + (item.pending || 0),
  }), { fees: 0, computable: 0, collected: 0, pending: 0 });
  return <div className={styles.reportStack}>
    <div className={styles.definition}><strong>Concentración económica</strong><span>{data.definition}</span>{data.source && <small>{data.source}</small>}</div>
    <section className={styles.metrics}>
      <Metric label="Importe computable 80/20" value={money.format(totals.computable)} helper="Aplicado al despacho en el periodo" icon={<CircleDollarSign />} tone="green" />
      <Metric label="Honorarios vinculados" value={money.format(totals.fees)} icon={<WalletCards />} />
      <Metric label="Saldo de honorarios" value={money.format(totals.pending)} icon={<Scale />} tone="blue" />
      <Metric label="Operaciones mostradas" value={number.format(rows.length)} helper={`Máximo ${data.limit || 20}`} icon={<FileCheck2 />} tone="purple" />
    </section>
    {Boolean(data.unclassified_amount) && <div className={styles.definition}><strong>Revisión pendiente</strong><span>{money.format(data.unclassified_amount || 0)} aplicados al despacho no tienen un expediente u honorario vinculable y se excluyen del ranking.</span></div>}
    <section className={styles.panel}><PanelHeader eyebrow="Mayor importe computable primero" title="Top 20 por importe computable 80/20" />{rows.length ? <div className={styles.tableWrap}><table><thead><tr><th>#</th><th>Expediente</th><th>Cliente</th><th>Abogado</th><th>Notaría</th><th>Estado</th><th className={styles.numeric}>Honorarios</th><th className={styles.numeric}>Importe computable</th><th className={styles.numeric}>Cobrado a honorarios</th><th className={styles.numeric}>Saldo pendiente</th></tr></thead><tbody>{rows.map((item, index) => <tr key={item.id}><td data-label="#">{index + 1}</td><td data-label="Expediente"><Link to={item.link}>{item.expediente}</Link></td><td data-label="Cliente">{item.cliente}</td><td data-label="Abogado">{item.abogado}</td><td data-label="Notaría">{item.notaria}</td><td data-label="Estado"><span className={styles.neutralStatus}>{statusLabel(item.status)}</span></td><td data-label="Honorarios" className={styles.numeric}><strong>{item.honorarios === null ? 'Sin honorario reconocido' : money.format(item.honorarios)}</strong></td><td data-label="Importe computable" className={styles.numeric}><strong>{money.format(item.importe_computable)}</strong></td><td data-label="Cobrado a honorarios" className={styles.numeric}>{item.cobrado_honorarios_acumulado === null ? 'No disponible' : money.format(item.cobrado_honorarios_acumulado)}</td><td data-label="Saldo pendiente" className={styles.numeric}>{item.pending === null ? 'No disponible' : money.format(item.pending)}</td></tr>)}</tbody></table></div> : <Empty title="Sin importes computables en el periodo" detail="El ranking requiere una distribución aplicada al despacho y vinculada a un expediente." />}</section>
  </div>;
}

export function PotentialClientsView({ data, onPageChange }: { data: PotentialClientsReport; onPageChange: (page: number) => void }) {
  if (data.restricted) return <Restricted />;
  const total = data.metrics?.honorarios ?? data.rows.reduce((sum, item) => sum + item.honorarios, 0);
  const count = data.metrics?.total ?? data.meta?.total ?? data.rows.length;
  return <div className={styles.reportStack}>
    <div className={styles.definition}><strong>Potencial comercial</strong><span>{data.definition}</span></div>
    <section className={styles.metrics}>
      <Metric label="Clientes potenciales" value={number.format(count)} icon={<UsersRound />} />
      <Metric label="Honorarios potenciales" value={money.format(total)} helper="No son honorarios generados" icon={<CircleDollarSign />} tone="green" />
    </section>
    <section className={styles.panel}><PanelHeader eyebrow="Conversión comercial" title="Cotizaciones activas no aceptadas" />{data.rows.length ? <><div className={styles.tableWrap}><table><thead><tr><th>Cliente</th><th>Acto</th><th>Responsable</th><th>Notaría</th><th>Fecha de cotización</th><th className={styles.numeric}>Honorarios potenciales</th></tr></thead><tbody>{data.rows.map((item) => <tr key={item.id}><td data-label="Cliente"><Link to={item.link}>{item.cliente}</Link></td><td data-label="Acto">{item.acto}</td><td data-label="Responsable">{item.responsable}</td><td data-label="Notaría">{item.notaria}</td><td data-label="Fecha de cotización">{date(item.fecha_cotizacion)}</td><td data-label="Honorarios potenciales" className={styles.numeric}>{money.format(item.honorarios)}</td></tr>)}</tbody></table></div>{data.meta && data.meta.totalPages > 1 && <nav className={styles.pagination} aria-label="Paginación de clientes potenciales"><span>Página {data.meta.page} de {data.meta.totalPages} · {number.format(data.meta.total)} resultados</span><div><button type="button" disabled={data.meta.page <= 1} onClick={() => onPageChange(data.meta!.page - 1)}>Anterior</button><button type="button" disabled={data.meta.page >= data.meta.totalPages} onClick={() => onPageChange(data.meta!.page + 1)}>Siguiente</button></div></nav>}</> : <Empty title="Sin cotizaciones potenciales" detail="No hay cotizaciones vigentes sin aceptar dentro del periodo." />}</section>
  </div>;
}
