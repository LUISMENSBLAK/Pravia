import { describe, expect, it } from 'vitest';
import { locateLiteralPropertyDescription, orderPropertyCandidates, propertyDocumentKind, propertyIdentityMismatch, propertyScopePages, propertyTargetFrom, type PropertyDocumentKind } from './propertyDocumentPolicy';

const reading = (campo: string, valor: string, tipo: PropertyDocumentKind, principal = false) => ({ campo, valor, tipo, principal, confianza: 'LECTURA_CLARA' });
describe('Predios: evidencia por campo', () => {
  it('jerarquiza independientemente dirección y descripción y no propone datos manuales', () => {
    const fields = [reading('calle','Acta','ANTECEDENTE'), reading('calle','Predial','PREDIAL'), reading('descripcion','Pasaje exacto','ANTECEDENTE'), reading('descripcion','Resumen','CNA'), reading('valor_operacion','3000','ANTECEDENTE'), reading('apodo','LOTE','ANTECEDENTE')];
    expect(orderPropertyCandidates('calle',fields)).toMatchObject({ selected:{ valor:'Predial' }, conflict:true, unresolved:false });
    expect(orderPropertyCandidates('descripcion',fields).selected?.valor).toBe('Pasaje exacto');
    expect(orderPropertyCandidates('apodo',fields).selected).toBeUndefined();
    expect(orderPropertyCandidates('valor_operacion',fields).selected).toBeUndefined();
  });
  it('no toma una carta privada como certificado ni el preavalúo como avalúo oficial', () => {
    expect(propertyDocumentKind('CARTA NO ADEUDO LOTE AH3.pdf')).toBeUndefined();
    expect(propertyDocumentKind('Certificado de no adeudo predial.pdf')).toBe('CNA');
    expect(propertyDocumentKind('CNAP UNIDAD QA.pdf')).toBe('CNA');
    expect(propertyDocumentKind('Pre-avalúo.pdf')).toBe('PREAVALUO');
    expect(orderPropertyCandidates('valor_avaluo',[reading('valor_avaluo','8000','PREAVALUO'),reading('valor_avaluo','9000','AVALUO')]).selected?.valor).toBe('9000');
  });
  it('exige coincidencia íntegra y etiquetada de la unidad y páginas válidas en escrituras múltiples', () => {
    const target = propertyTargetFrom({ folio_real: 'QA-120', apodo: 'Unidad privada' });
    expect(target).toEqual({ folio_real:'QA-120' });
    const scope = { alcance:'MULTIPLE', campo:'folio_real', valor:'QA120', fragmento:'Folio real: QA-120', pagina:4, paginas_unidad:[4,5,200] };
    expect(propertyScopePages(scope,target,true,97)).toEqual({safe:true, allowedPages:new Set([4,5])});
    expect(propertyScopePages({...scope,fragmento:'Folio real: QA-1209'},target,true,97).safe).toBe(false);
    expect(propertyScopePages({...scope,fragmento:'En el lote vecino QA-120'},target,true,97).safe).toBe(false);
    expect(propertyScopePages({...scope,paginas_unidad:[5]},target,true,97).safe).toBe(false);
    expect(propertyScopePages({...scope,alcance:'INDETERMINADO'},target,false,97).safe).toBe(false);
    expect(propertyScopePages(undefined,target,true,97).safe).toBe(false);
  });
  it('no mezcla folios ni elige diferencias irresueltas del mismo nivel', () => {
    expect(propertyIdentityMismatch({ cuenta_predial:'A-123' },{ cuenta_predial:'a123' })).toBe(false);
    expect(propertyIdentityMismatch({ folio_real:'A-123' },{ folio_real:'A-124' })).toBe(true);
    expect(orderPropertyCandidates('superficie_terreno_m2',[reading('superficie_terreno_m2','100','PREDIAL'),reading('superficie_terreno_m2','200','PREDIAL')]).unresolved).toBe(true);
  });
  it('coteja literal, tolerando saltos de línea pero no cambios de palabras', () => {
    const literal = 'Lote 2; al Norte 5 m.\nPorcentaje proindiviso: 10%.';
    expect(locateLiteralPropertyDescription(`Preámbulo\n${literal}\nContinúa.`,literal.replace('\n',' '))).toBe(literal);
    expect(locateLiteralPropertyDescription(literal,'Lote 3; al Norte 5 m.')).toBeNull();
  });
});
