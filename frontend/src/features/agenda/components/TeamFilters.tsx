import { Search, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AgendaUser } from '../agenda.types';
import { humanizeRole } from '../../../lib/formatters';
import styles from '../Agenda.module.css';

export function TeamFilters({ users, selected, canManage, onChange }: { users: AgendaUser[]; selected: string[]; canManage: boolean; onChange(ids: string[]): void }) {
  const [search, setSearch] = useState(''); const visible = useMemo(() => users.filter((user) => `${user.nombre} ${user.apellido}`.toLowerCase().includes(search.toLowerCase())), [search, users]);
  const all = selected.length === 0;
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item)=>item!==id) : [...selected,id]);
  return <section className={styles.teamFilters}><header><span><UsersRound size={17}/></span><div><h2>Equipo</h2><p>{canManage?'Agendas dentro de tu alcance':'Tu agenda personal'}</p></div></header>{canManage&&<label className={styles.teamSearch}><Search size={15}/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Buscar miembro" aria-label="Buscar miembro"/></label>}<div className={styles.teamList}>{canManage&&<label><input type="checkbox" checked={all} onChange={()=>onChange([])}/><span>Todos</span></label>}{visible.map((user)=><label key={user.id}><input type="checkbox" checked={all||selected.includes(user.id)} onChange={()=>toggle(user.id)} disabled={!canManage}/><i>{user.nombre.charAt(0)}{user.apellido.charAt(0)}</i><span>{user.nombre} {user.apellido}<small>{humanizeRole(user.rol)}</small></span></label>)}</div></section>;
}
