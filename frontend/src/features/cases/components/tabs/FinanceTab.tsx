import { ArrowDownLeft, ArrowUpRight, BriefcaseBusiness, FileCheck2, FileWarning, HandCoins, Landmark, Plus, WalletCards } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MovementDetail } from '../../../finance/components/MovementDetail';
import { NewMovementFlow } from '../../../finance/components/NewMovementFlow';
import { financeService } from '../../../finance/finance.service';
import type { FinanceCatalogs, FinanceMovement } from '../../../finance/finance.types';
import { financeDate, money, statusLabel } from '../../../finance/finance.utils';
import type { ExpedienteDetail } from '../../expedientes.types';
import styles from '../../Expedientes.module.css';

type Props = { expediente: ExpedienteDetail; onChanged(): void };

export function FinanceTab({ expediente, onChanged }: Props) {
  const movements = (expediente.movimientosFinancieros || []) as FinanceMovement[];
  const summary = expediente.financialSummary || { ingresos_recibidos: 0, honorarios_generados: 0, honorarios_cobrados: 0, honorarios_por_cobrar: 0, fondos_terceros: 0, otros_destinos: 0, fondos_terceros_pendientes: 0, egresos: 0 };
  const [catalogs, setCatalogs] = useState<FinanceCatalogs | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<FinanceMovement | null>(null);
  const [catalogError, setCatalogError] = useState('');

  useEffect(() => {
    if (!expediente.capabilities.canWriteFinance) return;
    const controller = new AbortController();
    setCatalogError('');
    financeService.catalogs(controller.signal)
      .then(setCatalogs)
      .catch(() => {
        if (!controller.signal.aborted) setCatalogError('No pudimos preparar el registro de movimientos.');
      });
    return () => controller.abort();
  }, [expediente.capabilities.canWriteFinance]);

  const permissions: FinanceCatalogs['permisos'] = catalogs?.permisos || {
    escribir: expediente.capabilities.canWriteFinance,
    aplicar: false,
    conciliar: false,
    expedientesLeer: true,
    documentosLeer: expediente.capabilities.canReadDocuments,
    documentosEscribir: expediente.capabilities.canWriteFinance && expediente.capabilities.canUploadDocuments,
    documentosEliminar: expediente.capabilities.canWriteFinance && expediente.capabilities.canDeleteDocuments,
  };
  const metrics = [
    { label: 'Honorarios generados', value: summary.honorarios_generados, icon: BriefcaseBusiness, tone: 'gold' },
    { label: 'Honorarios cobrados', value: summary.honorarios_cobrados, icon: ArrowDownLeft, tone: 'green' },
    { label: 'Por cobrar', value: summary.honorarios_por_cobrar, icon: HandCoins, tone: 'orange' },
    { label: 'Recursos no propios', value: summary.fondos_terceros, icon: Landmark, tone: 'blue' },
    { label: 'Egresos asociados', value: summary.egresos, icon: ArrowUpRight, tone: 'red' },
  ];

  return <div className={styles.tabStack}>
    <section className={styles.caseFinanceMetrics} aria-label="Resumen financiero del expediente">
      {metrics.map(({ label, value, icon: Icon, tone }) => <article key={label} data-tone={tone}><span><Icon /></span><small>{label}</small><strong>{money(value)}</strong></article>)}
    </section>
    {summary.otros_destinos > 0 && <div className={styles.caseFinanceNotice}>Hay {money(summary.otros_destinos)} de ingresos pendientes de clasificación económica. No se consideran automáticamente recursos de terceros.</div>}
    <section className={styles.sectionCard}>
      <header className={styles.caseFinanceHeader}><div><h2>Movimientos del expediente</h2><p>Una sola fuente de verdad, compartida con Finanzas y Cartera.</p></div>{expediente.capabilities.canWriteFinance && <button type="button" className={styles.primaryButton} disabled={!catalogs} onClick={() => setCreateOpen(true)}><Plus size={16} />Registrar movimiento</button>}</header>
      {catalogError && <p className={styles.sectionError} role="alert">{catalogError}</p>}
      {movements.length ? <div className={styles.caseMovementList}>{movements.map((item) => {
        const evidence = item.movimientoDocumentos || [];
        return <button type="button" key={item.id} onClick={() => setSelected(item)}>
          <span className={item.naturaleza === 'INGRESO' ? styles.income : styles.expense}>{item.naturaleza === 'INGRESO' ? <ArrowDownLeft /> : <ArrowUpRight />}</span>
          <div><strong>{item.concepto}</strong><small>{financeDate(item.fecha_movimiento)} · {statusLabel(item.estatus)}</small></div>
          <span className={evidence.length ? styles.caseReceiptOk : styles.caseReceiptMissing}>{evidence.length ? <FileCheck2 /> : <FileWarning />}{evidence.length ? 'Con comprobante' : 'Sin comprobante'}</span>
          <b>{money(item.monto)}</b>
        </button>;
      })}</div> : <div className={styles.caseFinanceEmpty}><WalletCards /><strong>No hay movimientos registrados en este expediente.</strong><p>Los movimientos creados aquí aparecerán también en Finanzas.</p></div>}
    </section>
    {createOpen && catalogs && <NewMovementFlow catalogs={catalogs} initialExpedienteId={expediente.id} lockExpediente onClose={() => setCreateOpen(false)} onSaved={() => { onChanged(); }} />}
    {selected && <MovementDetail movement={selected} permissions={permissions} onChanged={onChanged} onClose={() => setSelected(null)} />}
  </div>;
}
