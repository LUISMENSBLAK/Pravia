import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { applyDirectedDocxPatches, normalizeDirectedPatches, reconcileProjectMetadataAfterPatches } from './projectInstruction.service';

const docx=async(xml:string)=>{const zip=new JSZip();zip.file('word/document.xml',`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${xml}</w:body></w:document>`);return zip.generateAsync({type:'nodebuffer'});};
describe('indicaciones dirigidas EXP-010',()=>{
  it('normaliza entre una y veinticinco correcciones',()=>expect(normalizeDirectedPatches([{find:' anterior ',replace:' nuevo '}])).toEqual([{find:'anterior',replace:'nuevo'}]));
  it('rechaza lista vacía',()=>expect(()=>normalizeDirectedPatches([])).toThrow(/entre una y veinticinco/));
  it('rechaza sustitución idéntica',()=>expect(()=>normalizeDirectedPatches([{find:'igual',replace:'igual'}])).toThrow(/no es válida/));
  it('sustituye texto dividido entre runs preservando DOCX',async()=>{const source=await docx('<w:p><w:r><w:t>JORGE </w:t></w:r><w:r><w:t>ROCHA</w:t></w:r></w:p>');const result=await applyDirectedDocxPatches(source,[{find:'JORGE ROCHA',replace:'JORGE ISAAC ROCHA'}]);expect(result.after).toContain('JORGE ISAAC ROCHA');expect(result.diff).toHaveLength(1);});
  it('preserva contenido no relacionado',async()=>{const source=await docx('<w:p><w:r><w:t>Nombre anterior</w:t></w:r></w:p><w:p><w:r><w:t>Cláusula intacta</w:t></w:r></w:p>');const result=await applyDirectedDocxPatches(source,[{find:'Nombre anterior',replace:'Nombre nuevo'}]);expect(result.after).toContain('Cláusula intacta');});
  it('retira de la nueva versión únicamente observaciones resueltas por la corrección humana',()=>{
    const metadata={pending_count:2,generation_observations:[{kind:'POSSIBLE_TEMPLATE_RESIDUE',value:'Nombre anterior'},{kind:'POSSIBLE_TEMPLATE_RESIDUE',value:'Residuo ya ausente'},{kind:'CONTRADICTION',document_value:'Otro dato'}],residual_observations:[{kind:'POSSIBLE_TEMPLATE_RESIDUE',value:'Nombre anterior'},{kind:'POSSIBLE_TEMPLATE_RESIDUE',value:'Otro residuo'}],contradiction_observations:[{document_value:'Otro dato'}]};
    const reconciled=reconcileProjectMetadataAfterPatches(metadata,[{find:'Nombre anterior',replace:'Nombre nuevo'}],'Nombre nuevo Otro residuo [PENDIENTE: DATO]');
    expect(reconciled.pending_count).toBe(1);
    expect(reconciled.generation_observations).toEqual([{kind:'CONTRADICTION',document_value:'Otro dato'}]);
    expect(reconciled.residual_observations).toEqual([{kind:'POSSIBLE_TEMPLATE_RESIDUE',value:'Otro residuo'}]);
    expect(reconciled.contradiction_observations).toEqual([{document_value:'Otro dato'}]);
  });
  it('bloquea texto ambiguo',async()=>{const source=await docx('<w:p><w:r><w:t>Duplicado</w:t></w:r></w:p><w:p><w:r><w:t>Duplicado</w:t></w:r></w:p>');await expect(applyDirectedDocxPatches(source,[{find:'Duplicado',replace:'Único'}])).rejects.toThrow(/más de una vez/);});
  it('bloquea objetivo ausente',async()=>{const source=await docx('<w:p><w:r><w:t>Texto</w:t></w:r></w:p>');await expect(applyDirectedDocxPatches(source,[{find:'Ausente',replace:'Nuevo'}])).rejects.toThrow(/No se encontró/);});
});
