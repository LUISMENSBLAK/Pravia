import { useId, useState } from "react";
import { complianceService } from "../compliance.service";
import styles from "../Compliance.module.css";

export const h5PaymentFields = [
  ["amount_original", "Importe original", "decimal"], ["currency_original", "Moneda original (ISO)", "text"],
  ["payment_date", "Fecha del pago", "date"], ["method_raw", "Método declarado", "text"],
  ["institution", "Institución", "text"], ["payer_raw", "Ordenante o pagador declarado", "text"],
  ["payee_raw", "Beneficiario o receptor declarado", "text"], ["reference", "Referencia", "text"],
  ["account_number", "Cuenta para comparar (sólo se conserva terminación y huella)", "text"],
  ["declared_paid", "Pagado declarado en soporte", "decimal"], ["declared_pending", "Pendiente declarado en soporte", "decimal"],
] as const;
const roleLabels: Record<string, string> = { PAYER: "Pagador", PAYEE: "Receptor", PROVIDER_RESOURCE: "Proveedor de recursos propuesto" };

export function H5PaymentEditor({ data, payment, proposal, canConfirm, onRefresh }: { data: any; payment?: any; proposal?: any; canConfirm: boolean; onRefresh: () => Promise<void> }) {
  const prefix = useId();
  const current = payment?.currentRevision;
  const initial = proposal?.content || current || {};
  const [values, setValues] = useState<Record<string, any>>(() => Object.fromEntries(h5PaymentFields.map(([key]) => [key, key === "payment_date" ? String(initial[key] || "").slice(0, 10) : initial[key] ?? ""])));
  const [unknown, setUnknown] = useState<Record<string, boolean>>(() => Object.fromEntries(h5PaymentFields.map(([key]) => [key, initial.field_states?.[key] === "CONFIRMED_UNKNOWN"])));
  const [scope, setScope] = useState(current?.scope || "GENERAL_INSTRUMENT");
  const [actIds, setActIds] = useState<string[]>(current?.acts?.map((item: any) => item.expediente_acto_id) || []);
  const [evidenceIds, setEvidenceIds] = useState<string[]>(current?.evidence?.map((item: any) => item.evidence_id) || []);
  const [parties, setParties] = useState<any[]>(current?.parties?.map((item: any) => ({ expediente_compareciente_id: item.expediente_compareciente_id, role: item.role })) || []);
  const [fx, setFx] = useState<Record<string, any>>({ exchange_rate: current?.exchange_rate || "", exchange_rate_date: String(current?.exchange_rate_date || "").slice(0, 10), exchange_rate_source: current?.exchange_rate_source || "", exchange_rate_criterion: current?.exchange_rate_criterion || "", exchange_rate_unknown: current?.exchange_rate == null });
  const [confirmed, setConfirmed] = useState(false);
  const [acceptExtractedAccount, setAcceptExtractedAccount] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const toggle = (items: string[], id: string, checked: boolean) => checked ? [...new Set([...items, id])] : items.filter((item) => item !== id);
  const save = async (confirm: boolean) => {
    setBusy(true); setMessage("");
    const fields = Object.fromEntries(h5PaymentFields.map(([key]) => [key, unknown[key] ? null : values[key] || null]));
    const field_states = Object.fromEntries(h5PaymentFields.filter(([key]) => unknown[key] || Boolean(values[key])).map(([key]) => [key, unknown[key] ? "CONFIRMED_UNKNOWN" : "VALUE"]));
    const reviewed = { ...fields, ...fx, scope, expediente_acto_ids: scope === "EXPLICIT_ACT_SET" ? actIds : [], evidence_ids: evidenceIds, parties, field_states,
      account_unchanged: Boolean(current?.account_last4 && !acceptExtractedAccount && !unknown.account_number && !values.account_number),
      accept_extracted_account: acceptExtractedAccount,
      payment_id: payment?.id || null, base_fingerprint: current?.semantic_fingerprint || null, confirm,
      idempotency_key: `${requestId}:${confirm ? "confirm" : "draft"}` };
    try {
      if (proposal) await complianceService.confirmH5PaymentProposal(proposal.id, { proposal_fingerprint: proposal.proposal_fingerprint, confirmed_fields: reviewed, idempotency_key: reviewed.idempotency_key });
      else await complianceService.saveH5Payment(data.review_id, reviewed);
      await onRefresh(); setMessage(confirm ? "Nueva revisión confirmada." : "Borrador guardado.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "No fue posible guardar el pago."); }
    finally { setBusy(false); }
  };
  return <details className={styles.h5Editor} open={proposal ? true : undefined}>
    <summary>{proposal ? "Revisar propuesta documental" : payment ? "Editar mediante nueva revisión" : "Registrar pago de la operación"}</summary>
    <form onSubmit={(event) => { event.preventDefault(); void save(false); }}>
      {proposal && <><p>Propuesta sin efectos en el pago. Revisa o corrige cada dato; un campo ausente no significa “No identificado” hasta tu confirmación.</p>
        <dl>{h5PaymentFields.map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{proposal.content?.field_states?.[key]?.state === "PRESENT" ? "Lectura presente" : proposal.content?.field_states?.[key]?.state === "ABSENT" ? "No aparece en la fuente" : "Requiere revisión"}
          {(proposal.field_provenance?.[key] || []).map((source: any, index: number) => <small key={index}> · {data.evidence?.find((item: any) => item.documento_id === source.document_id || item.documento?.id === source.document_id)?.documento?.nombre_original || `Documento fuente ${index + 1}`} · {source.page ? `página ${source.page}` : "página no indicada"}</small>)}</dd></div>)}</dl></>}
      <fieldset disabled={busy} onChange={() => setConfirmed(false)}><legend>{payment ? "Nueva revisión · el historial se conserva" : "Hechos del pago"}</legend>
        <div className={styles.h5FormGrid}>{h5PaymentFields.map(([key, label, type]) => <div key={key} className={styles.h5Field}>
          <label htmlFor={`${prefix}-${key}`}>{label}</label><input id={`${prefix}-${key}`} type={type === "date" ? "date" : "text"} inputMode={type === "decimal" ? "decimal" : undefined} autoComplete="off" disabled={unknown[key]} value={values[key]} onChange={(event) => { if (key === "account_number") setAcceptExtractedAccount(false); setValues((old) => ({ ...old, [key]: event.target.value })); }} />
          {key === "account_number" && current?.account_last4 && <small>Actual: terminación {current.account_last4}. Déjala vacía para conservarla.</small>}
          {key === "account_number" && proposal?.content?.account_last4 && <label className={styles.h5Check}><input type="checkbox" checked={acceptExtractedAccount} disabled={unknown.account_number || Boolean(values.account_number)} onChange={(event) => setAcceptExtractedAccount(event.target.checked)} />Confirmo la cuenta extraída con terminación {proposal.content.account_last4}</label>}
          <label className={styles.h5Check}><input type="checkbox" checked={unknown[key]} onChange={(event) => { if (key === "account_number") setAcceptExtractedAccount(false); setUnknown((old) => ({ ...old, [key]: event.target.checked })); }} />{label}: no identificado tras revisión humana</label>
        </div>)}</div>
        <label htmlFor={`${prefix}-scope`}>Alcance del pago</label><select id={`${prefix}-scope`} value={scope} onChange={(event) => setScope(event.target.value)}><option value="GENERAL_INSTRUMENT">Instrumento general</option><option value="EXPLICIT_ACT_SET">Actos seleccionados</option></select>
        {scope === "EXPLICIT_ACT_SET" && <fieldset><legend>Actos del expediente</legend>{data.acts?.map((act: any) => <label className={styles.h5Check} key={act.id}><input type="checkbox" checked={actIds.includes(act.id)} onChange={(event) => setActIds(toggle(actIds, act.id, event.target.checked))} />{act.tipo_acto?.nombre || "Acto del expediente"}</label>)}</fieldset>}
        {String(values.currency_original).toUpperCase() !== "MXN" && values.currency_original && <fieldset><legend>Conversión documental, no política jurídica oficial</legend>
          <label className={styles.h5Check}><input type="checkbox" checked={fx.exchange_rate_unknown} onChange={(event) => setFx((old) => ({ ...old, exchange_rate_unknown: event.target.checked, ...(event.target.checked ? { exchange_rate: "" } : {}) }))} />Tipo de cambio no disponible</label>
          {!fx.exchange_rate_unknown && [["exchange_rate", "Tipo de cambio"], ["exchange_rate_date", "Fecha de conversión"], ["exchange_rate_source", "Fuente"], ["exchange_rate_criterion", "Criterio confirmado"]].map(([key, label]) => <label key={key}>{label}<input type={key === "exchange_rate_date" ? "date" : "text"} value={fx[key]} onChange={(event) => setFx((old) => ({ ...old, [key]: event.target.value }))} /></label>)}
        </fieldset>}
        <fieldset><legend>Recibos y soportes existentes</legend>{data.evidence?.map((item: any) => <label className={styles.h5Check} key={item.id}><input type="checkbox" checked={evidenceIds.includes(item.id)} onChange={(event) => setEvidenceIds(toggle(evidenceIds, item.id, event.target.checked))} />{item.documento?.nombre_original || "Soporte documental"}</label>)}</fieldset>
        <fieldset><legend>Personas vinculadas al pago</legend>{parties.map((party, index) => <div className={styles.h5FormGrid} key={index}>
          <label>Compareciente<select value={party.expediente_compareciente_id} onChange={(event) => setParties((old) => old.map((item, row) => row === index ? { ...item, expediente_compareciente_id: event.target.value } : item))}><option value="">Seleccionar persona vinculada</option>{data.provider_candidates?.map((item: any) => <option key={item.id} value={item.id}>{item.compareciente?.nombre_busqueda || "Compareciente"} · {item.caracter?.clave === "PROVEEDOR_RECURSOS" ? "Proveedor de recursos" : "Comparecencia existente"}</option>)}</select></label>
          <label>Participación en el pago<select value={party.role} onChange={(event) => setParties((old) => old.map((item, row) => row === index ? { ...item, role: event.target.value } : item))}>{Object.entries(roleLabels).map(([role, label]) => <option key={role} value={role}>{label}</option>)}</select></label>
          <button type="button" onClick={() => { setConfirmed(false); setParties((old) => old.filter((_, row) => row !== index)); }}>Quitar persona {index + 1}</button>
        </div>)}<button type="button" onClick={() => { setConfirmed(false); setParties((old) => [...old, { expediente_compareciente_id: "", role: "PAYER" }]); }}>Añadir persona al pago</button>
        <p>Un ordenante no se convierte automáticamente en Proveedor de Recursos. El rol adicional exige una regla verificada y confirmación humana.</p></fieldset>
        {!proposal && <button type="submit">Guardar borrador de pago</button>}
      </fieldset>
      {canConfirm && <><label className={styles.h5Check}><input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} />He revisado los datos, los soportes y los campos no identificados.</label>
        <button type="button" disabled={busy || !confirmed} onClick={() => void save(true)}>Confirmar revisión del pago</button></>}
      {proposal && <button type="button" disabled={busy} onClick={() => { setBusy(true); setMessage(""); void complianceService.rejectH5PaymentProposal(proposal.id, { proposal_fingerprint: proposal.proposal_fingerprint }).then(onRefresh).catch((error) => setMessage(error.message)).finally(() => setBusy(false)); }}>Rechazar propuesta sin modificar el pago</button>}
      <p role="status" aria-live="polite">{busy ? "Guardando…" : message}</p>
    </form>
  </details>;
}

