import { useState } from 'react';
import { isrService } from './isr.service';
import type { ISRV3PartyResult } from './isr.types';
import styles from './ISRSurcharges.module.css';

const money = (value: unknown) => typeof value === 'string' && value !== '' && Number.isFinite(Number(value)) ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value)) : 'Sin información';
export function ISRSurcharges({ calculationId, version, parties, disabled }: { calculationId: string; version: number; parties: ISRV3PartyResult[]; disabled: boolean }) {
  const eligible = parties.filter((item) => item.amount !== null && Number(item.amount) > 0);
  const [partyId, setPartyId] = useState(''), [due, setDue] = useState(''), [paid, setPaid] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<Record<string, unknown> | null>(null);
  if (!eligible.length) return null;
  const change = (setter: (value: string) => void, value: string) => { setter(value); setResult(null); setError(''); };
  const calculate = async () => {
    setBusy(true); setError(''); setResult(null);
    try { setResult(await isrService.surcharges({ calculation_id: calculationId, expected_version: version, party_id: partyId, due_date: due, payment_date: paid })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible estimar los accesorios.'); }
    finally { setBusy(false); }
  };
  return <details className={styles.panel}><summary>Calcular actualización y recargos</summary>
    <p>Estimación separada sobre la versión {version}. No cambia el ISR original, no registra pagos y no incluye multas.</p>
    <div className={styles.fields}>
      <label><span>Contribuyente e ISR original</span><select value={partyId} disabled={disabled || busy} onChange={(event) => change(setPartyId, event.target.value)}><option value="">Selecciona un enajenante</option>{eligible.map((party) => <option key={party.partyId} value={party.partyId}>{party.partyName} · {money(party.amount)}</option>)}</select></label>
      <label><span>Fecha legal de vencimiento confirmada</span><input type="date" value={due} disabled={disabled || busy} onChange={(event) => change(setDue, event.target.value)} /></label>
      <label><span>Fecha hipotética de pago</span><input type="date" value={paid} disabled={disabled || busy} onChange={(event) => change(setPaid, event.target.value)} /></label>
    </div>
    <button type="button" disabled={disabled || busy || !partyId || !due || !paid} onClick={() => void calculate()}>{busy ? 'Calculando accesorios…' : 'Estimar actualización y recargos'}</button>
    {error && <p role="alert">{error}</p>}
    {result && <section aria-label="Estimación de actualización y recargos"><dl>{[['ISR original', result.principal], ['Actualización', result.updateAmount], ['Recargos', result.surcharges], ['Total estimado a la fecha', result.total]].map(([label, value]) => <div key={String(label)}><dt>{String(label)}</dt><dd>{money(value)}</dd></div>)}</dl>
      <p>{String(result.delayMonths)} periodo(s) de mora · factor {String(result.updateFactor)}. Se conserva la procedencia de las referencias en auditoría.</p>
    </section>}
  </details>;
}
