import { useEffect, useRef } from 'react';

/** Requery existing read models after a domain write; never scrape or mutate
 * form fields from assistant prose. The consumer protects its unsaved draft. */
export function useCanonicalRefresh(scope: string, onRefresh: (signal: AbortSignal) => void) {
  const latest = useRef(onRefresh);
  latest.current = onRefresh;
  useEffect(() => {
    let controller: AbortController | undefined;
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ scope?: string; path?: string }>).detail;
      if (detail?.scope !== scope && detail?.path?.split('?')[0].split('/').filter(Boolean)[0] !== scope) return;
      controller?.abort(); controller = new AbortController(); latest.current(controller.signal);
    };
    window.addEventListener('pravia:data-changed', listener);
    return () => { controller?.abort(); window.removeEventListener('pravia:data-changed', listener); };
  }, [scope]);
}
