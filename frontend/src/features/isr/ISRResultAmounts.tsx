import type { ISRV3PartyResult } from './isr.types';
const money = (value: string | null) => value === null ? 'Sin información' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value));
export function ISRResultAmounts({ result }: { result: ISRV3PartyResult }) {
  return <dl aria-label={`Desglose de ${result.partyName}`}>
    <div><dt>Base fiscal</dt><dd>{money(result.taxableBase)}</dd></div>
    {result.acquisitionWorksheet && <>
      <div><dt>Costo actualizado</dt><dd>{money(result.acquisitionWorksheet.updatedCost)}</dd></div>
      <div><dt>Costo mínimo fiscal</dt><dd>{money(result.acquisitionWorksheet.minimumCost)}</dd></div>
      <div><dt>Costo aplicado</dt><dd>{money(result.acquisitionWorksheet.appliedCost)}</dd></div>
      <div><dt>Deducciones aplicadas</dt><dd>{money(result.acquisitionWorksheet.appliedDeductions)}</dd></div>
    </>}
    {result.distribution && <>
      <div><dt>Pago entidad federativa</dt><dd>{money(result.distribution.statePayment)}</dd></div>
      <div><dt>Remanente federal</dt><dd>{money(result.distribution.federalRemainder)}</dd></div>
      {result.distribution.status !== 'DETERMINADO' && <div><dt>Distribución</dt><dd>{result.distribution.reason}</dd></div>}
    </>}
  </dl>;
}
