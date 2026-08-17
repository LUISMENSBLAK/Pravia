import { MoreHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { Prospect } from '../prospects.types';
import { displayProspectName, SUBSTATUS_LABELS } from '../prospects.types';
import styles from '../ProspectsPage.module.css';

const dateTime = (value: string) => new Intl.DateTimeFormat('es-MX', {
  day: '2-digit', month: 'short', year: 'numeric',
}).format(new Date(value));

const priorityLabel = { ALTA: 'Alta', MEDIA: 'Media', BAJA: 'Baja' } as const;

export function ProspectList({ prospects }: { prospects: Prospect[] }) {
  const navigate = useNavigate();
  const open = (id: string) => navigate(`/prospectos/${id}`);
  return (
    <section className={styles.listView} aria-label="Lista de prospectos">
      <div className={styles.listTableWrap}>
        <table>
          <thead><tr><th className={styles.stickyProspect}>Prospecto</th><th>Servicio</th><th>Etapa</th><th>Prioridad</th><th>Siguiente acción</th><th>Última actividad</th><th className={styles.stickyResponsible}>Responsable</th><th className={styles.stickyActions}><span className={styles.srOnly}>Acciones</span></th></tr></thead>
          <tbody>{prospects.map((prospect) => {
            const latest = prospect.seguimientos?.[0];
            return <tr key={prospect.id}>
              <td className={styles.stickyProspect}><button type="button" className={styles.prospectLink} onClick={() => open(prospect.id)}><strong>{displayProspectName(prospect.nombre)}</strong><small>{SUBSTATUS_LABELS[prospect.estado]}</small></button></td>
              <td>{prospect.servicio_catalogo?.label || prospect.tipo_acto || 'Por definir'}</td>
              <td>{prospect.etapa_operativa?.label ? <span className={styles.operationalStagePill}>{prospect.etapa_operativa.label}</span> : <span className={styles.legacyStage}>Sin etapa</span>}</td>
              <td><span className={`${styles.priority} ${styles[`priority${prospect.prioridad}`]}`}>{priorityLabel[prospect.prioridad]}</span></td>
              <td><span className={styles.nextAction}>{latest?.proxima_accion || 'Sin siguiente acción'}</span></td>
              <td>{dateTime(latest?.created_at ?? prospect.updated_at)}</td>
              <td className={styles.stickyResponsible}>{prospect.atendido_por?.nombre || 'Sin asignar'}</td>
              <td className={styles.stickyActions}><button type="button" className={styles.rowAction} onClick={() => open(prospect.id)} aria-label={`Abrir prospecto ${displayProspectName(prospect.nombre)}`}><MoreHorizontal size={18} /></button></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </section>
  );
}
