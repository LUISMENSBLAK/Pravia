import path from 'path';
import { describe, expect, it } from 'vitest';
import { readKnowledgeInventoryXlsx } from './knowledgeInventoryXlsx.service';

const fixture=path.resolve('/Users/15indicado/Library/Containers/net.whatsapp.WhatsApp/Data/tmp/documents/77037AF8-E9A9-4CD4-BE97-D25ED3B03D82/PRAVIA_OS_Biblioteca_Juridica_Inventario_Maestro_v1.0.xlsx');
describe('inventario maestro KNOW-001',()=>{
  it('lee exactamente 85 fuentes sin duplicar códigos',async()=>{const rows=await readKnowledgeInventoryXlsx(fixture);expect(rows).toHaveLength(85);expect(new Set(rows.map((row)=>row.inventory_code)).size).toBe(85);});
  it('conserva los conteos jurisdiccionales vinculantes',async()=>{const rows=await readKnowledgeInventoryXlsx(fixture);expect(Object.fromEntries(['NAYARIT','JALISCO','FEDERAL'].map((key)=>[key,rows.filter((row)=>row.jurisdiction===key).length]))).toEqual({NAYARIT:25,JALISCO:25,FEDERAL:35});});
  it('conserva 51 fuentes prioridad A',async()=>expect((await readKnowledgeInventoryXlsx(fixture)).filter((row)=>row.priority==='A')).toHaveLength(51));
  it('bloquea las cuatro fuentes sin original o texto oficial',async()=>expect((await readKnowledgeInventoryXlsx(fixture)).filter((row)=>row.ingestion_status.startsWith('PENDIENTE_')).map((row)=>row.inventory_code)).toEqual(['NAY-006','NAY-008','NAY-010','NAY-025']));
  it('no marca ninguna metadata como versión legal verificada',async()=>expect((await readKnowledgeInventoryXlsx(fixture)).every((row)=>!('verification_status' in row))).toBe(true));
});