export function H5PaymentVerification({ data, payment, onRefresh }: { data: any; payment: any; onRefresh: () => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [confirmed, setConfirmed] = useState(false);
  return <details className={styles.h5Editor}><summary>Verificar contra proyecto o escritura</summary><form onSubmit={(event) => {
    event.preventDefault(); setBusy(true); setMessage(""); const document = data.project_versions?.find((item: any) => item.id === values.project_document_id);
    void complianceService.verifyH5Payment(payment.currentRevision.id, { ...values, project_document_checksum: document?.checksum_sha256, confirm: true, idempotency_key: crypto.randomUUID() }).then(async () => { await onRefresh(); setMessage("Verificación registrada; las diferencias son observaciones, no conclusiones jurídicas."); }).catch((error) => setMessage(error.message)).finally(() => setBusy(false));
  }}>
    <fieldset disabled={busy} onChange={() => setConfirmed(false)}><legend>Hechos confirmados de la versión exacta</legend><label>Proyecto o escritura<select required value={values.project_document_id || ""} onChange={(event) => setValues((old) => ({ ...old, project_document_id: event.target.value }))}><option value="">Seleccionar versión</option>{data.project_versions?.map((item: any) => <option value={item.id} key={item.id}>{item.nombre_original}</option>)}</select></label>
      {[["consideration_amount", "Contraprestación confirmada"], ["consideration_currency", "Moneda de comparación (ISO)"], ["instrument_paid", "Pagado declarado en instrumento"], ["instrument_pending", "Pendiente declarado en instrumento"]].map(([key, label]) => <label key={key}>{label}<input required value={values[key] || ""} onChange={(event) => setValues((old) => ({ ...old, [key]: event.target.value }))} /></label>)}
    </fieldset><label className={styles.h5Check}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />Confirmo estos hechos en la versión seleccionada.</label><button disabled={busy || !confirmed}>Registrar verificación</button><p role="status">{busy ? "Verificando…" : message}</p>
  </form></details>;
}
