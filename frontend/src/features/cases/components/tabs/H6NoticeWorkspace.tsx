import { CheckCircle2, ExternalLink, FileCheck2, FileWarning, LoaderCircle, RefreshCw, Save, Send, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { complianceService, type H6NoticeWorkspace as Workspace } from '../../../compliance/compliance.service';
import { humanComplianceLabel } from '../../../compliance/complianceLabels';
import { dateTime } from '../../expedienteFormatters';
import styles from '../../Expedientes.module.css';

type Obligation = Workspace['obligations'][number];
type LocalField = NonNullable<Obligation['ficheRevisions'][number]['officialRevision']>['schema_json']['fields'][number];

const originHash = (source: Record<string, unknown>) => {
  const kind = String(source.type || source.entity || '').toUpperCase();
  if (kind.includes('PREDIO')) return 'predios';
  if (kind.includes('COMPARECIENTE') || kind.includes('SUBJECT')) return 'comparecientes';
  if (kind.includes('PAYMENT') || kind.includes('PAGO')) return 'finanzas';
  if (kind.includes('ISR')) return 'isr';
  if (kind.includes('ACT')) return 'actos';
  return 'cumplimiento';
};

function NoticeCard({ obligation, documents, canWrite, busy, perform }: {
  obligation: Obligation;
  documents: Workspace['acknowledgement_documents'];
  canWrite: boolean;
  busy: string;
  perform(key: string, task: () => Promise<unknown>, success: string): Promise<void>;
}) {
  const fiche = obligation.ficheRevisions[0];
  const product = obligation.officialProducts[0];
  const presentation = obligation.presentations[0];
  const fields: LocalField[] = useMemo(() => fiche?.officialRevision?.schema_json.fields || [], [fiche]);
  const localFields = fields.filter((field) => field.authority === 'NOTICE_LOCAL_FIELD');
  const missing = fields.filter((field) => field.required && (field.authority === 'MASTER_SOURCE'
    ? !fiche?.source_manifest.some((source) => String(source.path) === String(field.path))
    : fiche?.local_values[field.key] === undefined || fiche?.local_values[field.key] === '')).map((field) => field.label || field.key);
  const [localValues, setLocalValues] = useState<Record<string, unknown>>(fiche?.local_values || {});
  const [ackDocument, setAckDocument] = useState('');
  const [ackType, setAckType] = useState('Acuse de recepción');
  const [ackDate, setAckDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [presentationKind, setPresentationKind] = useState<'NORMAL' | 'COMPLEMENTARIA' | 'CORRECCION'>('NORMAL');
  const [previousPresentationId, setPreviousPresentationId] = useState('');
  const [externalFolio, setExternalFolio] = useState('');
  useEffect(() => setLocalValues(fiche?.local_values || {}), [fiche?.id, fiche?.version]);
  const title = obligation.projectedRequirements[0]?.label || 'Aviso o declaración';
  return <article className={styles.h6NoticeCard}>
    <header><span className={obligation.avi_state === 'CUMPLIDO' ? styles.complianceOk : styles.complianceAlert}>{obligation.avi_state === 'CUMPLIDO' ? <CheckCircle2 /> : <ShieldCheck />}</span><div><h3>{title}</h3><p>{obligation.channel_code || 'Canal por configurar'}</p></div><strong>{humanComplianceLabel(obligation.avi_state, 'Pendiente')}</strong></header>
    <dl><div><dt>Actualidad</dt><dd>{obligation.freshness === 'CURRENT' ? 'Vigente' : 'Revisión necesaria'}</dd></div><div><dt>Plazo</dt><dd>{obligation.due_at ? dateTime(obligation.due_at) : 'Sin plazo configurado'}</dd></div><div><dt>Producto</dt><dd>{product ? 'Generado' : 'Pendiente'}</dd></div><div><dt>Presentación</dt><dd>{presentation ? `${humanComplianceLabel(presentation.kind, 'Registrada')} · ${dateTime(presentation.presented_at)}` : 'No registrada'}</dd></div><div><dt>Acuses</dt><dd>{presentation ? presentation.acknowledgements.length : 0}</dd></div></dl>
    {obligation.presentations.length > 0 && <section className={styles.h6PresentationHistory} aria-label={`Historial de presentaciones de ${title}`}><h4>Historial de presentaciones</h4><ol>{obligation.presentations.map((item, index) => <li key={item.id}><div><strong>{humanComplianceLabel(item.kind, 'Presentación')}</strong><span>{dateTime(item.presented_at)}</span></div><dl><div><dt>Folio</dt><dd>{item.external_folio || 'Sin folio'}</dd></div><div><dt>Producto</dt><dd>{item.product ? `${item.product.adapter_version} · ${item.product.checksum.slice(0, 8)}` : 'Registro histórico'}</dd></div><div><dt>Versión</dt><dd>{item.ficheRevision?.revision_number ?? 'Histórica'}</dd></div><div><dt>Acuses</dt><dd>{item.acknowledgements.length}</dd></div><div><dt>Anterior</dt><dd>{item.previous_presentation_id ? `#${obligation.presentations.findIndex((candidate) => candidate.id === item.previous_presentation_id) + 1}` : 'No aplica'}</dd></div><div><dt>Registro</dt><dd>#{obligation.presentations.length - index}</dd></div></dl></li>)}</ol></section>}
    {missing.length > 0 && <div className={styles.h6Missing}><strong>Faltantes</strong><ul>{missing.map((item) => <li key={item}>{item}</li>)}</ul></div>}
    {obligation.review_needed && <p className={styles.h6ReviewNeeded}><FileWarning />Las fuentes cambiaron después de presentar. Revisa si corresponde una acción humana.</p>}
    {fiche && <details className={styles.h6Sources}><summary>Fuentes utilizadas ({fiche.source_manifest.length})</summary>{fiche.source_manifest.length ? <ul>{fiche.source_manifest.map((source, index) => <li key={`${String(source.path)}-${index}`}><span>{String(source.entity || source.type || 'Fuente maestra')}</span><small>{String(source.path || 'Dato canónico')} · solo lectura</small><button type="button" onClick={() => { window.location.hash = originHash(source); }}><ExternalLink />Ir al origen</button></li>)}</ul> : <p>Esta ficha no consumió fuentes maestras.</p>}</details>}
    {fiche?.status === 'DRAFT' && localFields.length > 0 && <fieldset className={styles.h6LocalFields}><legend>Datos propios del aviso</legend>{localFields.map((field) => <label key={field.key}><span>{field.label || field.key}{field.required ? ' *' : ''}</span>{field.input_type === 'boolean' || field.type === 'boolean' ? <input type="checkbox" checked={Boolean(localValues[field.key])} onChange={(event) => setLocalValues((current) => ({ ...current, [field.key]: event.target.checked }))} /> : <input type={field.input_type === 'date' || field.type === 'date' ? 'date' : field.input_type === 'number' || ['integer', 'number'].includes(String(field.type)) ? 'number' : 'text'} maxLength={field.max_length} value={String(localValues[field.key] ?? '')} onChange={(event) => setLocalValues((current) => ({ ...current, [field.key]: event.target.value }))} />}</label>)}</fieldset>}
    {canWrite && presentation && <fieldset className={styles.h6AckFields}><legend>Registrar acuse</legend><label><span>Documento</span><select aria-label={`Documento de acuse para ${title}`} value={ackDocument} onChange={(event) => setAckDocument(event.target.value)}><option value="">Selecciona un documento</option>{documents.map((document) => <option key={document.id} value={document.id}>{document.nombre_original}</option>)}</select></label><label><span>Tipo</span><input value={ackType} onChange={(event) => setAckType(event.target.value)} /></label><label><span>Fecha de recepción</span><input type="date" value={ackDate} onChange={(event) => setAckDate(event.target.value)} /></label><button type="button" disabled={Boolean(busy) || !ackDocument || !ackType.trim() || !ackDate} onClick={() => void perform(`ack-${presentation.id}`, () => complianceService.h6RegisterAcknowledgement(presentation.id, { documento_id: ackDocument, acknowledgement_type: ackType.trim(), received_at: new Date(`${ackDate}T12:00:00`).toISOString(), idempotency_key: crypto.randomUUID() }), 'Acuse vinculado a la presentación seleccionada.')}>{busy === `ack-${presentation.id}` ? <LoaderCircle className={styles.spin} /> : <FileCheck2 />}Registrar acuse</button></fieldset>}
    {canWrite && product && <fieldset className={styles.h6PresentationFields}><legend>Nueva presentación</legend><label><span>Tipo</span><select value={presentationKind} onChange={(event) => { const kind = event.target.value as typeof presentationKind; setPresentationKind(kind); if (kind === 'NORMAL') setPreviousPresentationId(''); }}><option value="NORMAL">Normal</option><option value="COMPLEMENTARIA">Complementaria</option><option value="CORRECCION">Corrección</option></select></label><label><span>Presentación anterior (opcional)</span><select disabled={presentationKind === 'NORMAL'} value={previousPresentationId} onChange={(event) => setPreviousPresentationId(event.target.value)}><option value="">Sin referencia anterior</option>{obligation.presentations.map((item) => <option key={item.id} value={item.id}>{humanComplianceLabel(item.kind, 'Presentación')} · {dateTime(item.presented_at)}</option>)}</select></label><label><span>Folio externo (opcional)</span><input value={externalFolio} onChange={(event) => setExternalFolio(event.target.value)} /></label><button type="button" disabled={Boolean(busy)} onClick={() => void perform(`present-${product.id}`, () => complianceService.h6RegisterPresentation(obligation.id, { product_id: product.id, kind: presentationKind, previous_presentation_id: presentationKind === 'NORMAL' ? null : previousPresentationId || null, external_folio: externalFolio.trim() || null, presented_at: new Date().toISOString(), idempotency_key: crypto.randomUUID(), metadata: { explicit_human_action: true } }), 'Presentación registrada. El cumplimiento depende de la política de evidencia.')}>{busy === `present-${product.id}` ? <LoaderCircle className={styles.spin} /> : <Send />}Registrar presentación</button></fieldset>}
    {canWrite && obligation.avi_state !== 'NO_APLICA' && <footer>
      {!fiche && <button type="button" disabled={Boolean(busy)} onClick={() => void perform(`fiche-${obligation.id}`, () => complianceService.h6EnsureFiche(obligation.id), 'Ficha preparada desde fuentes canónicas.')}>{busy === `fiche-${obligation.id}` && <LoaderCircle className={styles.spin} />}Preparar ficha</button>}
      {fiche?.status === 'DRAFT' && <><button type="button" disabled={Boolean(busy)} onClick={() => void perform(`save-${fiche.id}`, () => complianceService.h6SaveFiche(obligation.id, fiche.id, { expected_version: fiche.version, local_values: localValues }), 'Datos locales guardados.')}>{busy === `save-${fiche.id}` ? <LoaderCircle className={styles.spin} /> : <Save />}Guardar ficha</button><button type="button" disabled={Boolean(busy) || missing.length > 0} onClick={() => void perform(`validate-${fiche.id}`, async () => { const saved: any = await complianceService.h6SaveFiche(obligation.id, fiche.id, { expected_version: fiche.version, local_values: localValues }); return complianceService.h6FinalizeFiche(obligation.id, fiche.id, { expected_version: saved.version }); }, 'Ficha validada y congelada.')}>{busy === `validate-${fiche.id}` ? <LoaderCircle className={styles.spin} /> : <FileCheck2 />}Validar ficha</button></>}
      {fiche?.status === 'VALIDATED' && !product && <button type="button" disabled={Boolean(busy)} onClick={() => void perform(`product-${fiche.id}`, () => complianceService.h6GenerateProduct(obligation.id, { fiche_revision_id: fiche.id, idempotency_key: crypto.randomUUID() }), 'Producto oficial generado; aún no está presentado.')}>{busy === `product-${fiche.id}` ? <LoaderCircle className={styles.spin} /> : <FileCheck2 />}Generar producto</button>}
    </footer>}
  </article>;
}

export function H6NoticeWorkspace({ expedienteId, canWrite }: { expedienteId: string; canWrite: boolean }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(''); const [message, setMessage] = useState('');
  const load = useCallback(async (signal?: AbortSignal) => { try { setWorkspace(await complianceService.h6Workspace(expedienteId, signal)); setStatus('ready'); } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); } }, [expedienteId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const perform = async (key: string, task: () => Promise<unknown>, success: string) => { setBusy(key); setMessage(''); try { await task(); await load(); setMessage(success); } catch (error) { setMessage(error instanceof Error ? error.message : 'No fue posible completar la acción.'); } finally { setBusy(''); } };
  if (status === 'loading') return <section className={styles.sectionCard}><p className={styles.sectionEmpty} role="status"><LoaderCircle className={styles.spin} />Preparando Avisos / Declaraciones…</p></section>;
  if (status === 'error') return <section className={styles.sectionCard}><p className={styles.sectionEmpty} role="alert">No pudimos consultar Avisos / Declaraciones dentro de tus permisos.</p></section>;
  return <section className={styles.sectionCard} aria-labelledby="h6-notices-title"><header><div><h2 id="h6-notices-title">Avisos / Declaraciones</h2><p>Obligaciones, fichas, productos y presentaciones con historial verificable.</p></div></header>{message && <p className={styles.complianceDocumentMessage} role="status">{message}</p>}{workspace?.post_sign_materialization === 'EN_PROCESO' && <p className={styles.complianceDocumentMessage} role="status"><RefreshCw className={styles.spin} />Preparando obligaciones posteriores a la firma…</p>}{!workspace?.obligations.length && <p className={styles.sectionEmpty}>No hay avisos o declaraciones aplicables registrados para este expediente.</p>}<div className={styles.h6NoticeGrid}>{workspace?.obligations.map((obligation) => <NoticeCard key={obligation.id} obligation={obligation} documents={workspace.acknowledgement_documents} canWrite={canWrite} busy={busy} perform={perform} />)}</div></section>;
}
