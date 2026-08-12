import { useCallback, useDeferredValue, useEffect, useRef, useState } from 'react';
import { prospectsService } from './prospects.service';
import type { Prospect, ProspectListMeta, ProspectPriority, ProspectStage } from './prospects.types';
import { STAGES } from './prospects.types';

export function useProspects(search: string, priority: ProspectPriority | '', service: string, source: string, stage: ProspectStage | '', page: number) {
  const deferredSearch = useDeferredValue(search);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [meta, setMeta] = useState<ProspectListMeta | null>(null);
  const [facets, setFacets] = useState({ services: [] as string[], sources: [] as string[] });
  const hasLoaded = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!hasLoaded.current) setStatus('loading');
    try {
      const states = STAGES.find((item) => item.id === stage)?.states;
      const result = await prospectsService.list({ search: deferredSearch, priority, service, source, states, page, pageSize: 24 }, signal);
      setProspects(result.data);
      setMeta(result.meta);
      setFacets(result.facets);
      hasLoaded.current = true;
      setStatus('ready');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setStatus('error');
    }
  }, [deferredSearch, page, priority, service, source, stage]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { prospects, status, meta, facets, reload: () => load(), setProspects };
}
