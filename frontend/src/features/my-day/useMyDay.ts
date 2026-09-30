import { useCallback, useEffect, useRef, useState } from 'react';
import { myDayService } from './myDay.service';
import type { MyDayData } from './myDay.types';

type MyDayState = {
  status: 'loading' | 'success' | 'error';
  data: MyDayData | null;
  error: string | null;
};

export function useMyDay() {
  const [state, setState] = useState<MyDayState>({ status: 'loading', data: null, error: null });
  const activeRequest = useRef<AbortController | null>(null);
  const hasData = useRef(false);

  const load = useCallback(async (foreground = false) => {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    if (foreground || !hasData.current) setState((current) => ({ ...current, status: 'loading', error: null }));
    try {
      const data = await myDayService.get(controller.signal);
      if (controller.signal.aborted) return;
      hasData.current = true;
      setState({ status: 'success', data, error: null });
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'No pudimos cargar el resumen de hoy.';
      setState((current) => hasData.current ? { ...current, error: message } : { status: 'error', data: null, error: message });
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, []);

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => void load(false), 30_000);
    const refresh = () => void load(false);
    window.addEventListener('pravia:data-changed', refresh);
    window.addEventListener('pravia:notifications-changed', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('pravia:data-changed', refresh);
      window.removeEventListener('pravia:notifications-changed', refresh);
      activeRequest.current?.abort();
    };
  }, [load]);

  const retry = useCallback(() => { void load(true); }, [load]);
  return { ...state, retry };
}
