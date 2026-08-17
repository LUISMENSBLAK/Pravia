import { CheckCircle2, Mail, Phone, UserRound } from 'lucide-react';
import type { NotariaDetail } from '../notarias.types';
import styles from '../Notarias.module.css';

export function NotariaContacts({ item, canWrite, changing, onSetPrimary }: { item: NotariaDetail; canWrite: boolean; changing: string | null; onSetPrimary(contactId: string): void }) {
  const contacts = item.contactos.filter((value) => value.activo);
  return <section className={styles.sectionCard}><header><div><h2>Contactos operativos</h2><p>Personas y canales registrados para la atención de asuntos.</p></div></header>{contacts.length ? <div className={styles.contactsGrid}>{contacts.map((contact) => {
    const primary = item.contacto_principal_id === contact.id || (!item.contacto_principal_id && item.contacto_principal === contact.nombre);
    return <article key={contact.id}><header><span><UserRound size={17} /></span><div><strong>{contact.nombre}</strong><small>{contact.cargo || 'Sin cargo registrado'}</small></div>{primary && <b><CheckCircle2 size={12} />Principal</b>}</header><ul>{contact.telefono && <li><Phone size={14} />{contact.telefono}</li>}{contact.correo && <li><Mail size={14} />{contact.correo}</li>}</ul>{contact.observaciones && <p>{contact.observaciones}</p>}{canWrite && !primary && <button type="button" className={styles.contactAction} disabled={changing === contact.id} onClick={() => onSetPrimary(contact.id)}>{changing === contact.id ? 'Guardando...' : 'Marcar como principal'}</button>}</article>;
  })}</div> : <p className={styles.sectionEmpty}>No hay contactos operativos registrados.</p>}</section>;
}
