import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { quotesService } from './quotes.service';
import type { QuoteListResult, QuoteState } from './quotes.types';

export function useQuotes(filters: { search: string; state: QuoteState | ''; act: string; responsible: string; dateFrom: string; dateTo: string; period: '6m' | 'year'; page: number }) {
  const deferredSearch = useDeferredValue(filters.search);
  const [result, setResult] = useState<QuoteListResult | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const loaded = useRef(false);
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!loaded.current) setStatus('loading');
    try {
      const data = await quotesService.list({ ...filters, search: deferredSearch, pageSize: 12 }, signal);
      setResult(data);
      loaded.current = true;
      setStatus('ready');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus('error');
    }
  }, [deferredSearch, filters.act, filters.dateFrom, filters.dateTo, filters.page, filters.period, filters.responsible, filters.state]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return { result, status, reload: () => load() };
}
