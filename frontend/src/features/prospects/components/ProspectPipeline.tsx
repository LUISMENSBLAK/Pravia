import type { Prospect, ProspectListMeta, ProspectStage } from '../prospects.types';
import { STAGES, stageForState } from '../prospects.types';
import { ProspectColumn } from './ProspectColumn';
import styles from '../ProspectsPage.module.css';

export function ProspectPipeline({ prospects, meta, mobileStage, onMobileStage, onCreate }: { prospects: Prospect[]; meta: ProspectListMeta | null; mobileStage: ProspectStage; onMobileStage: (stage: ProspectStage) => void; onCreate?: () => void }) {
  const grouped = Object.fromEntries(STAGES.map((stage) => [stage.id, prospects.filter((item) => stageForState(item.estado) === stage.id)])) as Record<ProspectStage, Prospect[]>;
  const totals = Object.fromEntries(STAGES.map((stage) => [stage.id, stage.states.reduce((sum, state) => sum + (meta?.countsByState[state] ?? grouped[stage.id].filter((item) => item.estado === state).length), 0)])) as Record<ProspectStage, number>;
  return (
    <section aria-label="Pipeline de prospectos">
      <div className={styles.stageTabs} role="tablist" aria-label="Etapas del pipeline">
        {STAGES.map((stage) => <button key={stage.id} type="button" role="tab" aria-selected={mobileStage === stage.id} onClick={() => onMobileStage(stage.id)}>{stage.label}<span>{totals[stage.id]}</span></button>)}
      </div>
      <div className={styles.pipeline}>
        {STAGES.map((stage) => <ProspectColumn key={stage.id} id={stage.id} label={stage.label} prospects={grouped[stage.id]} total={totals[stage.id]} onCreate={onCreate} />)}
      </div>
      <div className={styles.mobileColumn}><ProspectColumn id={mobileStage} label={STAGES.find((item) => item.id === mobileStage)?.label ?? ''} prospects={grouped[mobileStage]} total={totals[mobileStage]} onCreate={onCreate} /></div>
    </section>
  );
}
