import { useCallback, useEffect, useRef, useState } from 'react';
import { miDiaConfigurationService, type MiDiaConfiguration, type MiDiaLayoutItem } from './miDiaConfiguration.service';

export function useMiDiaConfiguration() {
  const [configuration, setConfiguration] = useState<MiDiaConfiguration | null>(null);
  const [layout, setLayout] = useState<MiDiaLayoutItem[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'saving' | 'error'>('loading');
  const [error, setError] = useState('');
  const version = useRef(0);
  const saved = useRef('');
  const latest = useRef<MiDiaLayoutItem[]>([]);
  const saving = useRef(false);
  const failed = useRef(false);
  const timer = useRef<number | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setStatus('loading'); setError('');
    try {
      const result = await miDiaConfigurationService.get(signal);
      if (signal?.aborted) return;
      setConfiguration(result);
      setLayout(result.layout);
      latest.current = result.layout;
      saved.current = JSON.stringify(result.layout);
      version.current = result.layoutVersion;
      failed.current = false;
      setStatus('ready');
    } catch (cause) {
      if (signal?.aborted) return;
      setConfiguration(null);
      setLayout([]);
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la configuración.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => {
      controller.abort();
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer.current !== null) window.clearTimeout(timer.current);
      void load();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  const flush = useCallback(async () => {
    if (saving.current || failed.current) return;
    const snapshot = latest.current;
    if (JSON.stringify(snapshot) === saved.current) return;
    saving.current = true; setStatus('saving');
    try {
      const result = await miDiaConfigurationService.save(snapshot, version.current);
      version.current = result.version;
      saved.current = JSON.stringify(snapshot);
      setConfiguration((current) => current ? { ...current, layoutVersion: result.version, personalized: true } : current);
      setStatus('ready'); setError('');
      window.dispatchEvent(new CustomEvent('pravia:data-changed', { detail: { path: '/mi-dia/config', method: 'PUT' } }));
    } catch (cause) {
      failed.current = true;
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el tablero.');
      setStatus('error');
    } finally {
      saving.current = false;
      if (!failed.current && JSON.stringify(latest.current) !== saved.current) void flush();
    }
  }, []);

  const change = useCallback((next: MiDiaLayoutItem[]) => {
    latest.current = next;
    setLayout(next);
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (!failed.current) timer.current = window.setTimeout(() => void flush(), 350);
  }, [flush]);

  const reset = useCallback(async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    if (saving.current) return;
    setStatus('saving');
    try {
      const result = await miDiaConfigurationService.reset();
      setConfiguration(result);
      setLayout(result.layout);
      latest.current = result.layout;
      saved.current = JSON.stringify(result.layout);
      version.current = result.layoutVersion;
      failed.current = false;
      setStatus('ready'); setError('');
      window.dispatchEvent(new CustomEvent('pravia:data-changed', { detail: { path: '/mi-dia/config', method: 'DELETE' } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo restablecer el tablero.');
      setStatus('error');
    }
  }, []);

  return { configuration, layout, status, error, change, reset, reload: load };
}
