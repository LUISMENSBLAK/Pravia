import { ChevronRight, FileText, Folder } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import type { ComparecienteListItem, HealthState, IdentityState } from '../comparecientes.types';
import styles from '../Comparecientes.module.css';

const identityLabel: Record<IdentityState, string> = { VERIFICADA: 'Verificada', PENDIENTE: 'Pendiente', OBSERVACION: 'Observación' };
const stateClass = (state: string) => styles[`state_${state}`] || styles.state_NO_CONFIGURADO;
export const formatDate = (value: string) => new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
export const documentLabel = (item: ComparecienteListItem) => item.documentos.total === 0 ? 'Sin documentos' : item.documentos.con_observacion ? `${item.documentos.total} · revisar` : `${item.documentos.total} vinculados`;

export function ComparecienteTable({ items }: { items: ComparecienteListItem[] }) {
  const navigate = useNavigate();
  const open = (id: string) => navigate(`/comparecientes/${id}`);
  return <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Nombre / Razón social</th><th>Tipo de persona</th><th>RFC</th><th>Expedientes</th><th>Identidad</th><th>Documentos</th><th>Actualización</th><th><span className={styles.srOnly}>Acciones</span></th></tr></thead><tbody>{items.map((item) => <tr key={item.id} className={styles.actionableRow} tabIndex={0} aria-label={`Abrir ficha de ${item.nombre}`} onClick={() => open(item.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(item.id); } }}><td><span className={styles.nameLink}>{item.nombre}</span>{item.curp && <small>CURP · {item.curp}</small>}</td><td><span className={styles.typeBadge}>{item.tipo_persona === 'FISICA' ? 'Física' : 'Moral'}</span></td><td className={!item.rfc ? styles.missing : ''}>{item.rfc || 'Sin RFC'}</td><td><span className={styles.countLink}><Folder size={15} />{item.expedientes_vinculados}</span></td><td><span className={`${styles.stateBadge} ${stateClass(item.identidad)}`}>{identityLabel[item.identidad]}</span></td><td><span className={styles.documentCell}><FileText size={15} />{documentLabel(item)}</span></td><td><time dateTime={item.updated_at}>{formatDate(item.updated_at)}</time></td><td><Link className={styles.rowAction} aria-label={`Abrir ${item.nombre}`} to={`/comparecientes/${item.id}`} onClick={(event) => event.stopPropagation()}><ChevronRight size={18} /></Link></td></tr>)}</tbody></table></div>;
}

export function StatusBadge({ state }: { state: HealthState | IdentityState }) { const labels: Record<string, string> = { VERIFICADA: 'Verificada', COMPLETO: 'Completo', PENDIENTE: 'Pendiente', OBSERVACION: 'Observación', NO_APLICA: 'No aplica', NO_CONFIGURADO: 'No configurado' }; return <span className={`${styles.stateBadge} ${stateClass(state)}`}>{labels[state]}</span>; }
