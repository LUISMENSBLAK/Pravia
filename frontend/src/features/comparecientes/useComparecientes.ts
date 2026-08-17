import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { comparecientesService } from './comparecientes.service';
import type { ComparecienteFilters, ComparecienteListResult } from './comparecientes.types';

export function useComparecientes(filters: ComparecienteFilters) {
  const deferredSearch = useDeferredValue(filters.search || '');
  const [result, setResult] = useState<ComparecienteListResult | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const loaded = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!loaded.current) setStatus('loading');
    try { setResult(await comparecientesService.list({ ...filters, search: deferredSearch }, signal)); loaded.current = true; setStatus('ready'); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); }
  }, [deferredSearch, filters.type, filters.updated, filters.sort, filters.page]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  return { result, status, reload: () => load() };
}
