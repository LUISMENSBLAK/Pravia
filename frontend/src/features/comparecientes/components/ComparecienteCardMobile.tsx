import { FileText, Folder } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ComparecienteListItem } from '../comparecientes.types';
import { documentLabel, formatDate, StatusBadge } from './ComparecienteTable';
import styles from '../Comparecientes.module.css';

export function ComparecienteCardMobile({ item }: { item: ComparecienteListItem }) { return <Link to={`/comparecientes/${item.id}`} className={styles.mobileCard}><header><span className={styles.typeBadge}>{item.tipo_persona === 'FISICA' ? 'Persona física' : 'Persona moral'}</span><StatusBadge state={item.identidad} /></header><h2>{item.nombre}</h2><p className={!item.rfc ? styles.missing : ''}>{item.rfc || 'Sin RFC'}</p><dl><div><dt>Expedientes</dt><dd><Folder size={14} />{item.expedientes_vinculados}</dd></div><div><dt>Documentos</dt><dd><FileText size={14} />{documentLabel(item)}</dd></div></dl><footer><span>Actualizado</span><time dateTime={item.updated_at}>{formatDate(item.updated_at)}</time></footer></Link>; }
