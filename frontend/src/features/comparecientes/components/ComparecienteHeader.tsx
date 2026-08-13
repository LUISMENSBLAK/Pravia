import { ArrowLeft, FilePlus2, MoreHorizontal, Pencil } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ComparecienteDetail } from '../comparecientes.types';
import { StatusBadge } from './ComparecienteTable';
import styles from '../Comparecientes.module.css';

export function ComparecienteHeader({ item, onUpload, onEdit }: { item: ComparecienteDetail; onUpload(): void; onEdit(): void }) { return <><Link className={styles.backLink} to="/comparecientes"><ArrowLeft size={16} />Volver a comparecientes</Link><header className={styles.workspaceHeader}><div className={styles.headerMain}><div className={styles.headerEyebrow}><span>{item.tipo_persona === 'FISICA' ? 'Persona física' : 'Persona moral'}</span><StatusBadge state={item.identidad} /></div><h1>{item.nombre}</h1><p>{item.rfc ? `RFC · ${item.rfc}` : 'Sin RFC'}{item.curp ? ` · CURP · ${item.curp}` : ''}</p></div><div className={styles.workspaceActions}><button type="button" className={styles.secondaryButton} onClick={onEdit}><Pencil size={16} />Editar</button><button type="button" className={styles.primaryButton} onClick={onUpload}><FilePlus2 size={16} />Agregar documento</button><button type="button" className={styles.iconButton} aria-label="Más acciones"><MoreHorizontal /></button></div></header></>; }
