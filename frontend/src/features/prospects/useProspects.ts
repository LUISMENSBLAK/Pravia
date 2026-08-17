import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { prospectsService } from './prospects.service';
import type {
  Prospect,
  ProspectCatalogs,
  ProspectListMeta,
  ProspectPipelineStage,
  ProspectPriority,
} from './prospects.types';
import { PIPELINE_STAGES } from './prospects.types';

type View = 'cards' | 'list';
type Lanes = Record<ProspectPipelineStage, Prospect[]>;
type Totals = Record<ProspectPipelineStage, number>;

const emptyLanes = (): Lanes => ({ new: [], progress: [], quote: [], converted: [] });
const emptyTotals = (): Totals => ({ new: 0, progress: 0, quote: 0, converted: 0 });

export function useProspects(
  search: string,
  priority: ProspectPriority | '',
  serviceCode: string,
  operationalStageCode: string,
  page: number,
  view: View,
) {
  const deferredSearch = useDeferredValue(search);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [lanes, setLanes] = useState<Lanes>(emptyLanes);
  const [laneTotals, setLaneTotals] = useState<Totals>(emptyTotals);
  const [laneLoading, setLaneLoading] = useState<ProspectPipelineStage | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [meta, setMeta] = useState<ProspectListMeta | null>(null);
  const [catalogs, setCatalogs] = useState<ProspectCatalogs>({ stages: [], services: [] });
  const [reloadVersion, setReloadVersion] = useState(0);

  const baseFilters = useMemo(() => ({
    search: deferredSearch,
    priority,
    serviceCode,
    operationalStageCode,
  }), [deferredSearch, operationalStageCode, priority, serviceCode]);

  useEffect(() => {
    const controller = new AbortController();
    setStatus('loading');
    const load = async () => {
      try {
        const [catalogResult, overview] = await Promise.all([
          prospectsService.catalogs(controller.signal),
          prospectsService.list({ ...baseFilters, page: 1, pageSize: 1 }, controller.signal),
        ]);
        if (controller.signal.aborted) return;
        setCatalogs(catalogResult);
        setMeta(overview.meta);
        if (view === 'cards') {
          const results = await Promise.all(PIPELINE_STAGES.map((stage) => prospectsService.list({
            ...baseFilters,
            substatuses: stage.substatuses,
            page: 1,
            pageSize: 10,
            includeSummary: false,
          }, controller.signal)));
          if (controller.signal.aborted) return;
          const nextLanes = emptyLanes();
          const nextTotals = emptyTotals();
          PIPELINE_STAGES.forEach((stage, index) => {
            nextLanes[stage.id] = results[index].data;
            nextTotals[stage.id] = results[index].meta.total;
          });
          setLanes(nextLanes);
          setLaneTotals(nextTotals);
          setProspects(PIPELINE_STAGES.flatMap((stage) => nextLanes[stage.id]));
        } else {
          const result = await prospectsService.list({ ...baseFilters, page, pageSize: 25, includeSummary: false }, controller.signal);
          if (controller.signal.aborted) return;
          setProspects(result.data);
          setMeta((current) => current ? { ...current, page: result.meta.page, pageSize: result.meta.pageSize, totalPages: result.meta.totalPages, hasNextPage: result.meta.hasNextPage, hasPreviousPage: result.meta.hasPreviousPage } : result.meta);
        }
        setStatus('ready');
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setStatus('error');
      }
    };
    void load();
    return () => controller.abort();
  }, [baseFilters, page, reloadVersion, view]);

  const loadMore = useCallback(async (stageId: ProspectPipelineStage) => {
    const stage = PIPELINE_STAGES.find((item) => item.id === stageId);
    if (!stage || laneLoading || lanes[stageId].length >= laneTotals[stageId]) return;
    setLaneLoading(stageId);
    try {
      const nextPage = Math.floor(lanes[stageId].length / 10) + 1;
      const result = await prospectsService.list({
        ...baseFilters,
        substatuses: stage.substatuses,
        page: nextPage,
        pageSize: 10,
        includeSummary: false,
      });
      setLanes((current) => {
        const known = new Set(current[stageId].map((item) => item.id));
        return { ...current, [stageId]: [...current[stageId], ...result.data.filter((item) => !known.has(item.id))] };
      });
      setProspects((current) => {
        const known = new Set(current.map((item) => item.id));
        return [...current, ...result.data.filter((item) => !known.has(item.id))];
      });
    } finally {
      setLaneLoading(null);
    }
  }, [baseFilters, laneLoading, laneTotals, lanes]);

  return {
    prospects,
    lanes,
    laneTotals,
    laneLoading,
    loadMore,
    status,
    meta,
    catalogs,
    reload: () => setReloadVersion((value) => value + 1),
  };
}
