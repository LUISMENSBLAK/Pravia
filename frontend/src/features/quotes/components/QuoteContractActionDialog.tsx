import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { comparecientesService } from '../../comparecientes/comparecientes.service';
import type { ComparecienteListItem } from '../../comparecientes/comparecientes.types';
import { quotesService } from '../quotes.service';
import type { Quote, QuoteContractAction } from '../quotes.types';
import { QuoteActionDialog } from './QuoteActionDialog';
import styles from '../Quotes.module.css';

type DialogAction = 'COMENZAR_ELABORACION' | 'INICIAR_SEGUIMIENTO' | 'ACEPTAR' | 'RECHAZAR' | 'SUSPENDER' | 'CANCELAR';
const config: Record<DialogAction, { title: string; description: string; submit: string; destructive?: boolean }> = {
  COMENZAR_ELABORACION: { title: 'Comenzar elaboración', description: 'Inicia la preparación de la cotización y su presupuesto estructurado.', submit: 'Comenzar elaboración' },
  INICIAR_SEGUIMIENTO: { title: 'Iniciar seguimiento', description: 'Registra que la cotización enviada entra en seguimiento con el cliente.', submit: 'Iniciar seguimiento' },
  ACEPTAR: { title: 'Registrar aceptación', description: 'Registra la aceptación comercial y conserva un snapshot inmutable de ese momento.', submit: 'Confirmar aceptación' },
  RECHAZAR: { title: 'Registrar rechazo', description: 'Conserva la cotización y su historia como registro rechazado.', submit: 'Registrar rechazo', destructive: true },
  SUSPENDER: { title: 'Suspender cotización', description: 'La cotización conservará su historia, fuente, documentos y relaciones.', submit: 'Suspender', destructive: true },
  CANCELAR: { title: 'Cancelar cotización', description: 'La cancelación no elimina la cotización ni sus documentos, pagos o auditoría.', submit: 'Cancelar cotización', destructive: true },
};

const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 23);
export type QuoteAcceptanceResume = { applicantId: string; applicantName: string; effectiveAt: string; reason: string; confirmedActIds: string[] };

