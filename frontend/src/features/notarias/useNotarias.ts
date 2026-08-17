import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { notariasService } from './notarias.service';
import type { NotariaFilters, NotariaListResult } from './notarias.types';

export function useNotarias(filters: NotariaFilters) {
  const deferredSearch = useDeferredValue(filters.search || ''); const loaded = useRef(false);
  const [result, setResult] = useState<NotariaListResult | null>(null); const [status, setStatus] = useState<'loading'|'ready'|'error'>('loading');
  const load = useCallback(async (signal?: AbortSignal) => { if (!loaded.current) setStatus('loading'); try { setResult(await notariasService.list({ ...filters, search: deferredSearch }, signal)); loaded.current = true; setStatus('ready'); } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); } }, [deferredSearch, filters.state, filters.page]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  return { result, status, reload: () => load() };
}
