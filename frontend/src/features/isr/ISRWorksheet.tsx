import { useEffect, useRef } from 'react';
import type { ISRVersion, ISRV3Input, ISRV3Result, ISRV3Trace } from './isr.types';
import { ISRResultAmounts } from './ISRResultAmounts';
import styles from './ISRWorksheet.module.css';

const labels: Record<string, string> = {
  acquisitionDate: 'Fecha de adquisición', operationDate: 'Fecha de enajenación', historicalLand: 'Costo histórico del terreno', historicalConstruction: 'Costo histórico de construcción',
  fullYears: 'Años completos', depreciatedConstruction: 'Construcción después de disminución', policyCode: 'Política aplicada', policyVersion: 'Versión de política', policySource: 'Fuente de política',
  inpcFromMonth: 'Mes inicial INPC', inpcToMonth: 'Mes final INPC', inpcFrom: 'INPC inicial', inpcTo: 'INPC final', factor: 'Factor', method: 'Método', layerId: 'Adquisición',
  costoActualizado: 'Costo actualizado', costoMinimo: 'Costo mínimo fiscal', proporcionGravada: 'Proporción gravada', ganancia: 'Ganancia fiscal', anos: 'Años utilizados', baseAnual: 'Base anual',
  ingresoGravable: 'Ingreso gravable', costo: 'Costo aplicado', deducciones: 'Deducciones', tasa: 'Tasa (%)', isrDeterminado: 'ISR determinado', limiteInferior: 'Límite inferior', cuotaFija: 'Cuota fija', porcentaje: 'Porcentaje de tarifa',
};
function Trace({ trace }: { trace: ISRV3Trace }) {
  return <article><h4>{trace.ruleId}</h4><p>{trace.legalReference} · versión {trace.ruleVersion}</p>
    <dl>{Object.entries(trace.inputsUsed).map(([key, value]) => <div key={key}><dt>{labels[key] || key}</dt><dd>{value}</dd></div>)}</dl>
    <p><strong>{trace.calculation} = {trace.result}</strong></p><p>{trace.explanation}</p>
  </article>;
}
export function ISRWorksheet({ version, onClose }: { version: ISRVersion; onClose(): void }) {
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    close.current?.focus(); const key = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key); return () => { window.removeEventListener('keydown', key); previous?.focus(); };
  }, [onClose]);
  const input = version.input_snapshot as ISRV3Input, result = version.result as ISRV3Result;
  return <div className={styles.backdrop}><section className={styles.sheet} role="dialog" aria-modal="true" aria-labelledby="isr-worksheet-title" onKeyDown={(event) => {
    if (event.key === 'Tab') { event.preventDefault(); close.current?.focus(); }
  }}><header><div><h2 id="isr-worksheet-title">Hoja de trabajo ISR</h2><p>Versión {version.version} · {new Date(version.calculated_at).toLocaleString('es-MX')} · reglas {result.ruleVersion}</p></div><button ref={close} type="button" onClick={onClose}>Cerrar</button></header>
    <p>Snapshot inmutable del cálculo. Esta vista no cambia cifras, fuentes ni documentos.</p>
    {input.schemaVersion === 3 && <section><h3>Valores de la operación utilizados</h3><dl>{Object.entries({ Fecha: input.operationDate, Acto: input.act.name || input.act.otherDescription, 'Valor de operación': input.values.operation, Avalúo: input.values.appraisal, Catastral: input.values.cadastral, Terreno: input.values.landSale, Construcción: input.values.constructionSale }).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || 'Sin información'}</dd></div>)}</dl></section>}
    {result.saleISR?.map((party) => <section key={party.partyId}><h3>Enajenación · {party.partyName}</h3><p>ISR determinado: {party.amount ?? 'Pendiente de información'}</p><ISRResultAmounts result={party} />
      {party.traces.map((trace, index) => <Trace key={`${index}:${trace.ruleId}`} trace={trace} />)}
      {party.distribution?.traces.map((trace, index) => <Trace key={`distribution:${index}`} trace={trace} />)}
      {party.missing.length > 0 && <p>Pendiente: {party.missing.join('; ')}</p>}
    </section>)}
    {input.deductions?.length > 0 && <section><h3>Deducciones capturadas</h3>{input.deductions.map((item) => <p key={item.id}>{item.concept}: {item.amount || 'Sin información'} · {item.verified ? 'Confirmada' : 'Sin confirmar; no aplicada'} · soporte {item.supportDocumentId || 'Sin vínculo documental'}</p>)}</section>}
    {result.acquisitionISR?.map((party) => <section key={party.partyId}><h3>Adquisición · {party.partyName}</h3><p>{party.reason}</p>{party.traces.map((trace, index) => <Trace key={index} trace={trace} />)}</section>)}
    {result.iva && <section><h3>IVA</h3><p>{result.iva.reason}</p>{result.iva.traces.map((trace, index) => <Trace key={index} trace={trace} />)}</section>}
    {result.missing?.length > 0 && <section><h3>Información pendiente</h3><ul>{result.missing.map((item) => <li key={item}>{item}</li>)}</ul></section>}
  </section></div>;
}
