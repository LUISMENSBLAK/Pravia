import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { ExpedienteListItem } from '../expedientes.types';
import { fullName, macroLabels, shortDateTime } from '../expedienteFormatters';
import styles from '../Expedientes.module.css';
export function ExpedienteMobileCard({ item }: { item: ExpedienteListItem }) { return <Link className={styles.mobileCard} to={`/expedientes/${item.id}`}><header><span>{item.numero_pravia}</span><span className={`${styles.phaseBadge} ${styles[`phase${item.macrofase}`]}`}>{macroLabels[item.macrofase]}</span></header><h3>{item.tipo_acto.nombre}</h3><p>{item.cliente_principal}{item.comparecientes_adicionales ? ` +${item.comparecientes_adicionales}` : ''}</p><dl><div><dt>Etapa</dt><dd>{item.etapaActual?.nombre_snapshot || item.etapa_actual_nombre || 'Sin etapa'}</dd></div><div><dt>Responsable</dt><dd>{fullName(item.abogado)}</dd></div><div><dt>Riesgo</dt><dd className={item.riesgo.requires_attention ? styles.attentionText : ''}>{item.riesgo.label}</dd></div></dl><footer><time>{shortDateTime(item.updated_at)}</time><ChevronRight size={18} /></footer></Link>; }
