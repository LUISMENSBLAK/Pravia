import { FolderKanban, Mail, MapPin, Phone, UserRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { NotariaListItem } from '../notarias.types';
import styles from '../Notarias.module.css';

export function NotariaCard({ item }: { item: NotariaListItem }) {
  return <Link to={`/notarias/${item.id}`} className={styles.notariaCard} aria-label={`Abrir ${item.etiqueta}`}>
    <header><div><small>{item.nombre !== item.etiqueta ? item.nombre : 'Oficina notarial'}</small><h2>{item.etiqueta}</h2></div><span>{item.entidad_federativa}</span></header>
    <p><UserRound size={14} />{item.titular || 'Sin titular registrado'}</p>
    <p><MapPin size={14} />{[item.ciudad || item.municipio, item.entidad_federativa].filter(Boolean).join(', ')}</p>
    <div className={styles.cardContacts}>{item.contacto.telefono && <span><Phone size={13} />{item.contacto.telefono}</span>}{item.contacto.correo && <span><Mail size={13} />{item.contacto.correo}</span>}{!item.contacto.telefono && !item.contacto.correo && <span>Sin contacto registrado</span>}</div>
    <footer><span><FolderKanban size={14} />{item.expedientes_activos} expedientes activos</span><b>Ver detalle</b></footer>
  </Link>;
}
