import { useMemo, useState, type DragEvent } from 'react';
import { ChevronDown, ChevronUp, GripVertical, List, Plus, RotateCcw, Settings2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { DailyKpis } from './components/DailyKpis';
import { MyDayHeader } from './components/MyDayHeader';
import { TodayAgenda } from './components/TodayAgenda';
import { UrgentSignatures } from './components/UrgentSignatures';
import { RecentFiles } from './components/RecentFiles';
import { FollowUpReminders } from './components/FollowUpReminders';
import { UrgentTasks } from './components/UrgentTasks';
import { PraviaAiCard } from './components/PraviaAiCard';
import { PersonalNotebook } from './components/PersonalNotebook';
import { ProcessCard } from './components/ProcessCard';
import { CaseCard } from './components/CaseCard';
import { CommercialCard } from './components/CommercialCard';
import { FinanceCard } from './components/FinanceCard';
import { DocumentCard } from './components/DocumentCard';
import { ArchiveCard } from './components/ArchiveCard';
import { UserLoadCard } from './components/UserLoadCard';
import { ProcessAverageCard } from './components/ProcessAverageCard';
import { SigningAverageCard } from './components/SigningAverageCard';
import { DaySummary } from './components/DaySummary';
import { CardDetailDialog } from './components/CardDetailDialog';
import { TenantBoardSettings } from './components/TenantBoardSettings';
import { WidgetCard, WidgetEmpty, WidgetError, WidgetLoading } from './components/WidgetCard';
import { formatCurrency } from './formatters';
import type { WidgetSection } from './myDay.types';
import type { MiDiaCard, MiDiaLayoutItem } from './miDiaConfiguration.service';
import { useMiDiaConfiguration } from './useMiDiaConfiguration';
import { useMyDay } from './useMyDay';
import styles from './MyDayPage.module.css';

const familyLabels: Record<string, string> = {
  OPERACION: 'Operación', COMERCIAL: 'Comercial', AGENDA: 'Agenda', DOCUMENTOS: 'Documentos',
  CUMPLIMIENTO: 'Cumplimiento', FINANZAS: 'Finanzas', DESEMPENO: 'Producción', ARCHIVO: 'Archivo', IA: 'IA',
};

const detailKeys = new Set([
  'MY_PENDING', 'OVERDUE_PROCESSES', 'DUE_TODAY', 'UPCOMING_DUE', 'CATASTRO_PENDING', 'RPP_PENDING', 'TESTIMONIES_PENDING', 'CAN_ADVANCE_TODAY',
  'CASES_INACTIVE', 'CASES_DELAYED', 'CASES_BLOCKED', 'POSTSIGN_PENDING', 'DELIVERIES_PENDING', 'MY_ACTIVE_CASES',
  'READY_TO_SIGN', 'NOT_READY_TO_SIGN', 'SIGNED_TODAY', 'SIGNED_PERIOD', 'SIGNED_CASES',
  'PROSPECTS_ACTIVE', 'PROSPECTS_NEW', 'PROSPECTS_STALE', 'PROSPECTS_READY', 'QUOTES_ACTIVE', 'QUOTES_TO_SEND', 'QUOTES_NO_RESPONSE', 'QUOTES_FOLLOWUP', 'QUOTES_ACCEPTED', 'QUOTES_CONVERSION', 'CASES_CONVERSION', 'QUOTES_ACTIVE_VALUE', 'QUOTES_ACCEPTED_VALUE',
  'INCOME_COLLECTED', 'COLLECTED_TODAY', 'COLLECTION_SCHEDULED', 'FEES_SCHEDULED_SIGN', 'FEES_SIGNED', 'ADVANCES_PENDING', 'PRODUCTION_VALUE', 'PAYMENTS_DUE', 'PAYMENTS_UNPROVEN', 'CLIENT_RESOURCES', 'REP_PENDING', 'INVOICES_PENDING', 'CFDI_TO_STAMP',
  'MISSING_DOCUMENTS', 'DOCUMENTS_TO_REVIEW', 'EXPIRED_DOCUMENTS', 'FORMATS_TO_GENERATE', 'FORMATS_TO_SIGN', 'DOCUMENT_INCONSISTENCIES',
  'PLD_INCOMPLETE', 'NOTICES_PENDING', 'NOTICES_UPCOMING', 'NOTICES_OVERDUE', 'CRITICAL_ALERTS', 'DEEDS_TODAY',
  'CASES', 'URGENT_TASKS', 'TODAY_AGENDA', 'TODAY_SIGNINGS', 'UPCOMING_APPOINTMENTS', 'UPCOMING_SIGNINGS', 'RECEIVABLE', 'FOLLOWUP_REMINDERS',
]);

export function MyDayPage() {
  const { user } = useAuth();
  const { status, data, error, retry } = useMyDay();
  const config = useMiDiaConfiguration();
  const [editing, setEditing] = useState(false);
  const [tenantEditing, setTenantEditing] = useState(false);
  const [search, setSearch] = useState('');
  const [family, setFamily] = useState('ALL');
  const [dragged, setDragged] = useState<string | null>(null);
  const [detailCard, setDetailCard] = useState<{ key: string; title: string } | null>(null);
  const loading = status === 'loading';
  const sectionError = (section: WidgetSection) => data?.errors[section] ?? (status === 'error' ? error ?? undefined : undefined);
  const activeKeys = useMemo(() => new Set(config.layout.map((item) => item.key)), [config.layout]);
  const available = useMemo(() => (config.configuration?.catalog ?? []).filter((card) =>
    !activeKeys.has(card.key) && (family === 'ALL' || card.family === family) &&
    `${card.name} ${card.sourceModule}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))),
  [config.configuration, activeKeys, family, search]);

  if (!user) return null;

  const update = (key: string, change: Partial<MiDiaLayoutItem>) => config.change(config.layout.map((item) => item.key === key ? { ...item, ...change } : item));
  const updateParameter = (item: MiDiaLayoutItem, key: 'limit' | 'window' | 'period', value: string) => {
    const parameters = { ...item.parameters };
    if (value) parameters[key] = key === 'period' ? value : Number(value);
    else delete parameters[key];
    update(item.key, { parameters });
  };
  const move = (key: string, target: number) => {
    const source = config.layout.findIndex((item) => item.key === key);
    if (source < 0 || target < 0 || target >= config.layout.length || source === target) return;
    const next = [...config.layout];
    next.splice(target, 0, next.splice(source, 1)[0]);
    config.change(next);
  };
  const add = (card: MiDiaCard) => {
    if (!activeKeys.has(card.key)) config.change([...config.layout, {
      key: card.key, size: card.defaultSize, scope: card.allowedScopes[card.allowedScopes.length - 1], parameters: {},
    }]);
  };
  const drop = (event: DragEvent<HTMLElement>, target: number) => {
    event.preventDefault();
    const source = event.dataTransfer.getData('text/plain') || dragged;
    if (source && activeKeys.has(source)) move(source, target);
    setDragged(null);
  };

  const render = (item: MiDiaLayoutItem) => {
    switch (item.key) {
      case 'MY_PENDING': case 'OVERDUE_PROCESSES': case 'DUE_TODAY': case 'UPCOMING_DUE':
      case 'CATASTRO_PENDING': case 'RPP_PENDING': case 'TESTIMONIES_PENDING': case 'CAN_ADVANCE_TODAY':
        return <ProcessCard title={config.configuration?.catalog.find((card) => card.key === item.key)?.name ?? item.key}
          data={data?.processCards[item.key]} loading={loading} error={sectionError(item.key)} onRetry={retry} />;
      case 'CASES_INACTIVE': case 'CASES_DELAYED': case 'CASES_BLOCKED': case 'POSTSIGN_PENDING': case 'DELIVERIES_PENDING':
      case 'MY_ACTIVE_CASES': case 'SIGNED_CASES':
      case 'READY_TO_SIGN': case 'NOT_READY_TO_SIGN': case 'SIGNED_TODAY': case 'SIGNED_PERIOD':
        return <CaseCard title={config.configuration?.catalog.find((card) => card.key === item.key)?.name ?? item.key}
          data={data?.caseCards[item.key]} loading={loading} error={sectionError(item.key)} onRetry={retry}
          inactive={item.key === 'CASES_INACTIVE'} />;
      case 'PROSPECTS_ACTIVE': case 'PROSPECTS_NEW': case 'PROSPECTS_STALE': case 'PROSPECTS_READY':
      case 'QUOTES_ACTIVE': case 'QUOTES_TO_SEND': case 'QUOTES_NO_RESPONSE': case 'QUOTES_FOLLOWUP': case 'QUOTES_ACCEPTED':
      case 'QUOTES_CONVERSION': case 'CASES_CONVERSION': case 'QUOTES_ACTIVE_VALUE': case 'QUOTES_ACCEPTED_VALUE':
        return <CommercialCard title={config.configuration?.catalog.find((card) => card.key === item.key)?.name ?? item.key}
          data={data?.commercialCards[item.key]} loading={loading} error={sectionError(item.key)} onRetry={retry} />;
      case 'INCOME_COLLECTED': case 'COLLECTED_TODAY': case 'COLLECTION_SCHEDULED': case 'FEES_SCHEDULED_SIGN': case 'FEES_SIGNED': case 'ADVANCES_PENDING': case 'PRODUCTION_VALUE':
      case 'PAYMENTS_DUE': case 'PAYMENTS_UNPROVEN': case 'CLIENT_RESOURCES': case 'REP_PENDING': case 'INVOICES_PENDING': case 'CFDI_TO_STAMP':
        return <FinanceCard title={config.configuration?.catalog.find((card) => card.key === item.key)?.name ?? item.key}
          data={data?.financeCards[item.key]} loading={loading} error={sectionError(item.key)} onRetry={retry}
          expandable={item.key === 'PRODUCTION_VALUE'}
          sourceHref={item.key === 'ADVANCES_PENDING' ? '/finanzas' : undefined}
          itemLabel={item.key === 'CFDI_TO_STAMP' ? 'prefactura' : item.key === 'REP_PENDING' ? 'pago' : item.key === 'INVOICES_PENDING' ? 'ingreso' : item.key === 'COLLECTION_SCHEDULED' ? 'cobro' : item.key === 'CLIENT_RESOURCES' || item.key.startsWith('FEES_') || item.key === 'ADVANCES_PENDING' || item.key === 'PRODUCTION_VALUE' ? 'expediente' : item.key.startsWith('PAYMENTS_') ? 'solicitud' : 'movimiento'}
          itemPluralLabel={item.key === 'COLLECTION_SCHEDULED' ? 'cobros' : item.key.startsWith('PAYMENTS_') ? 'solicitudes' : undefined}
          emptyMessage={item.key === 'FEES_SCHEDULED_SIGN' ? 'No hay firmas programadas en este periodo dentro de tu alcance.'
            : item.key === 'FEES_SIGNED' || item.key === 'PRODUCTION_VALUE' ? 'No hay expedientes firmados en este periodo dentro de tu alcance.'
              : item.key === 'PAYMENTS_DUE' ? 'No hay solicitudes de pago pendientes dentro de tu alcance.'
                : item.key === 'PAYMENTS_UNPROVEN' ? 'No hay pagos sin comprobante activo dentro de tu alcance.'
                  : item.key === 'COLLECTION_SCHEDULED' ? 'No hay cobros pendientes con vencimiento contractual en este periodo.'
                    : item.key === 'CLIENT_RESOURCES' ? 'No hay recursos de terceros disponibles en expedientes dentro de tu alcance.'
                      : item.key === 'REP_PENDING' ? 'No hay pagos PPD de CFDI emitidos pendientes de complemento dentro de tu alcance.'
                        : item.key === 'INVOICES_PENDING' ? 'No hay saldo facturable pendiente dentro de tu alcance.'
                          : item.key === 'CFDI_TO_STAMP' ? 'No hay prefacturas con datos mínimos completos; el PAC no está certificado.' : undefined}
          note={item.key === 'CFDI_TO_STAMP' ? 'La revisión de datos no autoriza el timbrado: el proveedor fiscal no está certificado.' : undefined} />;
      case 'MISSING_DOCUMENTS': case 'DOCUMENTS_TO_REVIEW': case 'EXPIRED_DOCUMENTS': case 'FORMATS_TO_GENERATE': case 'FORMATS_TO_SIGN': case 'DOCUMENT_INCONSISTENCIES':
        return <DocumentCard title={config.configuration?.catalog.find((card) => card.key === item.key)?.name ?? item.key}
          data={data?.documentCards[item.key]} loading={loading} error={sectionError(item.key)} onRetry={retry}
          kind={item.key === 'FORMATS_TO_GENERATE' ? 'format' : item.key === 'FORMATS_TO_SIGN' ? 'signature'
            : item.key === 'DOCUMENT_INCONSISTENCIES' ? 'finding' : 'document'} />;
      case 'PLD_INCOMPLETE': case 'NOTICES_PENDING': case 'NOTICES_UPCOMING': case 'NOTICES_OVERDUE': case 'CRITICAL_ALERTS':
        return <DocumentCard title={config.configuration?.catalog.find((card) => card.key === item.key)?.name ?? item.key}
          data={data?.complianceCards[item.key]} loading={loading} error={sectionError(item.key)} onRetry={retry}
          kind={item.key === 'CRITICAL_ALERTS' ? 'alert' : item.key === 'PLD_INCOMPLETE' ? 'compliance' : 'notice'} />;
      case 'NEXT_DEED': case 'NEXT_FOLIO': case 'DEEDS_TODAY': case 'CURRENT_BOOK': case 'FOLIOS_LEFT': case 'APPENDIX_PENDING':
        return <ArchiveCard title={config.configuration?.catalog.find((card) => card.key === item.key)?.name ?? item.key}
          data={data?.archiveCards[item.key]} loading={loading} error={sectionError(item.key)} onRetry={retry} />;
      case 'USER_LOAD': return <UserLoadCard data={data?.userLoad} loading={loading}
        error={sectionError('USER_LOAD')} onRetry={retry} />;
      case 'AVERAGE_PROCESS': return <ProcessAverageCard data={data?.processAverage} loading={loading}
        error={sectionError('AVERAGE_PROCESS')} onRetry={retry} />;
      case 'AVERAGE_TO_SIGN': return <SigningAverageCard data={data?.signingAverage} loading={loading}
        error={sectionError('AVERAGE_TO_SIGN')} onRetry={retry} />;
      case 'URGENT_TASKS': return <UrgentTasks items={data?.urgentTasks ?? []} loading={loading} error={sectionError('tasks')} onRetry={retry} />;
      case 'TODAY_AGENDA': return <TodayAgenda items={data?.agenda ?? []} count={data?.agendaCount} visibleLimit={Number(item.parameters.limit ?? 10)} loading={loading} error={sectionError('agenda')} onRetry={retry} />;
      case 'TODAY_SIGNINGS': return <TodayAgenda title="Firmas de hoy" items={data?.todaySignings ?? []} visibleLimit={item.size === 'L' ? 10 : item.size === 'M' ? 5 : 3} count={Number(data?.kpis.todaySignings?.value ?? 0)} loading={loading} error={sectionError('todaySignings')} onRetry={retry} emptyMessage="No hay firmas programadas para hoy." errorMessage="No pudimos cargar las firmas de hoy." />;
      case 'UPCOMING_APPOINTMENTS': return <TodayAgenda title="Citas próximas" items={data?.upcomingAppointments ?? []} visibleLimit={item.size === 'L' ? 10 : 5} count={Number(data?.kpis.upcomingAppointments?.value ?? 0)} loading={loading} error={sectionError('upcomingAppointments')} onRetry={retry} emptyMessage="No hay citas próximas en esta ventana." errorMessage="No pudimos cargar las citas próximas." />;
      case 'UPCOMING_SIGNINGS': return <UrgentSignatures items={data?.urgentSignatures ?? []}
        count={typeof data?.kpis.signaturesToday?.value === 'number' ? data.kpis.signaturesToday.value : undefined}
        visibleLimit={item.size === 'L' ? 15 : item.size === 'M' ? 10 : 5}
        loading={loading} error={sectionError('signatures')} onRetry={retry} />;
      case 'CASES': return <RecentFiles items={data?.recentFiles ?? []} loading={loading} error={sectionError('recentFiles')} onRetry={retry} />;
      case 'FOLLOWUP_REMINDERS': return <FollowUpReminders items={data?.reminders ?? []} count={data?.reminderCount} loading={loading} error={sectionError('reminders')} onRetry={retry} />;
      case 'PERSONAL_NOTEBOOK': return <PersonalNotebook />;
      case 'PRAVIA_ASSISTANT': return <PraviaAiCard canViewFinance={data?.permissions.canViewFinance === true} />;
      case 'DAY_SUMMARY': case 'NEEDS_ATTENTION': return <DaySummary data={data} layout={config.layout}
        names={Object.fromEntries((config.configuration?.catalog ?? []).map((card) => [card.key, card.name]))}
        loading={loading} error={status === 'error' ? error ?? undefined : undefined} onRetry={retry}
        mode={item.key === 'NEEDS_ATTENTION' ? 'attention' : 'summary'} />;
      case 'RECEIVABLE': {
        const metric = data?.finance?.metrics.find((entry) => entry.key === 'receivable');
        const detailPath = (item.scope === 'OWN' || user.scope !== 'GLOBAL') && user.id
          ? `/finanzas?view=cartera&responsable_id=${encodeURIComponent(user.id)}` : '/finanzas?view=cartera';
        return <WidgetCard title="Por cobrar" action={<Link to={detailPath}>Ver cartera</Link>}>
          {loading ? <WidgetLoading rows={2} /> : sectionError('finance') ? <WidgetError message="No pudimos cargar el saldo." onRetry={retry} /> :
            metric ? <div className={styles.receivable}>{formatCurrency(metric.value, metric.currency)}</div> :
            <WidgetEmpty>No hay un saldo disponible para tu alcance.</WidgetEmpty>}
        </WidgetCard>;
      }
      default: return <WidgetCard title={config.configuration?.catalog.find((card) => card.key === item.key)?.name ?? item.key}>
        <WidgetError message="Esta fuente no está conectada. La tarjeta no representa un valor cero." onRetry={() => void config.reload()} />
      </WidgetCard>;
    }
  };

  return <div className={styles.page}>
    <div className={styles.topBar}>
      <MyDayHeader name={user.name} dateValue={data?.date} />
      <div className={styles.topActions}>
        {config.configuration?.tenantAdministration && <button type="button" className={styles.customize} onClick={() => setTenantEditing((value) => !value)} aria-pressed={tenantEditing}>
          <Settings2 size={16} />{tenantEditing ? 'Cerrar configuración' : 'Configurar notaría'}
        </button>}
        <button type="button" className={styles.customize} onClick={() => setEditing((value) => !value)} aria-pressed={editing}>
          <Settings2 size={16} />{editing ? 'Terminar' : 'Personalizar Mi Día'}
        </button>
      </div>
    </div>
    <DailyKpis data={data} loading={loading} />
    {config.status === 'loading' && <div className={styles.configLoading} role="status">Cargando tu tablero…</div>}
    {config.status === 'error' && <div className={styles.configError} role="alert">{config.error}<button type="button" onClick={() => void config.reload()}>Recargar configuración</button></div>}
    {config.status !== 'loading' && config.configuration && <>
      {tenantEditing && config.configuration.tenantAdministration && <TenantBoardSettings administration={config.configuration.tenantAdministration} onSaved={async () => { await config.reload(); retry(); }} />}
      {editing && <section className={styles.editor} aria-label="Personalizar Mi Día">
        <div className={styles.editorHeader}>
          <div><h2>Personalizar Mi Día</h2><p>Arrastra las tarjetas o usa sus flechas. Los cambios se guardan automáticamente.</p></div>
          <div className={styles.editorActions}>
            <span role="status">{config.status === 'saving' ? 'Guardando…' : config.status === 'error' ? 'No guardado' : 'Cambios guardados'}</span>
            <button type="button" onClick={() => void config.reset()} disabled={config.status === 'saving'}><RotateCcw size={14} />Restablecer</button>
          </div>
        </div>
        <div className={styles.catalogControls}>
          <input aria-label="Buscar tarjetas" placeholder="Buscar tarjetas" value={search} onChange={(event) => setSearch(event.target.value)} />
          <select aria-label="Filtrar familia" value={family} onChange={(event) => setFamily(event.target.value)}>
            <option value="ALL">Todas las familias</option>
            {Object.entries(familyLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        <div className={styles.catalog}>
          {available.map((card) => <button key={card.key} type="button" onClick={() => add(card)}>
            <Plus size={15} /><span><strong>{card.name}</strong><small>{familyLabels[card.family] ?? card.family} · {card.sourceModule}{card.recommended ? ' · Recomendada' : ''}</small></span>
          </button>)}
          {!available.length && <p>No hay más tarjetas disponibles para tus permisos y filtros.</p>}
        </div>
      </section>}
      <div className={styles.board}>
        {config.layout.map((item, index) => {
          const card = config.configuration?.catalog.find((entry) => entry.key === item.key);
          if (!card) return null;
          return <div key={item.key} className={`${styles.boardItem} ${styles[`size${item.size}`]}`} onDragOver={(event) => editing && event.preventDefault()} onDrop={(event) => editing && drop(event, index)}>
            {editing && <div className={styles.cardTools}>
              <div className={styles.dragHandle} role="button" tabIndex={0} draggable
                onDragStart={(event) => { event.dataTransfer.setData('text/plain', item.key); event.dataTransfer.effectAllowed = 'move'; setDragged(item.key); }}
                onDragEnd={() => setDragged(null)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); move(item.key, index - 1); }
                  if (event.key === 'ArrowDown' && index < config.layout.length - 1) { event.preventDefault(); move(item.key, index + 1); }
                }}
                aria-label={`Arrastrar ${card.name}`} title="Arrastrar o usar flechas"><GripVertical size={16} /></div>
              <span>{card.name}</span>
              <button type="button" aria-label={`Mover ${card.name} arriba`} onClick={() => move(item.key, index - 1)} disabled={index === 0}><ChevronUp size={16} /></button>
              <button type="button" aria-label={`Mover ${card.name} abajo`} onClick={() => move(item.key, index + 1)} disabled={index === config.layout.length - 1}><ChevronDown size={16} /></button>
              <select aria-label={`Tamaño de ${card.name}`} value={item.size} onChange={(event) => update(item.key, { size: event.target.value as MiDiaLayoutItem['size'] })}>
                {card.allowedSizes.map((size) => <option key={size} value={size}>{size}</option>)}
              </select>
              {card.allowedScopes.length > 1 && <select aria-label={`Alcance de ${card.name}`} value={item.scope} onChange={(event) => update(item.key, { scope: event.target.value as MiDiaLayoutItem['scope'] })}>
                {card.allowedScopes.map((scope) => <option key={scope} value={scope}>{scope === 'OWN' ? 'Mis datos' : 'Organización'}</option>)}
              </select>}
              {card.parameters.includes('limit') && <select aria-label={`Cantidad de ${card.name}`} value={item.parameters.limit ?? ''} onChange={(event) => updateParameter(item, 'limit', event.target.value)}>
                <option value="">Cantidad predeterminada</option>
                {[5, 10, 15].map((amount) => <option key={amount} value={amount}>{amount} elementos</option>)}
              </select>}
              {card.parameters.includes('window') && <select aria-label={`Ventana de ${card.name}`} value={item.parameters.window ?? ''} onChange={(event) => updateParameter(item, 'window', event.target.value)}>
                <option value="">Ventana predeterminada</option>
                {[3, 7, 15].map((days) => <option key={days} value={days}>{days} días</option>)}
              </select>}
              {card.parameters.includes('period') && <select aria-label={`Periodo de ${card.name}`} value={item.parameters.period ?? ''} onChange={(event) => updateParameter(item, 'period', event.target.value)}>
                <option value="">Periodo predeterminado (mes)</option>
                {item.key === 'PRODUCTION_VALUE' ? <><option value="MONTH">Mes</option><option value="YEAR">Año</option></>
                  : <><option value="TODAY">Hoy</option><option value="WEEK">Semana</option><option value="MONTH">Mes</option>
                    <option value="QUARTER">Trimestre</option><option value="YEAR">Año</option></>}
              </select>}
              {!item.fixed && <button type="button" aria-label={`Quitar ${card.name}`} onClick={() => config.change(config.layout.filter((entry) => entry.key !== item.key))}><X size={16} /></button>}
            </div>}
            {render(item)}
            {!editing && detailKeys.has(item.key) && <button type="button" className={styles.detailTrigger}
              onClick={() => setDetailCard({ key: item.key, title: card.name })}>
              <List size={16} />Ver detalle paginado
            </button>}
          </div>;
        })}
        {!config.layout.length && <div className={styles.emptyBoard}>Tu tablero no tiene tarjetas. {editing ? 'Elige una arriba para comenzar.' : 'Selecciona Personalizar Mi Día para agregarlas.'}</div>}
      </div>
    </>}
    {detailCard && <CardDetailDialog cardKey={detailCard.key} title={detailCard.title} onClose={() => setDetailCard(null)} />}
  </div>;
}
