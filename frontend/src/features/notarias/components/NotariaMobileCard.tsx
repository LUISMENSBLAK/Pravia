import { FolderKanban, Mail, Phone } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { NotariaListItem } from '../notarias.types';
import { StatusBadge } from './NotariaTable';
import styles from '../Notarias.module.css';

export function NotariaMobileCard({ item }: { item: NotariaListItem }) { return <Link to={`/notarias/${item.id}`} className={styles.mobileCard}><header><div><small>{item.nombre !== item.etiqueta ? item.nombre : 'Oficina notarial'}</small><h2>{item.etiqueta}</h2></div><StatusBadge status={item.estatus}/></header><p>{item.titular || 'Sin titular registrado'}</p><strong>{[item.ciudad,item.entidad_federativa].filter(Boolean).join(', ')}</strong><div className={styles.mobileContacts}>{item.contacto.telefono&&<span><Phone size={13}/>{item.contacto.telefono}</span>}{item.contacto.correo&&<span><Mail size={13}/>{item.contacto.correo}</span>}{!item.contacto.telefono&&!item.contacto.correo&&<span>Sin contacto registrado</span>}</div><footer><span><FolderKanban size={14}/>{item.expedientes_activos} expedientes activos</span><b>Ver detalle</b></footer></Link>; }
