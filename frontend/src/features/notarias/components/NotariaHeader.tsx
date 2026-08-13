import { MoreHorizontal, Pencil, Plus, Users } from 'lucide-react';
import type { NotariaDetail } from '../notarias.types';
import { StatusBadge } from './NotariaTable';
import styles from '../Notarias.module.css';

export function NotariaHeader({ item, canWrite, onEdit, onContact }: { item:NotariaDetail; canWrite:boolean; onEdit():void; onContact():void }) { return <header className={styles.workspaceHeader}><div className={styles.headerMain}><div className={styles.headerEyebrow}><StatusBadge status={item.estatus}/>{item.predeterminada&&<span>Predeterminada</span>}</div><h1>{item.etiqueta}</h1><p>{item.titular||'Sin titular registrado'} · {[item.ciudad||item.municipio,item.entidad_federativa].filter(Boolean).join(', ')}</p></div>{canWrite&&<div className={styles.workspaceActions}><button type="button" className={styles.secondaryButton} onClick={onEdit}><Pencil size={15}/>Editar</button><button type="button" className={styles.primaryButton} onClick={onContact}><Plus size={16}/><Users size={15}/>Agregar contacto</button><button type="button" className={styles.iconButton} aria-label="Más acciones"><MoreHorizontal size={18}/></button></div>}</header>; }
