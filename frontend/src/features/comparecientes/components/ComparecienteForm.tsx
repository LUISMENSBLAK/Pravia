import { Building2, Contact, FileBadge, Home, Landmark, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NewComparecienteDraft, PersonType } from '../comparecientes.types';
import styles from '../Comparecientes.module.css';

type Props = {
  draft: NewComparecienteDraft;
  readOnly: boolean;
  lockType?: boolean;
  sources?: Record<string, any>;
  onChange(name: string, value: string): void;
};

function Field({ draft, name, label, readOnly, onChange, type = 'text', required, source, placeholder }: {
  draft: NewComparecienteDraft; name: string; label: string; readOnly: boolean; onChange(name: string, value: string): void;
  type?: string; required?: boolean; source?: any; placeholder?: string;
}) {
  const id = `compareciente-${name}`;
  return <label className={styles.workspaceField} htmlFor={id}><span>{label}{required ? ' *' : ''}</span><input id={id} name={name} type={type} value={draft[name] || ''} readOnly={readOnly} required={required} placeholder={placeholder} onChange={(event) => onChange(name, event.target.value)} />{source && <small className={source.estado === 'EN_CONFLICTO' ? styles.sourceConflict : styles.sourceHint}>{source.estado === 'EN_CONFLICTO' ? 'Conflicto entre documentos · revisa el valor' : `Fuente: ${source.fuente || 'Documento cargado'}`}</small>}</label>;
}

