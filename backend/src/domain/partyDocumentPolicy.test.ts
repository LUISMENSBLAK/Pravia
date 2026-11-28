import { describe, expect, it } from 'vitest';
import { consolidatePartyDocuments, partyDocumentSources, partySupplementalReaderKind, proposePartyAddresses, readBirthCertificateDate } from './partyDocumentPolicy';
import type { ExtractionField } from './documentExtraction';
import { mrzCheckDigit } from './machineReadableIdentity';

const documents = [
  ['ine', 'Identificación INE.jpg'], ['pass', 'Pasaporte.pdf'], ['curp','scan.pdf'], ['csf','02 CSF.pdf'],
  ['birth','Acta de nacimiento.pdf'], ['marriage','Acta de matrimonio.pdf'], ['general','Anexo 3.docx'], ['cd','Recibo CFE.pdf'],
].map(([documentoId, nombreOriginal]) => ({ documentoId, nombreOriginal }));
const classifications = [{ documento_id: 'curp', tipo_documental: 'CURP' }, { documento_id: 'unselected', tipo_documental: 'INE' }];
const sources = partyDocumentSources(documents, classifications);
const f = (documento_id: string, campo: string, valor: string, fragmento?: string): ExtractionField => ({ documento_id, campo, valor, confianza: 'LECTURA_CLARA', pagina: 1, fragmento });
const name = (id: string, given: string, last: string, maternal?: string) => [f(id, 'nombre', given), f(id, 'apellido_paterno', last), ...(maternal ? [f(id, 'apellido_materno', maternal)] : [])];

