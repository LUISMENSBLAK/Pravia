import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { myDayService } from '../myDay.service';
import type { MiDiaCardDetail, MiDiaCardDetailItem } from '../myDay.types';
import { formatCurrency } from '../formatters';
import styles from './CardDetailDialog.module.css';

type Props = { cardKey: string; title: string; onClose: () => void };

const firstText = (item: MiDiaCardDetailItem) => item.folio || item.nombre || item.concepto || item.cliente || 'Registro';
const secondText = (item: MiDiaCardDetailItem) => {
  const values = [item.nombre, item.concepto, item.cliente, item.contexto, item.estado]
    .filter((value, index, all): value is string => Boolean(value) && value !== firstText(item) && all.indexOf(value) === index);
  return values.slice(0, 2).join(' · ');
};
const itemDate = (item: MiDiaCardDetailItem) => item.fecha || item.received_at;

export function CardDetailDialog({ cardKey, title, onClose }: Props) {
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<MiDiaCardDetail | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState('');
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    setError('');
    void myDayService.detail(cardKey, page, 20, controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      setDetail(value);
      setStatus('success');
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      setError(reason instanceof Error ? reason.message : 'No fue posible cargar el detalle.');
      setStatus('error');
    });
    return () => controller.abort();
  }, [cardKey, page, retryToken]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const range = useMemo(() => detail && detail.totalCount
    ? `${(detail.page - 1) * detail.pageSize + 1}–${Math.min(detail.page * detail.pageSize, detail.totalCount)}` : '0', [detail]);

  return <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
    if (event.currentTarget === event.target) onClose();
  }}>
    <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="mi-dia-detail-title">
      <header className={styles.header}>
        <div><span>MI DÍA · DETALLE CANÓNICO</span><h2 id="mi-dia-detail-title">{detail?.title ?? title}</h2></div>
        <button type="button" onClick={onClose} aria-label="Cerrar detalle" autoFocus><X size={20} /></button>
      </header>
      {status === 'loading' && <div className={styles.state} role="status">Cargando registros…</div>}
      {status === 'error' && <div className={styles.state} role="alert"><p>{error}</p><button type="button" onClick={() => setRetryToken((value) => value + 1)}>Reintentar</button></div>}
      {status === 'success' && detail && <>
        <div className={styles.summary}>
          <div><small>Total</small><strong>{detail.totalCount.toLocaleString('es-MX')}</strong></div>
          {detail.totalAmount !== undefined && <div><small>Importe total</small><strong>{formatCurrency(Number(detail.totalAmount), 'MXN')}</strong></div>}
          <div><small>Alcance</small><strong>{detail.scope === 'OWN' ? 'Mis datos' : 'Organización'}</strong></div>
        </div>
        {!detail.available && <div className={styles.notice} role="status">{detail.message || 'La fuente canónica no tiene información suficiente.'}</div>}
        {detail.available && !detail.items.length && <div className={styles.state}>No hay registros en este detalle.</div>}
        {detail.items.length > 0 && <ul className={styles.list} aria-label={`Registros de ${detail.title}`}>
          {detail.items.map((item) => <li key={item.id}>
            <div className={styles.itemBody}>
              <strong>{firstText(item)}</strong>
              {secondText(item) && <span>{secondText(item)}</span>}
              {itemDate(item) && <time dateTime={itemDate(item)!}>{new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(itemDate(item)!))}</time>}
            </div>
            {item.amount !== undefined && <b>{formatCurrency(Number(item.amount), 'MXN')}</b>}
            {item.href && <Link to={item.href} onClick={onClose} aria-label={`Abrir ${firstText(item)}`}><ExternalLink size={18} /></Link>}
          </li>)}
        </ul>}
        <footer className={styles.footer}>
          <span>Mostrando {range} de {detail.totalCount.toLocaleString('es-MX')}</span>
          <nav aria-label="Paginación del detalle">
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={detail.page <= 1}><ChevronLeft size={18} />Anterior</button>
            <span>Página {detail.page} de {detail.totalPages}</span>
            <button type="button" onClick={() => setPage((value) => Math.min(detail.totalPages, value + 1))} disabled={detail.page >= detail.totalPages}>Siguiente<ChevronRight size={18} /></button>
          </nav>
        </footer>
      </>}
    </section>
  </div>;
}
