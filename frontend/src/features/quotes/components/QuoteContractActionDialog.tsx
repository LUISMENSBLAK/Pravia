import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle } from 'lucide-react';
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

export function QuoteContractActionDialog({ quote, action, onClose, onDone }: {
  quote: Quote;
  action: DialogAction;
  onClose: () => void;
  onDone: () => void;
}) {
  const copy = config[action];
  const [effectiveAt, setEffectiveAt] = useState(localNow);
  const [reason, setReason] = useState('');
  const [key] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmedActIds, setConfirmedActIds] = useState(() => quote.actos?.map((item) => item.id) ?? []);
  const [formalApplicantId, setFormalApplicantId] = useState(quote.solicitante_formal?.id ?? '');
  const [applicants, setApplicants] = useState<ComparecienteListItem[]>([]);
  const [loadingApplicants, setLoadingApplicants] = useState(action === 'ACEPTAR');
  useEffect(() => {
    if (action !== 'ACEPTAR') return;
    const controller = new AbortController();
    comparecientesService.list({ page: 1, pageSize: 100, sort: 'nombre:asc' }, controller.signal)
      .then((result) => setApplicants(result.data))
      .catch((cause) => { if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError('No pudimos cargar los comparecientes de esta Notaría.'); })
      .finally(() => setLoadingApplicants(false));
    return () => controller.abort();
  }, [action]);
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
      {action === 'ACEPTAR' && <><fieldset className={styles.acceptanceActs}><legend>Confirma los actos aceptados</legend>{quote.actos?.length ? quote.actos.map((act) => <label key={act.id}><input type="checkbox" checked={confirmedActIds.includes(act.id)} onChange={(event) => setConfirmedActIds((current) => event.target.checked ? [...current, act.id] : current.filter((id) => id !== act.id))} /><span>{act.tipo_acto.nombre}</span></label>) : <p>Esta cotización no tiene actos estructurados; debe corregirse antes de aceptarla.</p>}</fieldset><label><span>Solicitante formal</span><select value={formalApplicantId} onChange={(event) => setFormalApplicantId(event.target.value)} required disabled={loadingApplicants}><option value="">{loadingApplicants ? 'Cargando comparecientes…' : 'Selecciona un compareciente existente'}</option>{applicants.map((item) => <option key={item.id} value={item.id}>{item.nombre} · {item.tipo_persona === 'FISICA' ? 'Persona física' : 'Persona moral'}</option>)}</select></label><p className={styles.contractNotice}>La aceptación conserva un snapshot inmutable y deja acreditados los actos y el solicitante formal que heredará el expediente.</p></>}
    </form>
  </QuoteActionDialog>;
}
