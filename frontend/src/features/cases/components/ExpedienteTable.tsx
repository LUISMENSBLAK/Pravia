import { MoreHorizontal } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ExpedienteListItem } from '../expedientes.types';
import { fullName, macroLabels, shortDateTime } from '../expedienteFormatters';
import styles from '../Expedientes.module.css';
export function ExpedienteTable({ items }: { items: ExpedienteListItem[] }) { return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Folio</th><th>Acto</th><th>Cliente</th><th>Etapa</th><th>Responsable</th><th>Actualización</th><th>Riesgo</th><th><span className={styles.srOnly}>Acciones</span></th></tr></thead><tbody>{items.map((item) => <tr key={item.id}>
  <td><Link className={styles.folio} to={`/expedientes/${item.id}`}>{item.numero_pravia}</Link></td><td>{item.tipo_acto.nombre}</td><td><strong>{item.cliente_principal}</strong>{item.comparecientes_adicionales > 0 && <small>+{item.comparecientes_adicionales}</small>}</td>
  <td><span className={`${styles.phaseBadge} ${styles[`phase${item.macrofase}`]}`}>{macroLabels[item.macrofase]}</span><small>{item.etapaActual?.nombre_snapshot || item.etapa_actual_nombre || 'Sin etapa'}</small></td>
  <td className={!item.abogado ? styles.unassigned : ''}>{fullName(item.abogado)}</td><td title={new Date(item.updated_at).toLocaleString('es-MX')}>{shortDateTime(item.updated_at)}</td>
  <td><span className={`${styles.riskBadge} ${item.riesgo.requires_attention ? styles.riskAttention : styles.riskNeutral}`}>{item.riesgo.label}</span></td><td><Link aria-label={`Abrir ${item.numero_pravia}`} className={styles.rowAction} to={`/expedientes/${item.id}`}><MoreHorizontal size={18} /></Link></td>
  </tr>)}</tbody></table></div>; }
