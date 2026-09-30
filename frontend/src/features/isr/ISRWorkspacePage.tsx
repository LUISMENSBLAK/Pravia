import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, Bot, Calculator, Check, Download, FilePlus2, FileSearch, HelpCircle, History, LoaderCircle, Plus, Save, Trash2, X } from 'lucide-react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { PageContainer } from '../../components/layout/PageContainer';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { DocumentViewer } from '../../components/documents/DocumentViewer';
import { AIProcessingStatus } from '../../components/feedback/AIProcessingStatus';
import { useAuth } from '../auth/AuthProvider';
import { resolveExpedienteReturn } from '../cases/expedienteNavigation';
import { fixtureRecord } from './isr.fixtures';
import { isrService } from './isr.service';
import type { ISRInput, ISRProposal, ISRRecord, ISRResources, ISRV3Input, ISRV3Party, ISRV3Result, ISRV3Trace } from './isr.types';
import styles from './ISR.module.css';

const money = (value?: string | null) => value === null || value === undefined ? '—' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(value || 0));
const humanError = (reason: unknown) => reason instanceof Error ? reason.message : 'No fue posible completar la operación.';
const isV3 = (value: unknown): value is ISRV3Input => Boolean(value && typeof value === 'object' && (value as { schemaVersion?: number }).schemaVersion === 3);
const isV3Result = (value: unknown): value is ISRV3Result => Boolean(value && typeof value === 'object' && (value as { schemaVersion?: number }).schemaVersion === 3);
const uuid = () => crypto.randomUUID();
const legalStatusLabels: Record<ISRV3Result['iva']['status'], string> = {
  GRAVADO: 'Gravado',
  EXENTO: 'Exento',
  EXENTO_PARCIALMENTE: 'Exento parcialmente',
  NO_GENERADO: 'No generado',
  NO_APLICA: 'No aplica',
  PENDIENTE_INFORMACION: 'Pendiente de información',
};

const emptyV3 = (): ISRV3Input => ({
  schemaVersion: 3, taxYear: new Date().getFullYear(), operationDate: '',
  act: { name: '', fiscalClassification: 'OTRO', otherDescription: '' },
  property: { type: 'TERRENO', sameAcquisitionDate: true },
  values: { operation: '', appraisal: '', cadastral: '', landSale: '', constructionSale: '' },
  calculateIVA: false, parties: [], deductions: [],
});

const fiscalClassification = (name = ''): ISRV3Input['act']['fiscalClassification'] => {
  const value = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  if (value.includes('COMPRAVENTA')) return 'COMPRAVENTA';
  if (value.includes('PERMUTA')) return 'PERMUTA';
  if (value.includes('DACION')) return 'DACION_PAGO';
  if (value.includes('ADJUDIC')) return 'ADJUDICACION';
  if (value.includes('DONACION')) return 'DONACION';
  if (value.includes('FIDEICOM')) return 'FIDEICOMISO';
  if (value.includes('APORTACION')) return 'APORTACION';
  return 'OTRO';
};

/** Adaptación única de históricos al editor v3. No reescribe el snapshot guardado
 * hasta que un usuario lo guarda expresamente. Los datos no demostrables quedan vacíos. */
