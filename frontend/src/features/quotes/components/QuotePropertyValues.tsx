import { useEffect, useState, type FormEvent } from 'react';
import { LoaderCircle, Save } from 'lucide-react';
import { quotesService } from '../quotes.service';
import type { Quote } from '../quotes.types';
import styles from '../Quotes.module.css';
import propertyStyles from './QuotePropertyValues.module.css';
import type { CommercialPropertyState } from '../../properties/commercialProperty';

const fromQuote = (quote: Quote) => ({ operationValue: quote.valor_operacion == null ? '' : String(quote.valor_operacion),
  cadastralValue: quote.valor_catastral == null ? '' : String(quote.valor_catastral),
  appraisalValue: quote.valor_avaluo == null ? '' : String(quote.valor_avaluo) });
const fields = [
  { key: 'operationValue', label: 'Valor de operación (MXN)', money: true },
  { key: 'cadastralValue', label: 'Valor catastral (MXN)', money: true },
  { key: 'appraisalValue', label: 'Valor de avalúo (MXN)', money: true },
] as const;

export function QuotePropertyValues({ quote, canWrite: allowed, onSaved, notify, linkedState, onDirtyChange }: {
  quote: Quote; canWrite: boolean; onSaved: () => Promise<void> | void; notify: (message: string) => void;
  linkedState?: CommercialPropertyState; onDirtyChange?: (dirty: boolean) => void;
}) {
  const [values, setValues] = useState(() => fromQuote(quote));
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const linked = linkedState?.source === 'PREDIO_MASTER';
  const canWrite = allowed && !linked && !['ACEPTADA', 'ACEPTO_ANTICIPO', 'CONVERTIDA_EXPEDIENTE'].includes(String(quote.workflow?.stage ?? quote.estado));
  useEffect(() => { setValues(fromQuote(quote)); setError(''); }, [quote.id, quote.updated_at, quote.valor_operacion, quote.valor_catastral, quote.valor_avaluo]);
  const dirty = JSON.stringify(values) !== JSON.stringify(fromQuote(quote));
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const displayed = linked && linkedState ? {
    operationValue: linkedState.values.operationValue ?? '', cadastralValue: linkedState.values.cadastralValue ?? '', appraisalValue: linkedState.values.appraisalValue ?? '',
  } : values;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canWrite || saving) return;
    const invalid = fields.find((field) => field.money && values[field.key].trim() && !/^\d{1,14}(?:\.\d{1,2})?$/.test(values[field.key].trim()));
    if (invalid) return setError(`${invalid.label}: captura un importe no negativo con máximo dos decimales.`);
    setSaving(true); setError('');
    try {
      await quotesService.updatePropertyValues(quote.id, {
        operationValue: values.operationValue.trim() || null,
        cadastralValue: values.cadastralValue.trim() || null,
        appraisalValue: values.appraisalValue.trim() || null,
      }, quote.updated_at);
      await onSaved(); notify('Datos del inmueble guardados. El presupuesto y los cobros no cambiaron.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No pudimos guardar los datos del inmueble.'); }
    finally { setSaving(false); }
  };
  return <section className={styles.detailSection} aria-labelledby="quote-property-values-title">
    <header><div><h2 id="quote-property-values-title">Datos del inmueble y de la operación</h2>
    <p>{linked ? 'Fuente: ficha maestra de Predios. Para corregir estos valores, abre el inmueble vinculado. No se modifica el presupuesto ni se registran pagos.' : 'Operación, catastro y avalúo son opcionales. Capturarlos no agrega cargos ni registra pagos. Los datos prediales históricos se conservan.'}</p></div></header>
    <div className={propertyStyles.body}>
    {error && <div className={styles.formError} role="alert">{error}</div>}
    <form onSubmit={submit}>
      <fieldset className={propertyStyles.fields} disabled={!canWrite || saving}>
        <legend>Valores del inmueble · opcionales</legend>
        <div className={propertyStyles.grid}>{fields.map((field) => <label key={field.key}>
          <span>{field.label}</span><input type={field.money ? 'number' : 'text'} inputMode={field.money ? 'decimal' : 'text'}
            min={field.money ? '0' : undefined} step={field.money ? '0.01' : undefined} maxLength={field.money ? undefined : 180}
            value={displayed[field.key]} placeholder="Sin información" onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />
        </label>)}</div>
      </fieldset>
      {canWrite && <footer className={`${styles.inlineBudgetActions} ${propertyStyles.actions}`}><span>{dirty ? 'Hay cambios sin guardar.' : 'Datos guardados.'}</span><div>
        <button type="button" className={styles.secondaryButton} disabled={!dirty || saving} onClick={() => { setValues(fromQuote(quote)); setError(''); }}>Descartar</button>
        <button type="submit" className={styles.primaryButton} disabled={!dirty || saving}>{saving ? <LoaderCircle className={styles.spin} size={17} /> : <Save size={17} />}Guardar datos del inmueble</button>
      </div></footer>}
    </form></div>
  </section>;
}
