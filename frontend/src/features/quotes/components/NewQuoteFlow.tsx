import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { LoaderCircle } from 'lucide-react';
import { useAuth } from '../../auth/AuthProvider';
import { comparecientesService } from '../../comparecientes/comparecientes.service';
import type { ComparecienteListItem } from '../../comparecientes/comparecientes.types';
import type { Quote } from '../quotes.types';
import { quotesService } from '../quotes.service';
import { QuoteDrawer } from './QuoteDrawer';
import styles from '../Quotes.module.css';

export function NewQuoteFlow({ initialProspectId, onClose, onCreated }: { initialProspectId?: string; onClose: () => void; onCreated: (quote: Quote) => void }) {
  const { user } = useAuth();
  const [key] = useState(() => crypto.randomUUID());
  const [search, setSearch] = useState(''); const [applicant, setApplicant] = useState<ComparecienteListItem | null>(null);
  const [rows, setRows] = useState<ComparecienteListItem[]>([]); const [context, setContext] = useState('');
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const inFlight = useRef(false);
  const canReadParties = user?.permissions?.includes('comparecientes.read') ?? false;
  useEffect(() => {
    if (initialProspectId || !canReadParties) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      void comparecientesService.list({ page: 1, pageSize: 20, sort: 'nombre:asc', ...(search.trim() ? { search: search.trim() } : {}) }, controller.signal)
        .then((result) => { if (!controller.signal.aborted) setRows(result.data); })
        .catch(() => { if (!controller.signal.aborted) setError('No pudimos buscar comparecientes. Puedes crear el borrador sin cliente y seleccionarlo después.'); })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [search, initialProspectId, canReadParties]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setSaving(true); setError('');
    try { onCreated(await quotesService.createDirect({ formalApplicantId: applicant?.id ?? null, operationContext: context.trim(), idempotencyKey: key, confirm: true })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos crear la cotización.'); }
    finally { inFlight.current = false; setSaving(false); }
  };
  if (initialProspectId) return <QuoteDrawer title="Nueva cotización desde Prospecto" onClose={onClose}>
    <p>Conserva los datos y documentos del prospecto utilizando su acción Convertir en cotización.</p>
    <Link className={styles.primaryButton} to={`/prospectos/${encodeURIComponent(initialProspectId)}`} onClick={onClose}>Ir al prospecto de origen</Link>
  </QuoteDrawer>;
  return <QuoteDrawer title="Nueva cotización" subtitle="Alta directa, sin crear un Prospecto." onClose={saving ? () => {} : onClose} footer={<>
    <button type="button" className={styles.secondaryButton} disabled={saving} onClick={onClose}>Cancelar</button>
    <button type="submit" form="direct-quote-form" className={styles.primaryButton} disabled={saving}>{saving && <LoaderCircle className={styles.spin} size={17} />}{saving ? 'Creando cotización…' : 'Crear cotización'}</button>
  </>}>
    <form id="direct-quote-form" className={styles.dialogForm} onSubmit={submit}>
      {error && <div role="alert" className={styles.formError}>{error}</div>}
      <p>Responsable inicial: <strong>{user?.name || 'Tu usuario actual'}</strong>. Se asignará folio automáticamente.</p>
      {canReadParties && <>
        <label><span>Buscar cliente (opcional)</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o RFC del compareciente" /></label>
        <label><span>Cliente / solicitante (opcional)</span><select value={applicant?.id || ''} disabled={loading || saving} onChange={(event) => setApplicant(rows.find((row) => row.id === event.target.value) || null)}>
          <option value="">{loading ? 'Buscando…' : 'Seleccionar después'}</option>
          {applicant && !rows.some((row) => row.id === applicant.id) && <option value={applicant.id}>{applicant.nombre}</option>}
          {rows.map((row) => <option key={row.id} value={row.id}>{row.nombre}</option>)}
        </select></label>
      </>}
      <label><span>Contexto de la operación (opcional)</span><textarea rows={3} maxLength={4000} value={context} disabled={saving} onChange={(event) => setContext(event.target.value)} /></label>
      <p className={styles.contractNotice}>El acto puede seleccionarse en la ficha. Será obligatorio antes de generar la cotización. No se crean presupuestos, pagos ni documentos al abrir este borrador.</p>
    </form>
  </QuoteDrawer>;
}