const legacyToV3 = (legacy: ISRInput): ISRV3Input => {
  const act = legacy.sourceContext?.acts[0];
  const sourceParties = legacy.sourceContext?.parties || [];
  const parties: ISRV3Party[] = sourceParties.map((party, index) => ({
    id: party.comparecienteId || uuid(), role: /adquir/i.test(party.role) ? 'ADQUIRENTE' : 'ENAJENANTE', name: party.name,
    subjectType: party.personType === 'MORAL' ? 'PM_TITULO_II' : 'PF', nationalityCode: party.nationality || 'OTRO',
    fiscalResidence: party.fiscalResidence === 'MEXICO' ? 'MEXICO' : party.fiscalResidence === 'EXTRANJERO' ? 'EXTRANJERO' : 'POR_DETERMINAR', percentage: party.participationPercentage || (sourceParties.length === 1 ? '100' : ''),
    acquisitionLayers: /adquir/i.test(party.role) ? undefined : [{ id: `legacy-${index}`, percentage: party.participationPercentage || '100', acquisitionAct: 'ONEROSA', legalDate: legacy.acquisitionDate, fiscalDate: legacy.acquisitionDate, adjustedLandCost: legacy.deductions.find((item) => item.treatment === 'COSTO_ADQUISICION_ACTUALIZADO')?.updatedAmount || '', adjustedConstructionCost: '0', source: 'Snapshot histórico; requiere confirmación', verified: false }],
  }));
  if (!parties.length && legacy.taxpayer.fullName) parties.push({
    id: uuid(), role: 'ENAJENANTE', name: legacy.taxpayer.fullName, subjectType: legacy.taxpayer.personType === 'MORAL' ? 'PM_TITULO_II' : 'PF', nationalityCode: 'OTRO',
    fiscalResidence: legacy.taxpayer.fiscalResidence === 'MEXICO' ? 'MEXICO' : legacy.taxpayer.fiscalResidence === 'EXTRANJERO' ? 'EXTRANJERO' : 'POR_DETERMINAR', percentage: '100',
    acquisitionLayers: [{ id: uuid(), percentage: '100', acquisitionAct: 'ONEROSA', legalDate: legacy.acquisitionDate, fiscalDate: legacy.acquisitionDate, adjustedLandCost: legacy.deductions.find((item) => item.treatment === 'COSTO_ADQUISICION_ACTUALIZADO')?.updatedAmount || '', adjustedConstructionCost: '0', source: 'Snapshot histórico; requiere confirmación', verified: false }],
  });
  const hasConstruction = Number(legacy.property.constructionSurfaceM2 || 0) > 0;
  const hasCommercial = Number(legacy.property.commercialConstructionSurfaceM2 || 0) > 0;
  return {
    schemaVersion: 3, taxYear: legacy.taxYear, operationDate: legacy.operation?.operationDate || legacy.saleDate,
    act: { id: act?.typeId, name: act?.name || legacy.operation?.operationTypeCode || '', fiscalClassification: fiscalClassification(act?.name || legacy.operation?.operationTypeCode), otherDescription: '' },
    property: { type: hasCommercial ? 'CONSTRUCCION_COMERCIAL' : hasConstruction ? 'TERRENO_CONSTRUCCION' : 'TERRENO', sameAcquisitionDate: legacy.property.landAndConstructionSameAcquisitionDate },
    values: { operation: legacy.salePrice || legacy.property.operationValue || '', appraisal: legacy.property.appraisalValue || '', cadastral: legacy.property.cadastralValue || '', landSale: hasConstruction ? '' : legacy.salePrice, constructionSale: '' },
    calculateIVA: Boolean(legacy.iva?.applies), parties,
    deductions: legacy.deductions.filter((item) => item.included && item.treatment !== 'COSTO_ADQUISICION_ACTUALIZADO').map((item) => ({ id: item.id, concept: item.concept, amount: item.updatedAmount, component: item.appliesTo || 'AMBOS', verified: item.confirmed, supportDocumentId: item.supportDocumentId })),
  };
};

type Viewer = { open: boolean; name: string; mime?: string; url?: string; loading?: boolean; error?: string; documentId?: string };

function Help({ label, traces, onOpen }: { label: string; traces?: ISRV3Trace[]; onOpen(traces: ISRV3Trace[], label: string): void }) {
  return <button type="button" className={styles.v3Help} aria-label={`Fundamento de ${label}`} onClick={() => onOpen(traces || [], label)}><HelpCircle /></button>;
}

