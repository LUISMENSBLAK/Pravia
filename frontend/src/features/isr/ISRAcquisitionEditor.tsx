import type { ISRV3Input, ISRV3Party } from './isr.types';
import { useId } from 'react';
import styles from './ISRAcquisitionEditor.module.css';
type Layer = NonNullable<ISRV3Party['acquisitionLayers']>[number];

export function ISRAcquisitionEditor({ layer, input, disabled, onChange }: { layer: Layer; input: ISRV3Input; disabled: boolean; onChange(patch: Partial<Layer>): void }) {
  const historical = layer.historical;
  const methodDescriptionId = useId();
  const construction = input.property.type !== 'TERRENO';
  const changeHistorical = (patch: Partial<NonNullable<Layer['historical']>>) => onChange({ historical: { ...historical!, ...patch }, verified: false });
  return <section className={styles.editor} aria-label="Adquisición y enajenación comparadas">
    <div className={styles.comparison}>
      <div><h4>Adquisición</h4><label>Fecha fiscal<input aria-label="Fecha fiscal" disabled={disabled} type="date" value={layer.fiscalDate} onChange={(event) => onChange({ fiscalDate: event.target.value, legalDate: input.property.sameAcquisitionDate ? event.target.value : layer.legalDate, verified: false })} /></label>
        <label>Origen del costo<select disabled={disabled} value={historical ? 'HISTORICAL' : 'ADJUSTED'} onChange={(event) => onChange({ historical: event.target.value === 'HISTORICAL' ? { method: 'AUTO', separation: 'EXPLICIT', land: '', construction: construction ? '' : '0' } : undefined, verified: false })}>
          <option value="HISTORICAL">Costo histórico · actualizar con PRAVIA</option><option value="ADJUSTED">Costo actualizado confirmado</option>
        </select></label>
        {historical ? <>
          {construction && <label>Separación del costo<select disabled={disabled} value={historical.separation} onChange={(event) => changeHistorical({ separation: event.target.value as typeof historical.separation })}><option value="EXPLICIT">Importes documentados por componente</option><option value="STATUTORY">Regla supletoria de la política fiscal vigente</option></select></label>}
          {construction && historical.separation === 'STATUTORY' ? <label>Costo histórico total<input inputMode="decimal" disabled={disabled} value={historical.total || ''} onChange={(event) => changeHistorical({ total: event.target.value })} /></label> : <>
            <label>Costo histórico terreno<input inputMode="decimal" disabled={disabled} value={historical.land || ''} onChange={(event) => changeHistorical({ land: event.target.value })} /></label>
            {construction && <label>Costo histórico construcción<input inputMode="decimal" disabled={disabled} value={historical.construction || ''} onChange={(event) => changeHistorical({ construction: event.target.value })} /></label>}
          </>}
        </> : <><label>Costo actualizado terreno<input aria-label="Costo terreno" inputMode="decimal" disabled={disabled} value={layer.adjustedLandCost} onChange={(event) => onChange({ adjustedLandCost: event.target.value, verified: false })} /></label>
          {construction && <label>Costo actualizado construcción<input aria-label="Costo construcción" inputMode="decimal" disabled={disabled} value={layer.adjustedConstructionCost} onChange={(event) => onChange({ adjustedConstructionCost: event.target.value, verified: false })} /></label>}</>}
      </div>
      <div><h4>Enajenación</h4><label>Fecha de la operación<input type="date" readOnly value={input.operationDate} /></label><label>Valor total de la operación<input readOnly value={input.values.operation} /></label><p>Datos del bloque Valores. Las participaciones se aplican en el motor; este importe no se repite como ingreso individual.</p></div>
    </div>
    {historical && <label>Método de actualización<select aria-label="Método de actualización" aria-describedby={methodDescriptionId} disabled={disabled} value={historical.method} onChange={(event) => changeHistorical({ method: event.target.value as typeof historical.method })}><option value="AUTO">Automático · mejor resultado</option><option value="INPC">Actualización por INPC</option><option value="FACTORES">Tabla de factores RMF · Anexo 9</option></select><small id={methodDescriptionId}>Factores opcionales publicados para actualizar deducciones. PRAVIA exige referencias vigentes, conserva las alternativas y no inventa índices faltantes.</small></label>}
    <label>Fuente de adquisición<input aria-label="Fuente de adquisición" disabled={disabled} value={layer.source} placeholder="Documento / cláusula de origen" onChange={(event) => onChange({ source: event.target.value, verified: false })} /></label>
    <details><summary>Datos de esta adquisición</summary><label>Acto de adquisición<select aria-label="Acto de adquisición" disabled={disabled} value={layer.acquisitionAct} onChange={(event) => onChange({ acquisitionAct: event.target.value as Layer['acquisitionAct'], verified: false })}><option value="ONEROSA">Onerosa</option><option value="HERENCIA">Herencia</option><option value="DONACION">Donación</option><option value="OTRO">Otro</option></select></label><label>Porcentaje de capa<input aria-label="Porcentaje de capa" inputMode="decimal" disabled={disabled} value={layer.percentage} onChange={(event) => onChange({ percentage: event.target.value, verified: false })} /></label>
      {(layer.acquisitionAct === 'HERENCIA' || layer.acquisitionAct === 'DONACION') && <label>Antecedente fiscal encadenado<input disabled={disabled} value={layer.priorLayerId || ''} onChange={(event) => onChange({ priorLayerId: event.target.value, verified: false })} /></label>}
    </details>
    <label className={styles.confirm}><input type="checkbox" disabled={disabled} checked={layer.verified} onChange={(event) => onChange({ verified: event.target.checked })} />Datos y fuente de adquisición verificados</label>
  </section>;
}
