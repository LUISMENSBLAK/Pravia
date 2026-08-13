import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { expedientesService } from './expedientes.service';
import type { ExpedienteListFilters, ExpedienteListResult } from './expedientes.types';

export function useExpedientes(filters: ExpedienteListFilters) {
  const deferredSearch = useDeferredValue(filters.search || '');
  const [result, setResult] = useState<ExpedienteListResult | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const loaded = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!loaded.current) setStatus('loading');
    try { setResult(await expedientesService.list({ ...filters, search: deferredSearch }, signal)); loaded.current = true; setStatus('ready'); }
    catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('error'); }
  }, [deferredSearch, filters.macrophase, filters.stage, filters.responsible, filters.notary, filters.risk, filters.dateFrom, filters.dateTo, filters.actType, filters.client, filters.status, filters.page, filters.sort]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  return { result, status, reload: () => load() };
}