export function ISRWorkspacePage() {
  const { id: routeId = 'nuevo' } = useParams();
  const navigate = useNavigate(); const location = useLocation(); const { user } = useAuth();
  const query = new URLSearchParams(location.search); const mode = query.get('fixture') || ''; const fixture = import.meta.env.DEV && Boolean(mode);
  const returnPath = resolveExpedienteReturn(location.search);
  const initialRecord = fixture && routeId !== 'nuevo' ? fixtureRecord(mode) : null;
  const [record, setRecord] = useState<ISRRecord | null>(initialRecord);
  const [input, setInput] = useState<ISRV3Input>(() => initialRecord ? isV3(initialRecord.input_data) ? initialRecord.input_data : legacyToV3(initialRecord.input_data as ISRInput) : emptyV3());
  const [resources, setResources] = useState<ISRResources | null>(null);
  const [loading, setLoading] = useState(routeId !== 'nuevo' && !fixture); const [busy, setBusy] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [viewer, setViewer] = useState<Viewer>({ open: false, name: '' }); const fileRef = useRef<HTMLInputElement>(null);
  const [legalPanel, setLegalPanel] = useState<{ label: string; traces: ISRV3Trace[] } | null>(null);
  const savedRef = useRef(JSON.stringify(input));
  const canWrite = !user?.permissions || user.permissions.includes('isr.write');
  const canCalculate = !user?.permissions || user.permissions.includes('isr.calculate');
  const canGenerate = !user?.permissions || (user.permissions.includes('isr.calculate') && user.permissions.includes('documentos.write'));

  const accept = (next: ISRRecord) => {
    const adapted = isV3(next.input_data) ? next.input_data : legacyToV3(next.input_data as ISRInput);
    setRecord(next); setInput(adapted); savedRef.current = JSON.stringify(adapted);
  };
  useEffect(() => {
    if (routeId === 'nuevo' || fixture) return;
    const controller = new AbortController(); setLoading(true);
    isrService.detail(routeId, controller.signal).then(accept).catch((reason) => !controller.signal.aborted && setError(humanError(reason))).finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [routeId, fixture]);
  useEffect(() => {
    const controller = new AbortController();
    isrService.resources(input.operationDate, controller.signal).then(setResources).catch(() => setResources((current) => current || { legal_date: input.operationDate, references: [], export_profiles: [], rule_sets: [], acts: [], catalogs: {} }));
    return () => controller.abort();
  }, [input.operationDate]);

  const dirty = JSON.stringify(input) !== savedRef.current;
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);
  const leave = () => { if (dirty && !window.confirm('Hay cambios sin guardar. ¿Deseas descartarlos?')) return; navigate(returnPath || '/calculo-isr'); };
  const reload = async (target = record?.id) => { if (!target || fixture) return; accept(await isrService.detail(target)); };

  const save = async () => {
    if (!canWrite) return null; setBusy('save'); setError(''); setNotice('');
    try {
      if (fixture) { const next = { ...(record || fixtureRecord('ready')), input_data: input, datos_modificados: Boolean(record?.ultima_version) }; setRecord(next); savedRef.current = JSON.stringify(input); setNotice('Borrador guardado en la validación local.'); return next; }
      let target = record;
      if (!target) target = await isrService.create({ ejercicio: input.taxYear, tipo_operacion: 'ENAJENACION_INMUEBLE', expediente_id: query.get('expediente') || undefined, idempotency_key: uuid() });
      const updated = await isrService.update(target.id, input, { expected_updated_at: target.updated_at }); accept(updated);
      if (routeId === 'nuevo') navigate(`/calculo-isr/${updated.id}`, { replace: true });
      setNotice('Datos fiscales guardados.'); return updated;
    } catch (reason) { setError(humanError(reason)); return null; } finally { setBusy(''); }
  };
  const calculate = async () => {
    if (!canCalculate) return; setBusy('calculate'); setError('');
    try {
      if (fixture) { setNotice('Fixture local: el motor v3 se valida en las pruebas numéricas independientes.'); return; }
      const target = await save(); if (!target) return;
      await isrService.calculate(target.id, target.ultima_version); await reload(target.id); setNotice('Cálculo v3 generado con reglas y trazabilidad versionadas.');
    } catch (reason) { setError(humanError(reason)); } finally { setBusy(''); }
  };
  const generate = async () => {
    if (!record?.versiones[0]) return; setBusy('document'); setError('');
    try { if (fixture) setNotice('Documento de validación preparado con el formato CFG-002 activo.'); else { await isrService.generatePdf(record.id, record.versiones[0].version); await reload(); setNotice('Documento final generado con el formato CFG-002 vigente.'); } }
    catch (reason) { setError(humanError(reason)); } finally { setBusy(''); }
  };
  const upload = async (file?: File) => {
    if (!file) return; if (!record) { setError('Guarda el cálculo antes de cargar documentos.'); return; }
    setBusy('upload'); try { if (!fixture) { await isrService.upload(record.id, file); await reload(); } else setNotice('Documento agregado al fixture local.'); } catch (reason) { setError(humanError(reason)); } finally { setBusy(''); if (fileRef.current) fileRef.current.value = ''; }
  };
  const preview = async (documentId: string, name: string, mime: string) => {
    setViewer({ open: true, name, mime, loading: true, documentId });
    if (fixture) { setViewer({ open: true, name, mime, error: 'La vista previa fixture no contiene un blob local.', documentId }); return; }
    try { const url = await isrService.preview(record!.id, documentId); setViewer({ open: true, name, mime, url, documentId }); } catch (reason) { setViewer({ open: true, name, mime, error: humanError(reason), documentId }); }
  };
  const extract = async () => {
    if (!record) return; setBusy('extract');
    try { if (!fixture) { await isrService.extract(record.id); await reload(); } else setNotice('La IA propuso datos; ningún valor se aplicó automáticamente.'); } catch (reason) { setError(humanError(reason)); } finally { setBusy(''); }
  };
  const reviewProposal = async (proposal: ISRProposal, action: 'ACEPTADA' | 'RECHAZADA') => {
    if (!record) return;
    if (!fixture) { await isrService.reviewProposal(record.id, proposal.id, action); await reload(); }
    else setRecord({ ...record, propuestas: record.propuestas.map((item) => item.id === proposal.id ? { ...item, status: action } : item) });
  };

  const setAct = (actId: string) => {
    const act = resources?.acts.find((item) => item.id === actId);
    setInput((current) => ({ ...current, act: act ? { id: act.id, name: act.name, fiscalClassification: fiscalClassification(act.name), otherDescription: '' } : { name: 'Otro / no catalogado', fiscalClassification: 'OTRO', otherDescription: '' } }));
  };
  const updateParty = (partyId: string, patch: Partial<ISRV3Party>) => setInput((current) => ({ ...current, parties: current.parties.map((party) => party.id === partyId ? { ...party, ...patch } : party) }));
  const addParty = (role: ISRV3Party['role']) => setInput((current) => ({ ...current, parties: [...current.parties, { id: uuid(), role, name: '', subjectType: 'PF', nationalityCode: 'MX', fiscalResidence: 'POR_DETERMINAR', percentage: '', acquisitionLayers: role === 'ENAJENANTE' ? [] : undefined }] }));
  const addLayer = (partyId: string) => {
    const party = input.parties.find((item) => item.id === partyId)!;
    updateParty(partyId, { acquisitionLayers: [...(party.acquisitionLayers || []), { id: uuid(), percentage: '', acquisitionAct: 'ONEROSA', legalDate: '', fiscalDate: '', adjustedLandCost: '', adjustedConstructionCost: '', source: '', verified: false }] });
  };
  const latest = record?.versiones[0]; const result = latest && isV3Result(latest.result) ? latest.result : null;
  const legacy = record && !isV3(record.input_data) ? record.input_data : null;
  const sellers = input.parties.filter((party) => party.role === 'ENAJENANTE');
  const showConstruction = input.property.type !== 'TERRENO';
  const countries = resources?.catalogs?.countries?.length ? resources.catalogs.countries : [
    { code: 'MX', label: 'México' }, { code: 'US', label: 'Estados Unidos' }, { code: 'CA', label: 'Canadá' }, { code: 'OTRO', label: 'Otro' },
  ];

  if (loading) return <PageContainer title="Cálculo ISR"><div className={styles.loading}>Cargando cálculo…</div></PageContainer>;
  return <PageContainer title="" subtitle="">
    <form className={`${styles.workspace} ${styles.v3Workspace}`} onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <header className={styles.workspaceHeader}>
        <button type="button" className={styles.backButton} onClick={leave}><ArrowLeft />Cálculo ISR</button>
        <div className={styles.workspaceTitle}><div><span>ISR-001 · MOTOR V3</span><h1>{record?.folio || 'Nuevo cálculo ISR'}</h1></div><Badge tone={record?.estado === 'CALCULADO' ? 'success' : 'warning'}>{record?.estado === 'CALCULADO' ? 'Calculado' : 'Borrador'}</Badge></div>
        <div className={styles.headerMeta}><span><strong>Motor</strong>ISR-V3.0</span><span><strong>Ejercicio</strong>{input.taxYear}</span><span><strong>Expediente</strong>{record?.expediente?.numero_pravia || 'Sin vincular'}</span></div>
        <div className={styles.headerActions}><Button type="button" variant="ghost" onClick={leave}>Cancelar</Button><Button type="submit" variant="secondary" disabled={!canWrite || Boolean(busy)}><Save />Guardar borrador</Button><Button type="button" disabled={!canCalculate || Boolean(busy)} onClick={() => void calculate()}><Calculator />{record?.ultima_version ? 'Recalcular' : 'Calcular'}</Button></div>
      </header>
      {error && <div className={styles.error} role="alert"><AlertTriangle />{error}</div>}{notice && <div className={styles.successNotice}><Check />{notice}</div>}
      {legacy && <div className={styles.warning}><AlertTriangle />Este cálculo histórico se presenta en el editor v3. Confirma las capas y fuentes antes de recalcular; el snapshot anterior permanece en su versión.</div>}

      <div className={styles.v3Layout}>
        <main className={styles.v3Flow}>
          <section className={styles.formSection} aria-labelledby="isr-v3-act"><header><div><span>1</span><div><h2 id="isr-v3-act">Acto</h2><p>Catálogo real de Configuración → Actos y tiempos.</p></div></div></header><div className={styles.formGrid}>
            <label className={styles.full}><span>Acto</span><select value={input.act.id || ''} onChange={(event) => setAct(event.target.value)}><option value="">Otro / no catalogado</option>{resources?.acts?.map((act) => <option key={act.id} value={act.id}>{act.name}</option>)}</select></label>
            {input.act.fiscalClassification === 'OTRO' && <label className={styles.full}><span>Especifique</span><input value={input.act.otherDescription || ''} onChange={(event) => setInput({ ...input, act: { ...input.act, otherDescription: event.target.value } })} /></label>}
          </div></section>

          <section className={styles.formSection} aria-labelledby="isr-v3-property"><header><div><span>2</span><div><h2 id="isr-v3-property">Inmueble</h2><p>Características que determinan las ramas fiscales aplicables.</p></div></div></header><div className={styles.formGrid}>
            <label><span>Tipo de inmueble</span><select value={input.property.type} onChange={(event) => setInput({ ...input, property: { ...input.property, type: event.target.value as ISRV3Input['property']['type'] } })}><option value="TERRENO">Terreno</option><option value="CASA_HABITACION">Casa habitación / terreno + construcción</option><option value="TERRENO_CONSTRUCCION">Terreno + construcción</option><option value="CONSTRUCCION_COMERCIAL">Terreno + construcción comercial</option><option value="USO_MIXTO">Uso mixto</option><option value="OTRO">Otro</option></select></label>
            {input.property.type === 'OTRO' && <label><span>Especifique</span><input value={input.property.otherDescription || ''} onChange={(event) => setInput({ ...input, property: { ...input.property, otherDescription: event.target.value } })} /></label>}
            {showConstruction && <label className={`${styles.checkRow} ${styles.full}`}><input type="checkbox" checked={input.property.sameAcquisitionDate} onChange={(event) => setInput({ ...input, property: { ...input.property, sameAcquisitionDate: event.target.checked } })} /><span>Terreno y construcción tienen la misma fecha de adquisición.</span></label>}
            {input.property.type === 'USO_MIXTO' && <label><span>Construcción gravada (%)</span><input inputMode="decimal" value={input.property.mixedTaxablePercentage || ''} onChange={(event) => setInput({ ...input, property: { ...input.property, mixedTaxablePercentage: event.target.value } })} /></label>}
          </div></section>

          <section className={styles.formSection} aria-labelledby="isr-v3-values"><header><div><span>3</span><div><h2 id="isr-v3-values">Valores y adquisición</h2><p>Comparación horizontal por componente; los factores pertenecen al motor.</p></div></div></header><div className={styles.v3ValueTable}>
            <div><strong>Dato</strong><strong>Terreno</strong>{showConstruction && <strong>Construcción</strong>}</div>
            <div><span>Valor de enajenación</span><input aria-label="Valor de enajenación terreno" inputMode="decimal" value={input.values.landSale} onChange={(event) => setInput({ ...input, values: { ...input.values, landSale: event.target.value } })} />{showConstruction && <input aria-label="Valor de enajenación construcción" inputMode="decimal" value={input.values.constructionSale} onChange={(event) => setInput({ ...input, values: { ...input.values, constructionSale: event.target.value } })} />}</div>
          </div><div className={styles.formGrid}>
            <label><span>Valor de operación</span><input inputMode="decimal" value={input.values.operation} onChange={(event) => setInput({ ...input, values: { ...input.values, operation: event.target.value } })} /></label><label><span>Valor de avalúo</span><input inputMode="decimal" value={input.values.appraisal} onChange={(event) => setInput({ ...input, values: { ...input.values, appraisal: event.target.value } })} /></label><label><span>Valor catastral</span><input inputMode="decimal" value={input.values.cadastral} onChange={(event) => setInput({ ...input, values: { ...input.values, cadastral: event.target.value } })} /></label><label><span>Fecha fiscal de operación</span><input type="date" value={input.operationDate} onChange={(event) => setInput({ ...input, operationDate: event.target.value })} /></label>
          </div></section>

          <section className={styles.formSection} aria-labelledby="isr-v3-iva"><header><div><span>4</span><div><h2 id="isr-v3-iva">IVA</h2><p>PRAVIA propone la rama; el usuario autorizado conserva la decisión.</p></div></div></header><label className={styles.ivaSwitch}><div><strong>Calcular IVA</strong><span>El suelo nunca se incorpora automáticamente a la base gravada.</span></div><span><input aria-label="Calcular IVA" type="checkbox" checked={input.calculateIVA} onChange={(event) => setInput({ ...input, calculateIVA: event.target.checked })} /> {input.calculateIVA ? 'Sí' : 'No'}</span></label>{result && <div className={styles.v3InlineResult}><span>Base gravada <strong>{money(result.iva.taxableBase)}</strong></span><span>Tasa <strong>{result.iva.rate ? `${result.iva.rate}%` : '—'}</strong></span><span>IVA resultante <strong>{money(result.iva.amount)}</strong></span><Help label="IVA" traces={result.iva.traces} onOpen={(traces, label) => setLegalPanel({ traces, label })} /></div>}</section>

          <section className={styles.formSection} aria-labelledby="isr-v3-parties"><header><div><span>5</span><div><h2 id="isr-v3-parties">Comparecientes / partes</h2><p>Nacionalidad, situación migratoria y residencia fiscal permanecen separadas.</p></div></div></header><div className={styles.v3PartyColumns}>{([{ role: 'ENAJENANTE', title: 'Enajenantes' }, { role: 'ADQUIRENTE', title: 'Adquirentes' }] as const).map((group) => <div key={group.role}><header><h3>{group.title}</h3><button type="button" className={styles.inlineButton} onClick={() => addParty(group.role)}><Plus />Agregar</button></header>{input.parties.filter((party) => party.role === group.role).map((party) => <article key={party.id} className={styles.v3PartyCard}><button type="button" className={styles.v3Remove} aria-label={`Eliminar ${party.name || group.title}`} onClick={() => setInput({ ...input, parties: input.parties.filter((item) => item.id !== party.id) })}><Trash2 /></button><label><span>Nombre</span><input value={party.name} onChange={(event) => updateParty(party.id, { name: event.target.value })} /></label><label><span>Tipo de sujeto</span><select value={party.subjectType} onChange={(event) => updateParty(party.id, { subjectType: event.target.value as ISRV3Party['subjectType'] })}><option value="PF">Persona física</option><option value="PM_TITULO_II">Persona moral · Título II</option><option value="PM_TITULO_III">Persona moral · Título III</option><option value="OTRO">Otro / insuficiente</option></select></label><label><span>Nacionalidad</span><select value={party.nationalityCode} onChange={(event) => updateParty(party.id, { nationalityCode: event.target.value })}>{countries.map((country) => <option key={country.code} value={country.code}>{country.label}</option>)}</select></label><label><span>Situación migratoria</span><input value={party.immigrationStatus || ''} onChange={(event) => updateParty(party.id, { immigrationStatus: event.target.value })} /></label><label><span>Residencia fiscal</span><select value={party.fiscalResidence} onChange={(event) => updateParty(party.id, { fiscalResidence: event.target.value as ISRV3Party['fiscalResidence'] })}><option value="MEXICO">México</option><option value="EXTRANJERO">Extranjero</option><option value="POR_DETERMINAR">Por determinar</option></select></label><label><span>{group.role === 'ENAJENANTE' ? '% enajena' : '% adquiere'}</span><input inputMode="decimal" value={party.percentage} onChange={(event) => updateParty(party.id, { percentage: event.target.value })} /></label>
              {group.role === 'ENAJENANTE' && party.fiscalResidence === 'EXTRANJERO' && <div className={styles.v3Conditional}><label className={styles.checkRow}><input type="checkbox" checked={Boolean(party.foreignGainOption?.requested)} onChange={(event) => updateParty(party.id, { foreignGainOption: { requested: event.target.checked, requirementsVerified: false, source: '' } })} /><span>Solicitar opción de cálculo sobre ganancia</span></label>{party.foreignGainOption?.requested && <><label className={styles.checkRow}><input type="checkbox" checked={party.foreignGainOption.requirementsVerified} onChange={(event) => updateParty(party.id, { foreignGainOption: { ...party.foreignGainOption!, requirementsVerified: event.target.checked } })} /><span>Requisitos de la opción verificados</span></label><label><span>Fuente de verificación</span><input value={party.foreignGainOption.source} onChange={(event) => updateParty(party.id, { foreignGainOption: { ...party.foreignGainOption!, source: event.target.value } })} /></label></>}</div>}
              {group.role === 'ADQUIRENTE' && <div className={styles.v3Conditional}><label className={styles.checkRow}><input type="checkbox" checked={Boolean(party.acquisitionExemption?.applies)} onChange={(event) => updateParty(party.id, { acquisitionExemption: { applies: event.target.checked, legalReference: '', verified: false } })} /><span>Existe excepción legal de ISR por adquisición</span></label>{party.acquisitionExemption?.applies && <><label><span>Fundamento legal</span><input value={party.acquisitionExemption.legalReference} onChange={(event) => updateParty(party.id, { acquisitionExemption: { ...party.acquisitionExemption!, legalReference: event.target.value } })} /></label><label className={styles.checkRow}><input type="checkbox" checked={party.acquisitionExemption.verified} onChange={(event) => updateParty(party.id, { acquisitionExemption: { ...party.acquisitionExemption!, verified: event.target.checked } })} /><span>Excepción verificada</span></label></>}</div>}
              {group.role === 'ENAJENANTE' && <div className={styles.v3Layers}><header><strong>Capas de adquisición</strong><button type="button" onClick={() => addLayer(party.id)}><Plus />Capa</button></header>{(party.acquisitionLayers || []).map((layer) => <div key={layer.id}><select aria-label="Acto de adquisición" value={layer.acquisitionAct} onChange={(event) => updateParty(party.id, { acquisitionLayers: party.acquisitionLayers!.map((item) => item.id === layer.id ? { ...item, acquisitionAct: event.target.value as typeof layer.acquisitionAct } : item) })}><option value="ONEROSA">Onerosa</option><option value="HERENCIA">Herencia</option><option value="DONACION">Donación</option><option value="OTRO">Otro</option></select><input aria-label="Porcentaje de capa" placeholder="%" value={layer.percentage} onChange={(event) => updateParty(party.id, { acquisitionLayers: party.acquisitionLayers!.map((item) => item.id === layer.id ? { ...item, percentage: event.target.value } : item) })} /><input aria-label="Fecha fiscal" type="date" value={layer.fiscalDate} onChange={(event) => updateParty(party.id, { acquisitionLayers: party.acquisitionLayers!.map((item) => item.id === layer.id ? { ...item, fiscalDate: event.target.value, legalDate: input.property.sameAcquisitionDate ? event.target.value : item.legalDate } : item) })} /><input aria-label="Costo terreno" placeholder="Costo terreno" value={layer.adjustedLandCost} onChange={(event) => updateParty(party.id, { acquisitionLayers: party.acquisitionLayers!.map((item) => item.id === layer.id ? { ...item, adjustedLandCost: event.target.value } : item) })} />{showConstruction && <input aria-label="Costo construcción" placeholder="Costo construcción" value={layer.adjustedConstructionCost} onChange={(event) => updateParty(party.id, { acquisitionLayers: party.acquisitionLayers!.map((item) => item.id === layer.id ? { ...item, adjustedConstructionCost: event.target.value } : item) })} />}<input aria-label="Fuente de adquisición" placeholder="Fuente / documento" value={layer.source} onChange={(event) => updateParty(party.id, { acquisitionLayers: party.acquisitionLayers!.map((item) => item.id === layer.id ? { ...item, source: event.target.value } : item) })} /><label className={styles.checkRow}><input type="checkbox" checked={layer.verified} onChange={(event) => updateParty(party.id, { acquisitionLayers: party.acquisitionLayers!.map((item) => item.id === layer.id ? { ...item, verified: event.target.checked } : item) })} /><span>Verificada</span></label></div>)}</div>}
            </article>)}</div>)}</div></section>

          <section className={styles.formSection} aria-labelledby="isr-v3-deductions"><header><div><span>6</span><div><h2 id="isr-v3-deductions">Deducciones y variables fiscales adicionales</h2><p>Sólo variables activadas por la ruta; casa habitación vive aquí.</p></div></div><button type="button" className={styles.inlineButton} onClick={() => setInput({ ...input, deductions: [...input.deductions, { id: uuid(), concept: '', amount: '', component: 'AMBOS', verified: false }] })}><Plus />Añadir partida</button></header><div className={styles.deductions}>{input.deductions.map((deduction) => <article key={deduction.id} className={styles.deduction}><div className={styles.deductionTop}><label><span>Concepto</span><input value={deduction.concept} onChange={(event) => setInput({ ...input, deductions: input.deductions.map((item) => item.id === deduction.id ? { ...item, concept: event.target.value } : item) })} /></label><label><span>Importe</span><input value={deduction.amount} onChange={(event) => setInput({ ...input, deductions: input.deductions.map((item) => item.id === deduction.id ? { ...item, amount: event.target.value } : item) })} /></label><label><span>Componente</span><select value={deduction.component} onChange={(event) => setInput({ ...input, deductions: input.deductions.map((item) => item.id === deduction.id ? { ...item, component: event.target.value as typeof deduction.component } : item) })}><option value="TERRENO">Terreno</option><option value="CONSTRUCCION">Construcción</option><option value="AMBOS">Ambos</option></select></label><button type="button" aria-label="Eliminar deducción" onClick={() => setInput({ ...input, deductions: input.deductions.filter((item) => item.id !== deduction.id) })}><Trash2 /></button></div><label className={styles.checkRow}><input type="checkbox" checked={deduction.verified} onChange={(event) => setInput({ ...input, deductions: input.deductions.map((item) => item.id === deduction.id ? { ...item, verified: event.target.checked } : item) })} /><span>Importe y soporte verificados</span></label></article>)}</div>
            {input.property.type === 'CASA_HABITACION' && sellers.map((party) => <div key={party.id} className={styles.v3Conditional}><label className={styles.checkRow}><input type="checkbox" checked={Boolean(party.homeExemption?.requested)} onChange={(event) => updateParty(party.id, { homeExemption: { requested: event.target.checked, homeUseVerified: false, requiredDocumentsVerified: false, noExemptionInPriorThreeYearsVerified: false } })} /><span>Analizar exención de casa habitación para {party.name || 'enajenante'}</span></label>{party.homeExemption?.requested && <div className={styles.v3Checklist}><label className={styles.checkRow}><input type="checkbox" checked={party.homeExemption.homeUseVerified} onChange={(event) => updateParty(party.id, { homeExemption: { ...party.homeExemption!, homeUseVerified: event.target.checked } })} /><span>Uso como casa habitación verificado</span></label><label className={styles.checkRow}><input type="checkbox" checked={party.homeExemption.requiredDocumentsVerified} onChange={(event) => updateParty(party.id, { homeExemption: { ...party.homeExemption!, requiredDocumentsVerified: event.target.checked } })} /><span>Documentación comprobatoria verificada</span></label><label className={styles.checkRow}><input type="checkbox" checked={party.homeExemption.noExemptionInPriorThreeYearsVerified} onChange={(event) => updateParty(party.id, { homeExemption: { ...party.homeExemption!, noExemptionInPriorThreeYearsVerified: event.target.checked } })} /><span>Sin exención en los tres años anteriores verificado</span></label></div>}</div>)}
            <button type="button" className={styles.inlineButton} onClick={() => setNotice(result?.missing.length ? `Hipótesis pendientes: ${result.missing.join(', ')}.` : 'No se detectaron datos faltantes en la versión calculada. Las sugerencias no modifican el cálculo.')}><Bot />Analizar opciones fiscales</button>
          </section>

          <section className={`${styles.formSection} ${styles.resultSection}`} aria-labelledby="isr-v3-results"><header><div><span>7</span><div><h2 id="isr-v3-results">Resultados</h2><p>Resultados individuales con estado jurídico/fiscal y ruta auditable.</p></div></div>{latest && <Button type="button" variant="secondary" disabled={!canGenerate || busy === 'document'} onClick={() => void generate()}><Download />Generar documento</Button>}</header>
            {!result && <div className={styles.emptyInline}>Guarda y calcula para obtener ISR enajenación, ISR adquisición e IVA.</div>}
            {result && <div className={styles.v3Results}><ResultGroup title="ISR enajenación" items={result.saleISR} onHelp={(traces, label) => setLegalPanel({ traces, label })} /><ResultGroup title="ISR adquisición" items={result.acquisitionISR} onHelp={(traces, label) => setLegalPanel({ traces, label })} /><article className={styles.v3ResultCard} data-status={result.iva.status}><header><strong>IVA</strong><span>{legalStatusLabels[result.iva.status]}</span></header><b>{money(result.iva.amount)}</b><p>{result.iva.reason}</p><Help label="IVA" traces={result.iva.traces} onOpen={(traces, label) => setLegalPanel({ traces, label })} /></article>{result.missing.length > 0 && <div className={styles.warning}><AlertTriangle />Pendiente: {result.missing.join(', ')}</div>}</div>}
            {latest && <div className={styles.timeline}><article><span>v{latest.version}</span><div><strong>{isV3Result(latest.result) ? latest.result.engineVersion : 'Versión histórica'}</strong><small>{new Date(latest.calculated_at).toLocaleString('es-MX')} · reglas {isV3Result(latest.result) ? latest.result.ruleVersion : String(latest.ruleset_snapshot.version || '')}</small></div></article></div>}
          </section>
        </main>

        <aside className={styles.v3Aside}>
          <section className={styles.documentPanel}><header><div><h2>Documentos</h2><p>Operación, soporte y documento final.</p></div><span>{record?.documentos.length || 0}</span></header><input ref={fileRef} hidden type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xml,.zip" onChange={(event) => void upload(event.target.files?.[0])} /><button type="button" className={styles.uploadZone} disabled={!canWrite || Boolean(busy)} onClick={() => fileRef.current?.click()}><FilePlus2 /><strong>Agregar documento</strong><span>Guarda primero si es un cálculo nuevo</span></button><div className={styles.documentList}>{record?.documentos.map((link) => <article key={link.id}><div className={styles.fileIcon}><FileSearch /></div><div><strong>{link.documento.nombre_original}</strong><small>{(link.documento.size_bytes / 1024 / 1024).toFixed(1)} MB</small></div><div><button type="button" aria-label={`Visualizar ${link.documento.nombre_original}`} onClick={() => void preview(link.documento_id, link.documento.nombre_original, link.documento.mime_type)}><FileSearch /></button><button type="button" aria-label={`Descargar ${link.documento.nombre_original}`} onClick={() => record && !fixture && void isrService.download(record.id, link.documento_id, link.documento.nombre_original)}><Download /></button></div></article>)}</div></section>
          <section className={styles.aiPanel}><header><div><Bot /><div><h2>Extracción con PRAVIA IA</h2><p>Propone; tú confirmas.</p></div></div></header><button type="button" className={styles.aiButton} disabled={!record?.documentos.length || Boolean(busy)} onClick={() => void extract()}>{busy === 'extract' ? <LoaderCircle className={styles.spin}/> : <Bot />}{busy === 'extract' ? 'Extrayendo información…' : 'Extraer información'}</button>{busy === 'extract'&&<AIProcessingStatus compact label="Analizando soporte fiscal" detail="La extracción sigue en proceso y no modificará el cálculo sin confirmación."/>}<div className={styles.proposalList}>{record?.propuestas.map((proposal) => <article key={proposal.id}><div className={styles.proposalMeta}><span>Fuente: {proposal.source_document_name}{proposal.source_page ? ` · pág. ${proposal.source_page}` : ''}</span><span>{proposal.status === 'ACEPTADA' ? 'Confirmada' : proposal.status}</span></div><strong>{String(proposal.proposed_value)}</strong><small>{proposal.field_path}</small>{proposal.status === 'PENDIENTE' || proposal.status === 'CONFLICTO' ? <div><button type="button" onClick={() => void reviewProposal(proposal, 'RECHAZADA')}><X />Descartar</button><button type="button" aria-label="Usar este dato" onClick={() => void reviewProposal(proposal, 'ACEPTADA')}><Check />Usar este dato</button></div> : null}</article>)}</div></section>
          {record && <section className={styles.scopePanel}><History /><strong>Historial inmutable</strong><p>{record.versiones.length} versión(es) calculada(s). Recalcular nunca borra resultados ni documentos anteriores.</p></section>}
        </aside>
      </div>
    </form>
    {legalPanel && <div className={styles.dialogBackdrop}><section className={`${styles.linkDialog} ${styles.v3LegalDialog}`} role="dialog" aria-modal="true" aria-labelledby="isr-legal-title"><HelpCircle /><div><h2 id="isr-legal-title">{legalPanel.label}</h2>{legalPanel.traces.length ? legalPanel.traces.map((item) => <article key={`${item.ruleId}-${item.result}`}><strong>Fundamento aplicado</strong><p>{item.legalReference} · versión {item.ruleVersion}</p><strong>Regla aplicada por PRAVIA</strong><p>{item.ruleId}</p><strong>Aplicado en este cálculo</strong><p>{item.calculation} = {item.result}</p><small>{item.explanation}</small></article>) : <p>No existe una regla ejecutada para este estado.</p>}<Button type="button" onClick={() => setLegalPanel(null)}>Cerrar</Button></div></section></div>}
    <DocumentViewer open={viewer.open} name={viewer.name} mimeType={viewer.mime} url={viewer.url} loading={viewer.loading} error={viewer.error} onClose={() => { if (viewer.url) URL.revokeObjectURL(viewer.url); setViewer({ open: false, name: '' }); }} onDownload={viewer.documentId && record && !fixture ? () => void isrService.download(record.id, viewer.documentId!, viewer.name) : undefined} />
  </PageContainer>;
}

function ResultGroup({ title, items, onHelp }: { title: string; items: ISRV3Result['saleISR']; onHelp(traces: ISRV3Trace[], label: string): void }) {
  return <section className={styles.v3ResultGroup}><h3>{title}</h3>{items.length ? items.map((item) => <article key={item.partyId} className={styles.v3ResultCard} data-status={item.status}><header><strong>{item.partyName}</strong><span>{legalStatusLabels[item.status]}</span></header><b>{money(item.amount)}</b><small>{item.route}</small><p>{item.reason}</p><Help label={`${title} de ${item.partyName}`} traces={item.traces} onOpen={onHelp} /></article>) : <div className={styles.emptyInline}>Sin sujetos aplicables.</div>}</section>;
}
