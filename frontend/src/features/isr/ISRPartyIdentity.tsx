import { useEffect, useState } from 'react';
import type { ISRV3Party } from './isr.types';
import { isrService } from './isr.service';

type Master = Awaited<ReturnType<typeof isrService.searchComparecientes>>[number];
export function ISRPartyIdentity({ party, disabled, onChange }: { party: ISRV3Party; disabled: boolean; onChange(patch: Partial<ISRV3Party>): void }) {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Master[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setResults([]); setError('');
    if (search.trim().length < 2) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    const timer = window.setTimeout(() => {
      isrService.searchComparecientes(search.trim(), controller.signal).then(setResults).catch(() => {
        if (!controller.signal.aborted) setError('No fue posible consultar comparecientes.');
      }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [search]);
  return <>
    <label><span>Buscar compareciente existente</span><input aria-label={`Buscar compareciente para ${party.role === 'ENAJENANTE' ? 'enajenante' : 'adquirente'}`} value={search} disabled={disabled} placeholder="Nombre o RFC" onChange={(event) => setSearch(event.target.value)} /></label>
    {loading && <small role="status">Buscando…</small>}{error && <small role="alert">{error}</small>}
    {results.length > 0 && <label><span>Seleccionar compareciente</span><select value="" disabled={disabled} onChange={(event) => {
      const found = results.find((item) => item.id === event.target.value); if (!found) return;
      onChange({ sourceComparecienteId: found.id, name: found.nombre, rfc: found.rfc || '', curp: found.curp || '', subjectType: found.tipo_persona === 'FISICA' ? 'PF' : 'OTRO' });
      setSearch(''); setResults([]);
    }}><option value="">Selecciona una ficha</option>{results.map((item) => <option key={item.id} value={item.id}>{item.nombre}{item.rfc ? ` · ${item.rfc}` : ''}</option>)}</select></label>}
    {search.trim().length >= 2 && !loading && !error && !results.length && <small>Sin coincidencias en las fichas accesibles.</small>}
    {party.sourceComparecienteId && <small>Datos recuperados de ficha maestra; este cálculo conserva su propio snapshot.</small>}
    <label><span>Nombre</span><input value={party.name} disabled={disabled} onChange={(event) => onChange({ name: event.target.value })} /></label>
    <label><span>RFC</span><input value={party.rfc || ''} disabled={disabled} onChange={(event) => onChange({ rfc: event.target.value.toUpperCase() })} /></label>
    {party.subjectType === 'PF' && <label><span>CURP</span><input value={party.curp || ''} disabled={disabled} onChange={(event) => onChange({ curp: event.target.value.toUpperCase() })} /></label>}
  </>;
}
