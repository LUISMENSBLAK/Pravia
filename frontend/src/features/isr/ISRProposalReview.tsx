import { useState } from 'react';
import { Check, X } from 'lucide-react';
import type { ISRProposal, ISRV3Party } from './isr.types';
import styles from './ISR.module.css';

const labels: Record<ISRProposal['status'], string> = { ACEPTADA: 'Confirmada', RECHAZADA: 'Descartada', CONFLICTO: 'Requiere aclaración', PENDIENTE: 'Pendiente de revisión' };
export function ISRProposalReview({ proposal, parties, disabled, onReview }: {
  proposal: ISRProposal; parties: ISRV3Party[]; disabled: boolean;
  onReview(action: 'ACEPTADA' | 'RECHAZADA', partyId?: string): void;
}) {
  const [partyId, setPartyId] = useState('');
  const identity = /^(rfc|curp|nombre|nombre_completo|razon_social|taxpayer\.(rfc|curp|fullName))$/.test(proposal.field_path);
  const partyProposal = proposal.field_path === 'party';
  const requiresParty = identity || partyProposal;
  let partyValue: Record<string, unknown> | null = null;
  if (partyProposal) { try { partyValue = JSON.parse(String(proposal.proposed_value)); } catch { /* Invalid backend proposal cannot be applied. */ } }
  const pending = proposal.status === 'PENDIENTE' || proposal.status === 'CONFLICTO';
  return <article><div className={styles.proposalMeta}><span>Fuente: {proposal.source_document_name}{proposal.source_page ? ` · pág. ${proposal.source_page}` : ''}</span><span>{labels[proposal.status]}</span></div>
    {partyValue ? <dl>{Object.entries(partyValue).filter(([, value]) => value !== null).map(([key, value]) => <div key={key}><dt>{{ name: 'Nombre', role: 'Carácter', percentage: 'Participación (%)', acquisitionDate: 'Fecha de adquisición', historicalLandCost: 'Costo histórico terreno', historicalConstructionCost: 'Costo histórico construcción' }[key] || key}</dt><dd>{key === 'role' ? value === 'ENAJENANTE' ? 'Enajenante' : 'Adquirente' : String(value)}</dd></div>)}</dl> : <strong>{proposal.field_path === 'property.type' ? ({ TERRENO: 'Terreno', CASA_HABITACION: 'Casa habitación', TERRENO_CONSTRUCCION: 'Terreno y construcción', CONSTRUCCION_COMERCIAL: 'Construcción comercial', USO_MIXTO: 'Uso mixto', OTRO: 'Otro' } as Record<string, string>)[String(proposal.proposed_value)] || 'Tipo pendiente de revisión' : String(proposal.proposed_value)}</strong>}
    <small>{({ party: 'Parte de la operación', operationDate: 'Fecha de enajenación', 'values.operation': 'Valor de operación', 'values.appraisal': 'Valor de avalúo', 'values.cadastral': 'Valor catastral', 'values.landSale': 'Valor de enajenación terreno', 'values.constructionSale': 'Valor de enajenación construcción', 'property.type': 'Tipo de inmueble', nombre_completo: 'Nombre completo', rfc: 'RFC', curp: 'CURP' } as Record<string, string>)[proposal.field_path] || 'Dato documental de apoyo'}</small>
    {proposal.source_fragment && <p>{proposal.source_fragment}</p>}
    {pending && proposal.application?.can_apply === false ? <p>Dato de apoyo: revísalo en la ficha correspondiente; no modifica automáticamente una variable fiscal.</p> : pending && <>{requiresParty && <label>Persona del cálculo<select aria-label="Persona del cálculo para este dato" value={partyId} disabled={disabled} onChange={(event) => setPartyId(event.target.value)}>
      <option value="">Selecciona a quién corresponde</option>{partyProposal && <option value="NEW_PARTY">Agregar como nueva parte del cálculo</option>}{parties.map((party) => <option key={party.id} value={party.id}>{party.name || 'Sin nombre'} · {party.role === 'ENAJENANTE' ? 'Enajenante' : 'Adquirente'}</option>)}
    </select></label>}<div><button type="button" disabled={disabled} onClick={() => onReview('RECHAZADA')}><X />Descartar</button>
      <button type="button" aria-label="Usar este dato" disabled={disabled || (requiresParty && !partyId) || (partyProposal && !partyValue)} onClick={() => onReview('ACEPTADA', partyId || undefined)}><Check />Usar este dato</button></div></>}
  </article>;
}
