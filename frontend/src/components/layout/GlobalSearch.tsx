import { useEffect, useRef, useState } from 'react';
import { Building2, Command, FileText, FolderClosed, Search, UserRound, UsersRound, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { IconButton } from '../ui/IconButton';
import { settingsService } from '../../features/settings/settings.service';
import type { SearchResult } from '../../features/settings/settings.types';
import styles from './GlobalSearch.module.css';

export function GlobalSearch() {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null); const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(true); }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown); return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  useEffect(() => { if (open) window.setTimeout(() => inputRef.current?.focus(), 20); }, [open]);
  useEffect(() => {
    if (!open || query.trim().length < 2) { setResults([]); setLoading(false); return; }
    const timer = window.setTimeout(() => {
      setLoading(true); setError('');
      settingsService.search(query.trim()).then((payload) => setResults(payload.data)).catch((reason) => setError(reason instanceof Error ? reason.message : 'No fue posible buscar.')).finally(() => setLoading(false));
    }, 260);
    return () => window.clearTimeout(timer);
  }, [open, query]);
  const iconFor = (type: string) => type === 'EXPEDIENTE' ? FolderClosed : type === 'COMPARECIENTE' ? UserRound : type === 'PROSPECTO' ? UsersRound : type === 'COTIZACION' ? FileText : Building2;
  const choose = (result: SearchResult) => { setOpen(false); setQuery(''); navigate(result.href); };

  return <>
    <button type="button" className={styles.trigger} onClick={() => setOpen(true)} aria-label="Abrir búsqueda global"><Search size={19} /><span>Buscar expedientes, prospectos, notarías, contactos...</span><kbd><Command size={13} /> K</kbd></button>
    <IconButton className={styles.mobileTrigger} onClick={() => setOpen(true)} aria-label="Abrir búsqueda global"><Search size={20} /></IconButton>
    {open && <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="search-title"><div className={styles.searchControl}><Search size={20} aria-hidden="true" /><input ref={inputRef} aria-label="Buscar en PRAVIA OS" placeholder="Buscar expediente, persona, cotización o notaría…" value={query} onChange={(event) => setQuery(event.target.value)} /><IconButton onClick={() => setOpen(false)} aria-label="Cerrar búsqueda"><X size={19} /></IconButton></div><div className={styles.results} id="search-title">
      {query.length < 2 && <div className={styles.empty}><span>Búsqueda global</span><p>Escribe al menos dos caracteres. Los resultados respetan tu rol y alcance.</p></div>}
      {loading && <div className={styles.empty} role="status"><p>Buscando en los módulos autorizados…</p></div>}
      {error && <div className={styles.empty} role="alert"><p>{error}</p></div>}
      {!loading && query.length >= 2 && !error && results.length === 0 && <div className={styles.empty}><span>Sin resultados</span><p>Prueba con folio, nombre, correo o número de notaría.</p></div>}
      {!loading && results.map((result) => { const ResultIcon = iconFor(result.type); return <button type="button" key={`${result.type}-${result.id}`} onClick={() => choose(result)}><ResultIcon size={18} /><span><strong>{result.title}</strong><small>{result.subtitle || result.type}</small></span><em>{result.type}</em></button>; })}
    </div></section></div>}
  </>;
}
