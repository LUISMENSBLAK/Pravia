import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { miDiaConfigurationService, type MiDiaConfiguration, type MiDiaLayoutItem } from '../miDiaConfiguration.service';
import styles from './TenantBoardSettings.module.css';

type Administration = NonNullable<MiDiaConfiguration['tenantAdministration']>;

export function TenantBoardSettings({ administration, onSaved }: { administration: Administration; onSaved: () => Promise<void> }) {
  const [enabled, setEnabled] = useState<string[]>(administration.enabledCards);
  const [recommended, setRecommended] = useState<string[]>(administration.recommendedCards);
  const [layout, setLayout] = useState<MiDiaLayoutItem[]>(administration.defaultLayout);
  const [status, setStatus] = useState<'ready' | 'saving' | 'saved' | 'error'>('ready');
  const [error, setError] = useState('');

  useEffect(() => {
    setEnabled(administration.enabledCards);
    setRecommended(administration.recommendedCards);
    setLayout(administration.defaultLayout);
  }, [administration]);

  const toggleEnabled = (key: string) => {
    if (enabled.includes(key)) {
      setEnabled(enabled.filter((item) => item !== key));
      setRecommended(recommended.filter((item) => item !== key));
      setLayout(layout.filter((item) => item.key !== key));
    } else setEnabled([...enabled, key]);
    setStatus('ready');
  };
  const toggleDefault = (key: string) => {
    if (layout.some((item) => item.key === key)) setLayout(layout.filter((item) => item.key !== key));
    else {
      const card = administration.catalog.find((item) => item.key === key);
      if (card) setLayout([...layout, { key, size: card.defaultSize,
        scope: card.allowedScopes.includes('ORGANIZATION') ? 'ORGANIZATION' : 'OWN', parameters: {}, fixed: false }]);
    }
    setStatus('ready');
  };
  const move = (key: string, offset: number) => {
    const index = layout.findIndex((item) => item.key === key);
    const nextIndex = index + offset;
    if (index < 0 || nextIndex < 0 || nextIndex >= layout.length) return;
    const next = [...layout];
    next.splice(nextIndex, 0, next.splice(index, 1)[0]);
    setLayout(next); setStatus('ready');
  };
  const save = async () => {
    setStatus('saving'); setError('');
    try {
      await miDiaConfigurationService.saveTenant({ version: administration.version, enabled_cards: enabled,
        default_layout: layout, fixed_cards: layout.filter((item) => item.fixed).map((item) => item.key),
        recommended_cards: recommended });
      await onSaved();
      setStatus('saved');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible guardar el tablero de la notaría.');
      setStatus('error');
    }
  };

  return <section className={styles.panel} aria-label="Tablero predeterminado de la notaría">
    <div className={styles.heading}><div><h2>Tablero de la notaría</h2><p>Elige las tarjetas disponibles y el orden inicial. Los tableros personales ya configurados se conservan.</p></div>
      <button type="button" onClick={() => void save()} disabled={status === 'saving'}>{status === 'saving' ? 'Guardando…' : 'Guardar configuración'}</button></div>
    {status === 'error' && <p role="alert" className={styles.error}>{error}</p>}
    {status === 'saved' && <p role="status" className={styles.saved}>Configuración guardada.</p>}
    <div className={styles.cards}>
      {administration.catalog.map((card) => {
        const active = enabled.includes(card.key);
        const index = layout.findIndex((item) => item.key === card.key);
        const item = layout[index];
        return <div key={card.key} className={styles.card}>
          <div className={styles.cardTitle}><strong>{card.name}</strong><small>{card.sourceModule}</small></div>
          <label><input type="checkbox" aria-label={`${card.name}: habilitada`} checked={active} onChange={() => toggleEnabled(card.key)}/>Habilitada</label>
          <label><input type="checkbox" aria-label={`${card.name}: en tablero inicial`} checked={index >= 0} disabled={!active} onChange={() => toggleDefault(card.key)}/>En tablero inicial</label>
          <label><input type="checkbox" aria-label={`${card.name}: recomendada`} checked={recommended.includes(card.key)} disabled={!active} onChange={() => { setRecommended(recommended.includes(card.key) ? recommended.filter((key) => key !== card.key) : [...recommended, card.key]); setStatus('ready'); }}/>Recomendada</label>
          {item && <div className={styles.defaultControls}>
            <label><input type="checkbox" aria-label={`${card.name}: fija`} checked={item.fixed === true} onChange={(event) => { setLayout(layout.map((row) => row.key === card.key ? { ...row, fixed: event.target.checked } : row)); setStatus('ready'); }}/>Fija</label>
            <label>Tamaño<select aria-label={`${card.name}: tamaño`} value={item.size} onChange={(event) => { setLayout(layout.map((row) => row.key === card.key ? { ...row, size: event.target.value as MiDiaLayoutItem['size'] } : row)); setStatus('ready'); }}>
              {card.allowedSizes.map((size) => <option key={size} value={size}>{size}</option>)}
            </select></label>
            <button type="button" aria-label={`Subir ${card.name}`} onClick={() => move(card.key, -1)} disabled={index === 0}><ArrowUp size={16}/></button>
            <button type="button" aria-label={`Bajar ${card.name}`} onClick={() => move(card.key, 1)} disabled={index === layout.length - 1}><ArrowDown size={16}/></button>
          </div>}
        </div>;
      })}
    </div>
  </section>;
}
