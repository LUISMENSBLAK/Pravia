import type { Prospect, ProspectPipelineStage } from '../prospects.types';
import { PIPELINE_STAGES } from '../prospects.types';
import { ProspectColumn } from './ProspectColumn';
import styles from '../ProspectsPage.module.css';

export function ProspectPipeline({ lanes, totals, mobileStage, loadingStage, onMobileStage, onLoadMore, onCreate }: { lanes: Record<ProspectPipelineStage, Prospect[]>; totals: Record<ProspectPipelineStage, number>; mobileStage: ProspectPipelineStage; loadingStage: ProspectPipelineStage | null; onMobileStage: (stage: ProspectPipelineStage) => void; onLoadMore: (stage: ProspectPipelineStage) => void; onCreate?: () => void }) {
  return (
    <section aria-label="Pipeline de prospectos">
      <div className={styles.stageTabs} role="tablist" aria-label="Etapas del pipeline">
        {PIPELINE_STAGES.map((stage) => <button key={stage.id} type="button" role="tab" aria-selected={mobileStage === stage.id} onClick={() => onMobileStage(stage.id)}>{stage.label}<span>{totals[stage.id]}</span></button>)}
      </div>
      <div className={styles.pipeline}>
        {PIPELINE_STAGES.map((stage) => <ProspectColumn key={stage.id} id={stage.id} label={stage.label} prospects={lanes[stage.id]} total={totals[stage.id]} loadingMore={loadingStage === stage.id} onLoadMore={() => onLoadMore(stage.id)} onCreate={onCreate} />)}
      </div>
      <div className={styles.mobileColumn}><ProspectColumn id={mobileStage} label={PIPELINE_STAGES.find((item) => item.id === mobileStage)?.label ?? ''} prospects={lanes[mobileStage]} total={totals[mobileStage]} loadingMore={loadingStage === mobileStage} onLoadMore={() => onLoadMore(mobileStage)} onCreate={onCreate} /></div>
    </section>
  );
}
