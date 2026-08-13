import { AlertTriangle, ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { DuplicateCandidate } from '../comparecientes.types';
import styles from '../Comparecientes.module.css';

const reasonLabel: Record<string, string> = { CURP_EXACTA: 'CURP exacta', RFC_EXACTO: 'RFC exacto', CORREO_EXACTO: 'Correo coincidente', TELEFONO_COINCIDENTE: 'Teléfono coincidente', NOMBRE_SIMILAR: 'Nombre similar' };
export function DuplicateCandidateDialog({ items, onCancel, onContinue }: { items: DuplicateCandidate[]; onCancel(): void; onContinue(): void }) {
  const blocked = items.some((item) => item.bloqueo_alta);
  return <div className={styles.dialogBackdrop} role="presentation"><section className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="duplicate-title"><header><span className={styles.dialogIcon}><AlertTriangle /></span><div><h2 id="duplicate-title">Encontramos un compareciente que podría corresponder a esta persona.</h2><p>Revisa el registro antes de crear uno nuevo.</p></div></header><div className={styles.candidateList}>{items.map((item) => <article key={item.id}><div><strong>{item.nombre}</strong><span>{item.tipo_persona === 'FISICA' ? 'Persona física' : 'Persona moral'} · {item.rfc || 'Sin RFC'}</span><small>{item.razones.map((reason) => reasonLabel[reason] || reason).join(' · ')}</small></div><Link to={`/comparecientes/${item.id}`} target="_blank">Ver registro<ExternalLink size={14} /></Link></article>)}</div><footer><button type="button" className={styles.secondaryButton} onClick={onCancel}>Volver y revisar</button>{!blocked && <button type="button" className={styles.primaryButton} onClick={onContinue}>Continuar de todos modos</button>}</footer>{blocked && <p className={styles.blockedNote}>La coincidencia exacta de RFC o CURP bloquea el alta. Debes utilizar el registro existente.</p>}</section></div>;
}
