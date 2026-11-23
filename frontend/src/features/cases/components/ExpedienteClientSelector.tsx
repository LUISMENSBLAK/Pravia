import { useEffect, useState } from 'react';
import { comparecientesService } from '../../comparecientes/comparecientes.service';
import type { ComparecienteListItem } from '../../comparecientes/comparecientes.types';
import styles from '../Expedientes.module.css';

export function ExpedienteClientSelector({ value, currentName, disabled, onChange }: {
  value: string; currentName: string; disabled: boolean; onChange(id: string): void;
}) {
  const [search, setSearch] = useState(''); const [rows, setRows] = useState<ComparecienteListItem[]>([]);
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (disabled) return;
    const abort = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true); setError('');
      void comparecientesService.list({ page: 1, pageSize: 20, sort: 'nombre:asc', ...(search.trim() ? { search: search.trim() } : {}) }, abort.signal)
        .then((result) => { if (!abort.signal.aborted) { setRows(result.data); setNames((known) => ({ ...known, ...Object.fromEntries(result.data.map((row) => [row.id, row.nombre])) })); } })
        .catch(() => { if (!abort.signal.aborted) setError('No pudimos buscar clientes. La selección guardada se conserva.'); })
        .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    }, 180);
    return () => { abort.abort(); window.clearTimeout(timer); };
  }, [search, disabled]);
  return <div className={styles.informationClient}>
    {!disabled && <label><span>Buscar cliente</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o RFC" /></label>}
    <label><span>Cliente</span><select value={value} disabled={disabled || loading} onChange={(event) => { if (event.target.value) onChange(event.target.value); }}>
      <option value="">{value ? 'Selecciona un compareciente' : currentName ? `${currentName} (sin vincular)` : 'Sin cliente vinculado'}</option>
      {value && !rows.some((row) => row.id === value) && <option value={value}>{names[value] || currentName || 'Cliente seleccionado'}</option>}
      {rows.map((row) => <option key={row.id} value={row.id}>{row.nombre}</option>)}
    </select></label>
    {loading && <small role="status">Buscando comparecientes…</small>}
    {error && <small role="alert">{error}</small>}
  </div>;
}