function SelectField({ draft, name, label, readOnly, onChange, options, source }: { draft: NewComparecienteDraft; name: string; label: string; readOnly: boolean; onChange(name:string,value:string):void; options: Array<[string,string]>; source?: any }) {
  const id = `compareciente-${name}`;
  return <label className={styles.workspaceField} htmlFor={id}><span>{label}</span><select id={id} name={name} value={draft[name] || ''} disabled={readOnly} onChange={(event) => onChange(name,event.target.value)}>{options.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>{source && <small className={source.estado === 'EN_CONFLICTO' ? styles.sourceConflict : styles.sourceHint}>{source.estado === 'EN_CONFLICTO' ? 'Conflicto entre documentos · revisa el valor' : `Fuente: ${source.fuente || 'Documento cargado'}`}</small>}</label>;
}

function Section({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: React.ReactNode }) {
  return <section className={styles.formSection}><header><span><Icon size={17} /></span><h2>{title}</h2></header><div className={styles.workspaceFormGrid}>{children}</div></section>;
}

const addressFields = (prefix: string, title: string, props: Props) => <Section icon={Home} title={title}>
  <Field {...props} name={`${prefix}_calle`} label="Calle" source={props.sources?.[`${prefix}_calle`]} />
  <Field {...props} name={`${prefix}_exterior`} label="Número exterior" source={props.sources?.[`${prefix}_exterior`]} />
  <Field {...props} name={`${prefix}_interior`} label="Número interior" source={props.sources?.[`${prefix}_interior`]} />
  <Field {...props} name={`${prefix}_colonia`} label="Colonia" source={props.sources?.[`${prefix}_colonia`]} />
  <Field {...props} name={`${prefix}_codigo_postal`} label="Código postal" source={props.sources?.[`${prefix}_codigo_postal`]} />
  <Field {...props} name={`${prefix}_municipio`} label="Municipio / Alcaldía" source={props.sources?.[`${prefix}_municipio`]} />
  <Field {...props} name={`${prefix}_localidad`} label="Ciudad / Localidad" source={props.sources?.[`${prefix}_localidad`]} />
  <Field {...props} name={`${prefix}_estado`} label="Estado" source={props.sources?.[`${prefix}_estado`]} />
  <Field {...props} name={`${prefix}_pais`} label="País" source={props.sources?.[`${prefix}_pais`]} />
</Section>;

export function ComparecienteForm(props: Props) {
  const { draft, readOnly, onChange, sources = {} } = props;
  const setType = (type: PersonType) => onChange('tipo_persona', type);
  const fullName = [draft.nombre,draft.apellido_paterno,draft.apellido_materno].filter(Boolean).join(' ').toLocaleUpperCase('es-MX');
  return <div className={styles.workspaceForm}>
    <fieldset className={styles.personTypeSelector} disabled={readOnly || props.lockType}><legend>Tipo de persona</legend><button type="button" aria-pressed={draft.tipo_persona === 'FISICA'} onClick={() => setType('FISICA')}><UserRound />Persona física</button><button type="button" aria-pressed={draft.tipo_persona === 'MORAL'} onClick={() => setType('MORAL')}><Building2 />Persona moral</button></fieldset>
    {draft.tipo_persona === 'FISICA' ? <>
      <Section icon={UserRound} title="Información general">
        <Field {...props} name="nombre" label="Nombre(s)" required source={sources.nombre} />
        <Field {...props} name="apellido_paterno" label="Primer apellido" source={sources.apellido_paterno} />
        <Field {...props} name="apellido_materno" label="Segundo apellido" source={sources.apellido_materno} />
        <label className={`${styles.workspaceField} ${styles.fullWidth}`}><span>Nombre completo calculado</span><input value={fullName} readOnly aria-readonly="true" /></label>
        <Field {...props} name="aliases" label="Alias o nombres conocidos" placeholder="Separados por coma" />
        <SelectField {...props} name="pep_estado" label="Persona políticamente expuesta (PEP)" options={[["PENDIENTE","Pendiente / desconocido"],["NO","No"],["SI","Sí"]]} source={sources.pep_estado} />
        {draft.pep_estado === 'SI' && <Field {...props} name="relacion_pep" label="Relación o cargo PEP" />}
      </Section>
      <Section icon={Landmark} title="Identificadores y actividad">
        <Field {...props} name="rfc" label="RFC" source={sources.rfc} />
        <Field {...props} name="curp" label="CURP" source={sources.curp} />
        <Field {...props} name="fecha_nacimiento" label="Fecha de nacimiento" type="date" source={sources.fecha_nacimiento} />
        <Field {...props} name="lugar_nacimiento" label="Lugar de nacimiento" source={sources.lugar_nacimiento} />
        <Field {...props} name="pais_nacimiento" label="País de nacimiento" source={sources.pais_nacimiento} />
        <Field {...props} name="nacionalidad" label="Nacionalidad" source={sources.nacionalidad} />
        <SelectField {...props} name="sexo" label="Sexo" options={[["","Sin especificar"],["MASCULINO","Masculino"],["FEMENINO","Femenino"],["OTRO","Otro"]]} source={sources.sexo} />
        <SelectField {...props} name="estado_civil" label="Estado civil" options={[["","Sin especificar"],["SOLTERO","Soltero(a)"],["CASADO","Casado(a)"],["DIVORCIADO","Divorciado(a)"],["VIUDO","Viudo(a)"],["UNION_LIBRE","Unión libre"]]} source={sources.estado_civil} />
        <SelectField {...props} name="regimen_matrimonial" label="Régimen matrimonial" options={[["","Sin especificar"],["SOCIEDAD_CONYUGAL","Sociedad conyugal"],["SEPARACION_DE_BIENES","Separación de bienes"],["SOCIEDAD_LEGAL","Sociedad legal"],["OTRO","Otro"]]} source={sources.regimen_matrimonial} />
        <Field {...props} name="escolaridad" label="Escolaridad" source={sources.escolaridad} />
        <Field {...props} name="ocupacion" label="Ocupación o profesión" source={sources.ocupacion} />
        <Field {...props} name="actividad_economica" label="Actividad económica" source={sources.actividad_economica} />
        <Field {...props} name="giro" label="Giro" source={sources.giro} />
      </Section>
    </> : <Section icon={Building2} title="Información de la persona moral">
      <Field {...props} name="razon_social" label="Razón social" required source={sources.razon_social} />
      <Field {...props} name="nombre_comercial" label="Nombre comercial" source={sources.nombre_comercial} />
      <Field {...props} name="tipo_societario" label="Tipo societario" source={sources.tipo_societario} />
      <Field {...props} name="rfc" label="RFC" source={sources.rfc} />
      <Field {...props} name="nacionalidad" label="Nacionalidad" source={sources.nacionalidad} />
      <Field {...props} name="fecha_constitucion" label="Fecha de constitución" type="date" source={sources.fecha_constitucion} />
      <Field {...props} name="duracion" label="Duración" source={sources.duracion} />
      <Field {...props} name="folio_mercantil" label="Folio mercantil" source={sources.folio_mercantil} />
      <Field {...props} name="fecha_inscripcion_mercantil" label="Fecha de inscripción mercantil" type="date" source={sources.fecha_inscripcion_mercantil} />
      <Field {...props} name="estatus_societario" label="Estatus societario" source={sources.estatus_societario} />
      <label className={`${styles.workspaceField} ${styles.fullWidth}`}><span>Objeto social resumido</span><textarea value={draft.objeto_social_resumido || ''} readOnly={readOnly} onChange={(event)=>onChange('objeto_social_resumido',event.target.value)} rows={3} /></label>
    </Section>}
    <Section icon={Contact} title="Contacto"><Field {...props} name="telefono" label="Teléfono" type="tel" /><Field {...props} name="correo" label="Correo electrónico" type="email" /></Section>
    {addressFields('dom_particular','Domicilio particular',props)}
    {addressFields('dom_fiscal','Domicilio fiscal',props)}
    <Section icon={FileBadge} title="Identificación oficial">
      <SelectField {...props} name="tipo_identificacion" label="Tipo de identificación" options={[["INE","INE"],["PASAPORTE","Pasaporte"],["CEDULA_PROFESIONAL","Cédula profesional"],["DOCUMENTO_MIGRATORIO","Documento migratorio"],["OTRA","Otra"]]} source={sources.tipo_identificacion} />
      <Field {...props} name="folio_identificacion" label="Folio" source={sources.folio_identificacion} />
      <Field {...props} name="autoridad_emisora" label="Autoridad emisora" source={sources.autoridad_emisora} />
      <Field {...props} name="pais_emisor" label="País emisor" source={sources.pais_emisor} />
      <Field {...props} name="fecha_expedicion_identificacion" label="Fecha de expedición" type="date" source={sources.fecha_expedicion_identificacion} />
      <Field {...props} name="fecha_vencimiento_identificacion" label="Fecha de vencimiento" type="date" source={sources.fecha_vencimiento_identificacion} />
    </Section>
    <section className={styles.formSection}><header><span><FileBadge size={17}/></span><h2>Observaciones notariales</h2></header><label className={styles.notarialNotes}><span className={styles.srOnly}>Observaciones notariales</span><textarea value={draft.observaciones || ''} readOnly={readOnly} onChange={(event)=>onChange('observaciones',event.target.value)} rows={5} placeholder="Notas humanas relevantes para la operación notarial" /></label></section>
  </div>;
}
