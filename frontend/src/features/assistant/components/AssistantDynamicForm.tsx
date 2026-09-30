import { useEffect, useState, type FormEvent } from 'react';
import { ClipboardPenLine, X } from 'lucide-react';
import { useAssistant } from '../AssistantProvider';
import styles from './AssistantDrawer.module.css';

export function AssistantDynamicForm() {
  const { collection, submitCollection, cancelCollection, status } = useAssistant();
  const [values, setValues] = useState<Record<string, string | number | boolean>>({});
  const collectionKey = collection ? `${collection.actionKey}:${collection.fields.map((field) => field.name).join(',')}` : '';

  useEffect(() => {
    setValues({});
  }, [collectionKey]);

  if (!collection) return null;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const args: Record<string, unknown> = {};
    for (const field of collection.fields) {
      const value = values[field.name] ?? field.value;
      if (field.type === 'number' && value !== '' && value !== undefined) args[field.name] = Number(value);
      else if (field.type === 'checkbox') args[field.name] = Boolean(value);
      else if (field.type === 'multiline' && typeof value === 'string') {
        args[field.name] = value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
      }
      else if (value !== undefined && value !== '') args[field.name] = value;
    }
    void submitCollection(args);
  };

  return <form className={styles.dynamicForm} onSubmit={submit} aria-label="Formulario operativo de PRAVIA IA">
    <header><span><ClipboardPenLine size={17}/></span><div><small>Formulario operativo</small><strong>{collection.title}</strong></div><button type="button" onClick={cancelCollection} aria-label="Cerrar formulario"><X size={16}/></button></header>
    <p>{collection.description}</p>
    <div className={styles.dynamicFields}>{collection.fields.map((field) => <label key={field.name}><span>{field.label}{field.required ? ' *' : ''}</span>{field.type === 'select'
      ? <select aria-label={`${field.label}${field.required ? ' *' : ''}`} required={field.required} value={String(values[field.name] ?? field.value ?? '')} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}><option value="">Seleccionar…</option>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      : field.type === 'checkbox'
        ? <input aria-label={`${field.label}${field.required ? ' *' : ''}`} type="checkbox" checked={Boolean(values[field.name] ?? field.value)} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.checked }))}/>
        : field.type === 'multiline'
          ? <textarea aria-label={`${field.label}${field.required ? ' *' : ''}`} required={field.required} rows={3} value={String(values[field.name] ?? field.value ?? '')} placeholder="Un elemento por línea" onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}/>
        : <input aria-label={`${field.label}${field.required ? ' *' : ''}`} type={field.type} required={field.required} value={String(values[field.name] ?? field.value ?? '')} onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}/>}</label>)}</div>
    <footer><button type="button" onClick={cancelCollection}>Cancelar</button><button type="submit" disabled={status === 'processing'}>Continuar</button></footer>
  </form>;
}
