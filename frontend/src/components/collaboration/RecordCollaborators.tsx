import { useCallback, useEffect, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { apiRequest } from '../../services/api/client';
import styles from './RecordCollaborators.module.css';

type Kind = 'prospecto' | 'cotizacion' | 'expediente';
type Member = { user_id: string; rol: string; user: { nombre: string; apellido: string } };
type Assignment = { id: string; user_id: string; assigned_at: string; membership: Member };

export function RecordCollaborators({ kind, recordId, canManage }: { kind: Kind; recordId: string; canManage: boolean }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [candidates, setCandidates] = useState<Member[]>([]);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const base = `/collaboration/${kind}/${recordId}/asistentes`;
  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const [assigned, eligible] = await Promise.all([
        apiRequest<{ data: Assignment[] }>(base, { signal }),
        canManage ? apiRequest<{ data: Member[] }>(`${base}/candidatos`, { signal }) : Promise.resolve({ data: [] }),
      ]);
      setAssignments(assigned.data);
      setCandidates(eligible.data);
      setError('');
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError('No fue posible cargar los colaboradores.');
    }
  }, [base, canManage]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const assign = async () => {
    if (!selected || busy) return;
    setBusy(true);
    try {
      await apiRequest(base, { method: 'POST', body: JSON.stringify({ user_id: selected }) });
      setSelected('');
      await load();
    } catch { setError('No fue posible asignar a esta persona. Verifica sus permisos y vuelve a intentarlo.'); }
    finally { setBusy(false); }
  };
  const revoke = async (userId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await apiRequest(`${base}/${userId}`, { method: 'DELETE' });
      await load();
    } catch { setError('No fue posible retirar al colaborador.'); }
    finally { setBusy(false); }
  };
  const available = candidates.filter((candidate) => !assignments.some((assignment) => assignment.user_id === candidate.user_id));
  return <section className={styles.panel} aria-label="Colaboradores autorizados">
    <header><h2>Colaboradores</h2><p>La lectura se comparte con la notaría; la edición requiere asignación y permiso del módulo.</p></header>
    {error && <p className={styles.error} role="alert">{error} <button type="button" onClick={() => void load()}>Reintentar</button></p>}
    {assignments.length ? <ul className={styles.list}>{assignments.map((assignment) => <li key={assignment.id}>
      <span><strong>{assignment.membership.user.nombre} {assignment.membership.user.apellido}</strong><small>{assignment.membership.rol}</small></span>
      {canManage && <button type="button" className={styles.remove} disabled={busy} aria-label={`Retirar a ${assignment.membership.user.nombre} ${assignment.membership.user.apellido}`} onClick={() => void revoke(assignment.user_id)}><X size={17} /></button>}
    </li>)}</ul> : <p className={styles.empty}>Sin colaboradores asignados.</p>}
    {canManage && <div className={styles.add}>
      <label htmlFor={`collaborator-${kind}-${recordId}`}>Asignar colaborador</label>
      <div><select id={`collaborator-${kind}-${recordId}`} value={selected} onChange={(event) => setSelected(event.target.value)} disabled={busy || !available.length}>
        <option value="">Selecciona una persona</option>
        {available.map((member) => <option key={member.user_id} value={member.user_id}>{member.user.nombre} {member.user.apellido} · {member.rol}</option>)}
      </select><button type="button" disabled={busy || !selected} onClick={() => void assign()}><UserPlus size={17} />Asignar</button></div>
    </div>}
  </section>;
}
