import { ExternalLink, Mail, MoreHorizontal, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { NotariaListItem } from '../notarias.types';
import styles from '../Notarias.module.css';

export function StatusBadge({ status }: { status: 'ACTIVA' | 'INACTIVA' }) { return <span className={`${styles.statusBadge} ${styles[`status_${status}`]}`}>{status === 'ACTIVA' ? 'Activa' : 'Inactiva'}</span>; }

export function NotariaTable({ items }: { items: NotariaListItem[] }) {
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Número / Notaría</th><th>Titular</th><th>Estado / ubicación</th><th>Contacto</th><th>Expedientes activos</th><th><span className={styles.srOnly}>Acciones</span></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}>
    <td><Link className={styles.notariaLink} to={`/notarias/${item.id}`}>{item.etiqueta}</Link><small>{item.nombre !== item.etiqueta ? item.nombre : 'Directorio notarial'}</small></td>
    <td><strong>{item.titular || 'Sin titular registrado'}</strong></td>
    <td><span>{[item.ciudad || item.municipio, item.entidad_federativa].filter(Boolean).join(', ')}</span></td>
    <td><div className={styles.contactCell}>{item.contacto.telefono && <span><Phone size={12} />{item.contacto.telefono}</span>}{item.contacto.correo && <span><Mail size={12} />{item.contacto.correo}</span>}{!item.contacto.telefono && !item.contacto.correo && <span className={styles.missing}>Sin contacto</span>}</div></td>
    <td><Link className={styles.caseCount} to={`/expedientes?notaria_id=${item.id}`}>{item.expedientes_activos}</Link></td>
    <td className={styles.actionsCell}><details className={styles.rowMenu}><summary aria-label={`Acciones de ${item.etiqueta}`}><MoreHorizontal size={18} /></summary><div><Link to={`/notarias/${item.id}`}><ExternalLink size={13} />Abrir</Link><Link to={`/expedientes?notaria_id=${item.id}`}>Ver expedientes</Link></div></details></td>
  </tr>)}</tbody></table></div>;
}
