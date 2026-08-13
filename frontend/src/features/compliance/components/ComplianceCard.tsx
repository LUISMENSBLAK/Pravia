import { AlertTriangle, ArrowUpRight, Building2, Clock3, FileText, ShieldCheck, UsersRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { ComplianceReview } from '../compliance.types';
import { humanResult, humanStatus, shortDate } from '../compliance.utils';
import styles from '../Compliance.module.css';

export function ComplianceCard({ review }: { review: ComplianceReview }) { const navigate=useNavigate(); const count=review.expediente?.comparecientes?.length || 0; return <article className={styles.reviewCard} tabIndex={0} role="link" onClick={()=>navigate(`/riesgos/revisiones/${review.id}`)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();navigate(`/riesgos/revisiones/${review.id}`);}}}>
  <header><span data-type={review.tipo}>{review.tipo==='UIF'?<ShieldCheck/>:<FileText/>}{review.tipo}</span><b data-status={review.estatus}>{humanStatus(review.estatus)}</b></header>
  <h3>{review.expediente?.numero_pravia}</h3><p>{review.expediente?.tipo_acto?.nombre || review.expediente?.cliente_alias || 'Acto por identificar'}</p>
  <dl><div><dt><UsersRound/>Comparecientes</dt><dd>{count}</dd></div><div><dt><Building2/>Notaría</dt><dd>{review.expediente?.notaria?.numero_notaria || 'Sin asignar'}</dd></div><div><dt><Clock3/>Actualización</dt><dd>{shortDate(review.updated_at)}</dd></div></dl>
  <footer>{review.resultado_json?.alertas?.length ? <span className={styles.attention}><AlertTriangle/>{review.resultado_json.alertas.length} alerta{review.resultado_json.alertas.length>1?'s':''}</span> : <span>{humanResult(review.resultado_json?.clasificacion)}</span>}<ArrowUpRight/></footer>
 </article>; }
