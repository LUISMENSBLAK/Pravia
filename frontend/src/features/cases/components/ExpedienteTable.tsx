import { MoreHorizontal } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { ExpedienteListItem, ExpedienteListResult } from '../expedientes.types';
import { fullName, macroLabels } from '../expedienteFormatters';
import { ExpedienteFilters } from './ExpedienteFilters';
import styles from '../Expedientes.module.css';
type Props = { items: ExpedienteListItem[]; values: Record<string, string>; facets: ExpedienteListResult['facets']; onChange(field: string, value: string): void };
export function ExpedienteTable({ items, values, facets, onChange }: Props) { const navigate = useNavigate(); const open = (id: string) => navigate(`/expedientes/${id}`); return <div className={styles.tableWrap}><table className={styles.table}><thead><ExpedienteFilters values={values} facets={facets} onChange={onChange} /></thead><tbody>{items.map((item) => <tr key={item.id} tabIndex={0} aria-label={`Abrir expediente ${item.numero_pravia}`} onClick={() => open(item.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(item.id); } }}>
  <td><span className={styles.folio}>{item.numero_pravia}</span></td><td title={item.tipo_acto.nombre}>{item.tipo_acto.nombre}</td><td title={item.cliente_principal}><strong>{item.cliente_principal}</strong>{item.comparecientes_adicionales > 0 && <small>+{item.comparecientes_adicionales}</small>}</td>
  <td><span className={`${styles.phaseBadge} ${styles[`phase${item.macrofase}`]}`}>{macroLabels[item.macrofase]}</span><small>{item.etapa_operativa?.nombre || 'Sin actividad pendiente'}</small></td>
  <td className={!item.abogado ? styles.unassigned : ''}>{fullName(item.abogado)}</td><td>{item.numero_escritura || '—'}</td><td>{item.fecha_escritura ? new Intl.DateTimeFormat('es-MX').format(new Date(item.fecha_escritura)) : '—'}</td>
  <td><span className={`${styles.riskBadge} ${item.vulnerable?.value ? styles.riskAttention : styles.riskNeutral}`}>{item.vulnerable?.label || 'Sin evaluar'}</span></td><td><span className={`${styles.riskBadge} ${item.cumplimiento?.state === 'VENCIDO' ? styles.riskAttention : styles.riskNeutral}`}>{item.cumplimiento?.label || 'Sin evaluar'}</span></td><td><Link aria-label={`Abrir ${item.numero_pravia}`} className={styles.rowAction} to={`/expedientes/${item.id}`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}><MoreHorizontal size={18} /></Link></td>
  </tr>)}</tbody></table></div>; }
