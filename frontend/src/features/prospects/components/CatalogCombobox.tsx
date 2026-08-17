import { ChevronDown, Search } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import styles from '../ProspectsPage.module.css';

type Option = { code: string; label: string };

const searchable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-MX');

export function CatalogCombobox({
  label,
  value,
  options,
  placeholder,
  emptyLabel,
  required,
  error,
  legacyValue,
  compact = false,
  onChange,
}: {
  label: string;
  value: string;
  options: Option[];
  placeholder: string;
  emptyLabel?: string;
  required?: boolean;
  error?: string;
  legacyValue?: string | null;
  compact?: boolean;
  onChange: (value: string) => void;
}) {
  const inputId = useId();
  const listId = useId();
  const errorId = useId();
  const blurTimer = useRef<number>();
  const selected = options.find((option) => option.code === value);
  const [query, setQuery] = useState(selected?.label ?? '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const filtered = useMemo(() => {
    const term = searchable(query);
    return term ? options.filter((option) => searchable(option.label).includes(term)) : options;
  }, [options, query]);
  useEffect(() => { if (!open) setQuery(selected?.label ?? ''); }, [open, selected?.label]);
  useEffect(() => { setActiveIndex(-1); }, [query]);

  const choose = (option?: Option) => {
    window.clearTimeout(blurTimer.current);
    onChange(option?.code ?? '');
    setQuery(option?.label ?? '');
    setOpen(false);
  };

  return <div className={`${styles.catalogField} ${compact ? styles.catalogFieldCompact : ''}`}>
    <label htmlFor={inputId}>{label}{required && <b aria-hidden="true"> *</b>}</label>
    <div className={styles.catalogControl}>
      {!compact && <Search size={16} aria-hidden="true" />}
      <input
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        aria-activedescendant={open && filtered[activeIndex] ? `${listId}-${filtered[activeIndex].code}` : undefined}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={(event) => { setQuery(event.target.value); onChange(''); setOpen(true); }}
        onFocus={(event) => { event.currentTarget.select(); setOpen(true); }}
        onBlur={() => { blurTimer.current = window.setTimeout(() => { setOpen(false); setQuery(selected?.label ?? ''); }, 120); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true); setActiveIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0))); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActiveIndex((index) => index < 0 ? Math.max(filtered.length - 1, 0) : Math.max(index - 1, 0)); }
          if (event.key === 'Enter' && open && filtered[activeIndex]) { event.preventDefault(); choose(filtered[activeIndex]); }
          if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setQuery(selected?.label ?? ''); }
        }}
      />
      <ChevronDown size={16} aria-hidden="true" />
    </div>
    {open && <div id={listId} role="listbox" className={styles.catalogOptions} aria-label={`Opciones de ${label}`}>
      {emptyLabel && <button type="button" role="option" aria-selected={!value} onMouseDown={(event) => event.preventDefault()} onClick={() => choose()}>{emptyLabel}</button>}
      {filtered.map((option, index) => <button id={`${listId}-${option.code}`} key={option.code} type="button" role="option" aria-selected={value === option.code} data-active={activeIndex === index || undefined} onMouseEnter={() => setActiveIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(option)}>{option.label}</button>)}
      {!filtered.length && <p>No hay coincidencias.</p>}
    </div>}
    {legacyValue && !value && <small className={styles.legacyValue}>Valor histórico conservado: {legacyValue}</small>}
    {error && <small id={errorId} className={styles.fieldError}>{error}</small>}
  </div>;
}