describe('Comparecientes: reglas documentales', () => {
  it('elige el lector para lotes cargados todos como Identificación sin sustituir el tipo explícito', () => {
    const files = ['Acta de nacimiento.pdf','Anexo 3.docx','Recibo CFE.pdf','CSF-Prueba.pdf','CURP Prueba.pdf','Pasaporte.pdf','credencial INE.jpg'];
    expect(files.map(file => partySupplementalReaderKind('IDENTIFICACION', file))).toEqual(['OTRO','OTRO','OTRO','CONSTANCIA_FISCAL','CURP','PASAPORTE','IDENTIFICACION']);
    expect(partySupplementalReaderKind('CURP', 'archivo llamado pasaporte.pdf')).toBe('CURP');
    expect(partySupplementalReaderKind('IDENTIFICACION', 'Escaneo 1.pdf')).toBe('IDENTIFICACION');
  });
  it('coteja la fecha rotulada del acta escaneada y no la confunde con el registro o la filiación', () => {
    const start = 'Acta de nacimiento\nFecha de registro: 03/04/1994\nDatos de la persona registrada\nMónica Prueba\n';
    const good = `${start}Mujer 01/04/1994\nSexo: Fecha de nacimiento: Lugar de nacimiento:\nDatos de filiación\nFecha de nacimiento: 12/01/1972`;
    const found = readBirthCertificateDate(good);
    expect(found?.value).toBe('1994-04-01');
    expect(readBirthCertificateDate(good.replace('01/04/1994', '31/04/1994'))).toBeUndefined();
    expect(readBirthCertificateDate(good.replace('Sexo:', 'Fecha de registro: 03/04/1994 Sexo:'))).toBeUndefined();
    const read = { ...f('birth','fecha_nacimiento',found!.value,found!.fragmento), confianza:'LECTURA_DUDOSA' as const, verificacion_local:'BIRTH_DATE_LABEL' as const };
    const fields = [...name('ine','Mónica','Prueba'), ...name('birth','Mónica','Prueba'), read];
    expect(consolidatePartyDocuments([...fields,f('ine','fecha_nacimiento','1994-04-01')],sources).proposals.fecha_nacimiento.documento_id).toBe('birth');
    const conflict = consolidatePartyDocuments([...fields,f('ine','fecha_nacimiento','1994-04-02')],sources);
    expect(conflict.proposals.fecha_nacimiento.documento_id).toBe('ine');
    expect(conflict.reviewWarnings).toHaveLength(1);
  });
  it('toma un solo nombre de INE y conserva una variante de CSF como alias, sin sumar un segundo apellido', () => {
    const result = consolidatePartyDocuments([...name('csf','Pedro','Sanches','Uribe'), ...name('ine','Pedro','Sánchez'), f('unselected','nombre','Ajeno'), f('general','pep_estado','NO')], sources);
    expect(result.values).toEqual({ nombre: 'Pedro', apellido_paterno: 'Sánchez', aliases: 'Pedro Sanches Uribe' });
    expect(result.proposals.aliases.fuentes[0]).toMatchObject({ documento_id: 'csf', pagina: 1 });
    expect(result.proposals.nombre.documento_id).toBe('ine');
  });
  it('no propone un nombre combinado cuando identificación y pasaporte identifican personas distintas', () => {
    const result = consolidatePartyDocuments([...name('pass','Jorge','Rojo'), ...name('ine','Pedro','Sánchez'), f('general','telefono','5550001234')], sources);
    expect(result.values).toEqual({});
    expect(result.proposals.nombre_completo.estado).toBe('EN_CONFLICTO');
  });
  it('no convierte el nombre totalmente ajeno de una constancia en un alias', () => {
    const result = consolidatePartyDocuments([...name('ine','Pedro','Sánchez'), ...name('csf','Marta','Muñoz')], sources);
    expect(result.values).toEqual({});
    expect(result.proposals.nombre_completo.alternativas.map((item: { valor: string }) => item.valor)).toEqual(['Pedro Sánchez','Marta Muñoz']);
  });
  it('no convierte variaciones de acentos en aliases y usa CURP reconocida por contenido antes que CSF', () => {
    const result = consolidatePartyDocuments([...name('curp','Pedro','Sánchez'), ...name('csf','PEDRO','SANCHEZ')], sources);
    expect(result.values).toEqual({nombre:'Pedro', apellido_paterno:'Sánchez'});
    expect(result.proposals.nombre.documento_id).toBe('curp');
  });
  it('aplica las prioridades de los demás campos y no infiere estado civil ni régimen', () => {
    const result = consolidatePartyDocuments([f('ine','rfc','QAFA010101QA1'),f('csf','rfc','QAFA010101QA2'),f('ine','fecha_nacimiento','10/5/1992'),f('birth','fecha_nacimiento','1992-05-11'),f('birth','lugar_nacimiento','Tepic'),f('general','lugar_nacimiento','Xalisco'),f('general','escolaridad','Licenciatura'),f('general','email','qa@pravia.test'),f('csf','giro','Comercio'),f('marriage','estado_civil','CASADA'),f('general','regimen_matrimonial','Separación de bienes')],sources);
    expect(result.values).toMatchObject({ rfc:'QAFA010101QA2', fecha_nacimiento:'1992-05-11', lugar_nacimiento:'Tepic', escolaridad:'Licenciatura', correo:'qa@pravia.test', giro:'Comercio', estado_civil:'CASADO' });
    expect(result.values).not.toHaveProperty('regimen_matrimonial');
  });
  it('no bloquea el nombre ni los datos cotejados por una CURP secundaria dudosa', () => {
    const data = [...name('pass','Elisa','Prueba','Ficticia'), ...name('csf','Elisa','Prueba','Ficticia'), f('curp','curp','GARA900101HDFRBC77'),
      { ...f('csf','curp','GARA900101HDFRBC78'), confianza:'LECTURA_DUDOSA' as const }, f('csf','rfc','QAFA010101QA1')];
    const result = consolidatePartyDocuments(data,sources);
    expect(result.values).toMatchObject({ nombre:'Elisa', curp:'GARA900101HDFRBC77', rfc:'QAFA010101QA1' });
    expect(result.excludedDocumentIds).toEqual([]);
    expect(result.reviewWarnings).toHaveLength(1);
    expect(result.proposals.nombre_completo).toBeUndefined();
    const corroborated = consolidatePartyDocuments([...data, f('csf','curp','GARA900101HDFRBC78')],sources);
    expect(corroborated.values).toEqual({});
    expect(corroborated.proposals.nombre_completo.estado).toBe('EN_CONFLICTO');
  });
  it('aísla la fuente dudosa completa si el titular de ésta no se pudo cotejar', () => {
    const data = [...name('pass','Elisa','Prueba'), f('curp','curp','GARA900101HDFRBC77'),
      { ...f('csf','curp','GARA900101HDFRBC78'), confianza:'LECTURA_DUDOSA' as const }, f('csf','rfc','QAFA010101QA1')];
    const result = consolidatePartyDocuments(data,sources);
    expect(result.values).toMatchObject({ nombre:'Elisa', curp:'GARA900101HDFRBC77' });
    expect(result.values.rfc).toBeUndefined();
    expect(result.excludedDocumentIds).toEqual(['csf']);
    const linked = consolidatePartyDocuments([...data,...name('general','Elisa','Prueba'),f('general','rfc','QAFA010101QA1')],sources);
    expect(linked.proposals.rfc.documento_id).toBe('csf');
    expect(linked.excludedDocumentIds).toEqual([]);
  });
  it('usa el folio del MRZ cotejado frente a variantes dudosas, sin ocultar un conflicto claro', () => {
    const checked = { ...f('pass','folio_identificacion','Z12345678'), verificacion_local:'MRZ_TD3' as const };
    const other = { ...f('pass','folio_identificacion','Z123456789'), confianza:'LECTURA_DUDOSA' as const };
    const readings = [...name('pass','Elisa','Prueba'), checked, other, f('pass','nacionalidad','MEX'), f('general','nacionalidad','Mexicana')];
    expect(consolidatePartyDocuments(readings,sources).values).toMatchObject({ folio_identificacion:'Z12345678', nacionalidad:'MEXICANA' });
    expect(consolidatePartyDocuments([...readings,f('pass','folio_identificacion','Z12345679')],sources).proposals.folio_identificacion.estado).toBe('EN_CONFLICTO');
  });
  it('coteja el primer carácter con un folio alfanumérico del mismo titular y nunca propone la lectura parcial', () => {
    const ambiguous = { ...f('pass','folio_identificacion','12345678'), confianza:'LECTURA_DUDOSA' as const, verificacion_local:'MRZ_TD3_AMBIGUO' as const, mrz_control:String(mrzCheckDigit('Z12345678')) };
    const passport = [...name('pass','Elisa','Prueba'), ambiguous];
    expect(consolidatePartyDocuments(passport,sources).values.folio_identificacion).toBeUndefined();
    const linked = [...passport, ...name('general','Elisa','Prueba'), f('general','tipo_identificacion','PASAPORTE'), f('general','folio_identificacion','Z12345678')];
    expect(consolidatePartyDocuments(linked,sources).values.folio_identificacion).toBe('Z12345678');
    expect(consolidatePartyDocuments(linked.filter(field => !(field.documento_id === 'general' && field.campo === 'tipo_identificacion')),sources).values.folio_identificacion).toBeUndefined();
  });
  it('aplica la convención sólo con evidencia rotulada de INE y conserva fechas completas de pasaporte', () => {
    const data = consolidatePartyDocuments([f('ine','fecha_expedicion_identificacion','2026','EMISIÓN 2026'),f('ine','fecha_vencimiento_identificacion','2036','VIGENCIA 2036')],sources);
    expect(data.values).toMatchObject({ fecha_expedicion_identificacion:'2026-01-01', fecha_vencimiento_identificacion:'2036-12-31' });
    expect(data.proposals.fecha_expedicion_identificacion.fragmento).toContain('Convención PRAVIA');
    expect(consolidatePartyDocuments([f('ine','fecha_expedicion_identificacion','2026','AÑO DE REGISTRO 2026')],sources).values).toEqual({});
    expect(consolidatePartyDocuments([f('pass','fecha_vencimiento_identificacion','15/10/2036')],sources).values).toEqual({ fecha_vencimiento_identificacion:'2036-10-15' });
    expect(consolidatePartyDocuments([f('pass','fecha_vencimiento_identificacion','2036','VIGENCIA 2036')],sources).values).toEqual({});
  });
  it('prioriza comprobante del titular, no mezcla domicilios y usa respaldo fiscal sólo sin CSF', () => {
    const base = { fuente: 'qa', calle: 'Agua', codigo_postal: '63000' };
    const list = [{ ...base, documento_id:'cd', tipo_sugerido:'COMPROBADO', titular_confirmado:false }, { ...base, calle:'Fiscal', documento_id:'csf', tipo_sugerido:'FISCAL', colonia:'Fiscal' }, { ...base, calle:'Declarada', documento_id:'general', tipo_sugerido:'DECLARADO' }, { ...base, calle:'INE parcial', documento_id:'ine', tipo_sugerido:'IDENTIFICACION' }];
    const proposed = proposePartyAddresses(list, sources, false);
    expect(proposed).toEqual(expect.arrayContaining([expect.objectContaining({ campo:'dom_particular_calle', valor:'Declarada' }),expect.objectContaining({ campo:'dom_fiscal_colonia', valor:'Fiscal' })]));
    expect(proposed.some(field => field.campo === 'dom_particular_colonia')).toBe(false);
    const noCsf = partyDocumentSources(documents.filter(doc => doc.documentoId !== 'csf'));
    const partial = [{ ...list[0], titular_confirmado: true, titular_literal:'PRUEBA MÓNICA' }, ...list.slice(2)];
    expect(proposePartyAddresses(partial, noCsf, false, false,'Monica Prueba')).toEqual(expect.arrayContaining([expect.objectContaining({ campo:'dom_fiscal_calle', valor:'Agua', fuente:expect.stringContaining('ausencia de CSF') })]));
    expect(proposePartyAddresses(partial, noCsf, false, false,'Persona Distinta').find(field => field.campo === 'dom_particular_calle')?.valor).toBe('Declarada');
    expect(proposePartyAddresses(partial, sources, false).some(field => field.campo.startsWith('dom_fiscal'))).toBe(false);
    expect(proposePartyAddresses(partial, noCsf, false, true).some(field => field.campo.startsWith('dom_fiscal'))).toBe(false);
  });
  it('conserva componentes complementarios de la misma CSF sólo cuando el domicilio base coincide', () => {
    const core = { documento_id:'csf', tipo_sugerido:'FISCAL', fuente:'Prueba', calle:'Héroes', numero_exterior:'12', codigo_postal:'63000' };
    const local = { ...core, numero_interior:'3', fragmento:'Int 3', confianza:'LECTURA_DUDOSA' as const };
    const visual = { ...core, calle:'Heroes', pais:'México', fragmento:'País México', confianza:'LECTURA_CLARA' as const };
    const readings = proposePartyAddresses([local, visual], sources, false);
    expect(readings).toEqual(expect.arrayContaining([
      expect.objectContaining({ campo:'dom_fiscal_interior', valor:'3', fragmento:'Int 3', confianza:'LECTURA_DUDOSA' }),
      expect.objectContaining({ campo:'dom_fiscal_pais', valor:'México', fragmento:'País México', confianza:'LECTURA_CLARA' }),
    ]));
    expect(proposePartyAddresses([local, { ...visual, numero_interior:'8' }], sources, false)).toEqual([]);
    expect(proposePartyAddresses([local, { ...visual, numero_exterior:undefined }], sources, false)).toEqual([]);
  });
});
