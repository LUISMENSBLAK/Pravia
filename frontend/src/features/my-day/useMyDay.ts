import { useCallback, useEffect, useState } from 'react';
import { myDayService } from './myDay.service';
import type { MyDayData } from './myDay.types';

type MyDayState = {
  status: 'loading' | 'success' | 'error';
  data: MyDayData | null;
  error: string | null;
};

export function useMyDay() {
  const [requestKey, setRequestKey] = useState(0);
  const [state, setState] = useState<MyDayState>({ status: 'loading', data: null, error: null });

  useEffect(() => {
    const controller = new AbortController();
    setState((current) => ({ ...current, status: 'loading', error: null }));
    myDayService.get(controller.signal)
      .then((data) => setState({ status: 'success', data, error: null }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : 'No pudimos cargar el resumen de hoy.';
        setState({ status: 'error', data: null, error: message });
      });
    return () => controller.abort();
  }, [requestKey]);

  const retry = useCallback(() => setRequestKey((value) => value + 1), []);
  return { ...state, retry };
}