export function QuoteContractActionDialog({ quote, action, resume, onClose, onDone }: {
  quote: Quote;
  action: DialogAction;
  resume?: QuoteAcceptanceResume | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const copy = config[action];
  const [effectiveAt, setEffectiveAt] = useState(() => resume?.effectiveAt || localNow());
  const [reason, setReason] = useState(resume?.reason || '');
  const [key] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmedActIds, setConfirmedActIds] = useState(() => resume?.confirmedActIds ?? quote.actos?.map((item) => item.id) ?? []);
  const [formalApplicantId, setFormalApplicantId] = useState(resume?.applicantId || quote.solicitante_formal?.id || '');
  const [formalApplicantName, setFormalApplicantName] = useState(resume?.applicantName || quote.solicitante_formal?.nombre_busqueda || '');
  const [applicantSearch, setApplicantSearch] = useState('');
  const [applicants, setApplicants] = useState<ComparecienteListItem[]>([]);
  const [loadingApplicants, setLoadingApplicants] = useState(action === 'ACEPTAR');
  useEffect(() => {
    if (action !== 'ACEPTAR') return;
    const controller = new AbortController();
    const search = applicantSearch.trim();
    setLoadingApplicants(true);
    const load = () => { void comparecientesService.list({ page: 1, pageSize: 20, sort: 'nombre:asc', ...(search ? { search } : {}) }, controller.signal)
      .then((result) => { if (!controller.signal.aborted) setApplicants(result.data); })
      .catch((cause) => { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError('No pudimos buscar los comparecientes de esta Notaría.'); })
      .finally(() => { if (!controller.signal.aborted) setLoadingApplicants(false); }); };
    const timer = search ? window.setTimeout(load, 180) : null;
    if (!search) load();
    return () => { if (timer !== null) window.clearTimeout(timer); controller.abort(); };
  }, [action, applicantSearch]);
  const selectedApplicant = applicants.find((item) => item.id === formalApplicantId);
  const selectedApplicantName = selectedApplicant?.nombre || formalApplicantName || 'Compareciente seleccionado';
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!effectiveAt || !quote.workflow) return;
    if (action === 'ACEPTAR' && (!quote.actos?.length || confirmedActIds.length !== quote.actos.length || !formalApplicantId)) {
      return setError('Confirma todos los actos y selecciona un solicitante formal.');
    }
    setSaving(true); setError('');
    try {
      await quotesService.contractAction(quote.id, {
        action: action as Exclude<QuoteContractAction, 'CONVERTIR'>,
        expectedVersion: quote.workflow.version,
        idempotencyKey: key,
        confirm: true,
        effectiveAt: new Date(effectiveAt).toISOString(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        ...(action === 'ACEPTAR' ? { confirmedActIds, formalApplicantId } : {}),
      });
      onDone();
    } catch (caught) {
      setError(caught && typeof caught === 'object' && 'message' in caught ? String((caught as Error).message) : 'No pudimos registrar la acción. Actualiza la ficha e inténtalo de nuevo.');
      setSaving(false);
    }
  };
  return <QuoteActionDialog title={copy.title} description={copy.description} onClose={onClose} footer={<><button type="button" className={styles.secondaryButton} onClick={onClose}>Volver</button><button type="submit" form="contract-action-form" className={copy.destructive ? styles.dangerButton : styles.primaryButton} disabled={saving || loadingApplicants}>{saving && <LoaderCircle className={styles.spin} size={17} />}{copy.submit}</button></>}>
    <form id="contract-action-form" className={styles.dialogForm} onSubmit={submit}>
      {error && <div className={styles.formError} role="alert">{error}</div>}
      <label><span>Fecha y hora efectiva</span><input type="datetime-local" step="0.001" max={localNow()} value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required /></label>
      <label><span>Nota opcional</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Contexto operativo, si aplica." /></label>
      {action === 'ACEPTAR' && <><fieldset className={styles.acceptanceActs}><legend>Confirma los actos aceptados</legend>{quote.actos?.length ? quote.actos.map((act) => <label key={act.id}><input type="checkbox" checked={confirmedActIds.includes(act.id)} onChange={(event) => setConfirmedActIds((current) => event.target.checked ? [...current, act.id] : current.filter((id) => id !== act.id))} /><span>{act.tipo_acto.nombre}</span></label>) : <p>Esta cotización no tiene actos estructurados; debe corregirse antes de aceptarla.</p>}</fieldset><label><span>Buscar compareciente</span><input type="search" value={applicantSearch} onChange={(event) => setApplicantSearch(event.target.value)} placeholder="Nombre o RFC" /></label><label><span>Solicitante formal</span><select value={formalApplicantId} onChange={(event) => { const nextId = event.target.value; setFormalApplicantId(nextId); setFormalApplicantName(applicants.find((item) => item.id === nextId)?.nombre || (nextId === formalApplicantId ? formalApplicantName : '')); }} required disabled={loadingApplicants}><option value="">{loadingApplicants ? 'Buscando comparecientes…' : 'Selecciona un compareciente existente'}</option>{formalApplicantId && !selectedApplicant && <option value={formalApplicantId}>{selectedApplicantName}</option>}{applicants.map((item) => <option key={item.id} value={item.id}>{item.nombre} · {item.tipo_persona === 'FISICA' ? 'Persona física' : 'Persona moral'}</option>)}</select></label>{user?.permissions?.includes('comparecientes.write') && <Link className={styles.secondaryButton} to={`/comparecientes/nuevo?fromQuote=${encodeURIComponent(quote.id)}`} state={{ quoteAcceptanceDraft: { effectiveAt, reason, confirmedActIds } }}>Agregar compareciente</Link>}<p className={styles.contractNotice}>Busca en el catálogo de la Notaría; se muestran las primeras 20 coincidencias. La aceptación conserva un snapshot inmutable y deja acreditados los actos y el solicitante formal que heredará el expediente.</p></>}
    </form>
  </QuoteActionDialog>;
}
