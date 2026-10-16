import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { quotesService } from '../quotes.service';
import type { Quote, QuoteActTypeOption } from '../quotes.types';
import { QuoteActionDialog } from './QuoteActionDialog';
import styles from '../Quotes.module.css';

type Result = { id: string; numero_pravia?: string; idempotent?: boolean };

export function ConvertQuoteDialog({ quote, onClose, onDone }: { quote: Quote; onClose: () => void; onDone: (result: Result) => void }) {
  const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 23);
  const canonical = Boolean(quote.workflow?.stage);
  const [effectiveAt, setEffectiveAt] = useState(localNow);
  const [key] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [actTypes, setActTypes] = useState<QuoteActTypeOption[]>([]);
  const [selectedActId, setSelectedActId] = useState('');
  const [applicantRoles, setApplicantRoles] = useState<Record<string, string>>({});
  const [actsStatus, setActsStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [unavailableActNames, setUnavailableActNames] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    void quotesService.actTypes(controller.signal).then((types) => {
      if (canonical) {
        const accepted = quote.actos ?? [];
        const configured = accepted.map((item) => types.find((type) => type.id === item.tipo_acto_id));
        if (!accepted.length || configured.some((item) => !item)) {
          setUnavailableActNames(accepted.filter((_, index) => !configured[index]).map((item) => item.tipo_acto.nombre));
          setActsStatus('error');
          return;
        }
        setUnavailableActNames([]);
        setActTypes(configured as QuoteActTypeOption[]);
        setSelectedActId(accepted[0].tipo_acto_id);
      } else {
        const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('es-MX');
        const prospectAct = normalized(quote.prospecto?.tipo_acto || '');
        setActTypes(types);
        setSelectedActId(types.find((type) => normalized(type.nombre) === prospectAct)?.id || '');
      }
      setActsStatus('ready');
    }).catch((cause) => {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setActsStatus('error');
    });
    return () => controller.abort();
  }, [canonical, quote.actos, quote.prospecto?.tipo_acto]);

  const rolesConfirmed = !canonical || Boolean(quote.actos?.every((item) => applicantRoles[item.id]));
  const convert = async () => {
    if (!selectedActId) { setError('Selecciona el tipo de acto que tendrá el expediente.'); return; }
    if (!rolesConfirmed) { setError('Confirma la participación del solicitante formal en cada acto.'); return; }
    setSaving(true);
    setError('');
    try {
      const solicitanteCaracterPorActo = Object.fromEntries((quote.actos ?? []).map((item) => [
        item.id, applicantRoles[item.id] === 'NO_PARTICIPA' ? null : applicantRoles[item.id],
      ]));
      onDone(await quotesService.convert(quote.id, canonical
        ? { expectedVersion: quote.workflow!.version, idempotencyKey: key, confirm: true,
          effectiveAt: new Date(effectiveAt).toISOString(), tipoActoId: selectedActId, solicitanteCaracterPorActo }
        : { tipoActoId: selectedActId }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No se pudo crear el expediente.');
      setSaving(false);
    }
  };
  const missingCharacters = quote.conversion?.failures.some((failure) => failure.includes('caracteres de comparecientes'));
  const missingCharacterActId = quote.actos?.find((act) => !actTypes.find((type) => type.id === act.tipo_acto_id)?.tipoActoCaracteresCompareciente?.length)?.tipo_acto_id;

  return <QuoteActionDialog title="Convertir a expediente" description="Se creará un expediente con todos los actos aceptados, sin aplicar movimientos financieros." onClose={onClose} footer={<>
    <button type="button" className={styles.secondaryButton} onClick={onClose}>Cancelar</button>
    <button type="button" className={styles.primaryButton} disabled={saving || actsStatus !== 'ready' || !selectedActId || !rolesConfirmed || !quote.conversion?.eligible || (canonical && !effectiveAt)} onClick={convert}>
      {saving && <LoaderCircle className={styles.spin} size={17} />}Convertir en expediente
    </button>
  </>}>
    <dl className={styles.confirmationList}>
      <div><dt>Cliente</dt><dd>{quote.prospecto?.nombre || 'Sin cliente visible'}</dd></div>
      <div><dt>Actos</dt><dd>{actTypes.length ? actTypes.map((item) => item.nombre).join(' · ') : quote.prospecto?.tipo_acto || 'Sin especificar'}</dd></div>
      <div><dt>Solicitante formal</dt><dd>{quote.solicitante_formal?.nombre_busqueda || 'Sin confirmar'}</dd></div>
      <div><dt>Cotización</dt><dd>{quote.numero_cotizacion || quote.numero_solicitud}</dd></div>
      <div><dt>Responsable</dt><dd>{quote.creada_por?.nombre || 'Sin responsable visible'}</dd></div>
    </dl>
    <label className={styles.confirmDate}>
      <span>{canonical ? 'Acto principal del expediente' : 'Tipo de acto del expediente'}</span>
      <select aria-label="Tipo de acto del expediente" value={selectedActId} onChange={(event) => { setSelectedActId(event.target.value); setError(''); }} disabled={actsStatus !== 'ready'}>
        <option value="">{actsStatus === 'loading' ? 'Cargando catálogo…' : 'Selecciona un tipo de acto'}</option>
        {actTypes.map((type) => <option key={type.id} value={type.id}>{type.nombre}</option>)}
      </select>
      {canonical && <small>Los demás actos aceptados también se incorporarán al expediente.</small>}
    </label>
    {canonical && quote.actos?.map((act) => {
      const type = actTypes.find((item) => item.id === act.tipo_acto_id);
      return <label className={styles.confirmDate} key={act.id}>
        <span>Carácter de {quote.solicitante_formal?.nombre_busqueda || 'solicitante formal'} en {act.tipo_acto.nombre}</span>
        <select aria-label={`Carácter del solicitante en ${act.tipo_acto.nombre}`} value={applicantRoles[act.id] || ''} onChange={(event) => setApplicantRoles((current) => ({ ...current, [act.id]: event.target.value }))} disabled={actsStatus !== 'ready'}>
          <option value="">Selecciona su participación</option>
          <option value="NO_PARTICIPA">No participa como compareciente en este acto</option>
          {type?.tipoActoCaracteresCompareciente?.map((role) => <option key={role.caracter_id} value={role.caracter_id}>{role.caracter.nombre}</option>)}
        </select>
      </label>;
    })}
    {actsStatus === 'error' && <div className={styles.formError} role="alert">{canonical
      ? unavailableActNames.length
        ? `No se puede convertir: ${unavailableActNames.join(', ')} ${unavailableActNames.length === 1 ? 'no está disponible' : 'no están disponibles'} en el catálogo activo. Revisa estos actos antes de continuar.`
        : 'La cotización no tiene actos estructurados aceptados o disponibles. Corrige la cotización antes de convertir.'
      : 'No pudimos cargar el catálogo de actos. Cierra el diálogo e inténtalo nuevamente.'}</div>}
    {canonical && <label className={styles.confirmDate}><span>Fecha y hora efectiva</span><input type="datetime-local" step="0.001" max={localNow()} value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} required /></label>}
    {quote.conversion && !quote.conversion.eligible && <div className={styles.requirements}><strong>Requisitos pendientes</strong><ul>{quote.conversion.failures.map((failure) => <li key={failure}>{failure}</li>)}</ul>{missingCharacters && missingCharacterActId && <Link className={styles.secondaryButton} to={`/configuracion/actos-tiempos?focusAct=${encodeURIComponent(missingCharacterActId)}&returnTo=${encodeURIComponent(`/cotizaciones/${quote.id}`)}`}>Revisar caracteres del acto</Link>}</div>}
    {error && <div className={styles.formError} role="alert">{error}</div>}
  </QuoteActionDialog>;
}
