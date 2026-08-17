import { Building2, FileText, FolderOpen, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ComparecienteListItem } from '../comparecientes.types';
import { documentLabel, formatDate } from './ComparecienteTable';
import styles from '../Comparecientes.module.css';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();

export function ComparecienteCards({ items }: { items: ComparecienteListItem[] }) {
  return <div className={styles.cardGrid} aria-label="Vista de tarjetas de comparecientes">{items.map((item) => <Link key={item.id} to={`/comparecientes/${item.id}`} className={styles.partyCard} aria-label={`Abrir ficha de ${item.nombre}`}>
    <header><span className={styles.partyAvatar} aria-hidden="true">{item.tipo_persona === 'FISICA' ? <UserRound /> : <Building2 />}<b>{initials(item.nombre)}</b></span><div><span className={styles.typeBadge}>{item.tipo_persona === 'FISICA' ? 'Persona física' : 'Persona moral'}</span></div></header>
    <section><h2>{item.nombre}</h2><p className={!item.rfc ? styles.missing : ''}>{item.rfc ? `RFC · ${item.rfc}` : 'Sin RFC'}</p>{item.curp && <small>CURP · {item.curp}</small>}</section>
    <dl><div><dt><FolderOpen />Expedientes</dt><dd>{item.expedientes_vinculados}</dd></div><div><dt><FileText />Documentos</dt><dd>{documentLabel(item)}</dd></div></dl>
    <footer><span>Actualizado</span><time dateTime={item.updated_at}>{formatDate(item.updated_at)}</time></footer>
  </Link>)}</div>;
}
