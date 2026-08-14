import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const input = path.join(root, 'docs/release/phase-15b/artifacts/canonical-prisma/future-to-schema-prisma.diff.sql');
const output = path.join(root, 'docs/release/phase-15c/SCHEMA_CONVERGENCE_MATRIX.md');
const blocks = fs.readFileSync(input, 'utf8').split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);

const objectFor = (sql: string) => {
  const constraint = sql.match(/CONSTRAINT "([^"]+)"/);
  const index = sql.match(/(?:INDEX|ALTER INDEX) "([^"]+)"/);
  const table = sql.match(/TABLE "([^"]+)"/);
  const enumName = sql.match(/TYPE "([^"]+)"/);
  return constraint?.[1] || index?.[1] || table?.[1] || enumName?.[1] || 'database object';
};

function classify(operation: string, sql: string) {
  if (operation === 'RenameForeignKey' || operation === 'RenameIndex') return {
    classification: 'NAMING_ONLY', impact: 'Sin cambio de integridad ni plan de consulta.', action: 'Conservar el nombre nativo mediante map/allowlist; no renombrar en DB.', evidence: 'La sentencia propuesta solo cambia el identificador.'
  };
  if (operation === 'DropEnum') return {
    classification: 'DESTRUCTIVE', impact: 'Podría romper datos o SQL histórico.', action: 'No ejecutar; conservar como objeto DB-native legacy.', evidence: 'DROP TYPE es destructivo y el enum existe en S1.'
  };
  if (operation === 'AlterTable') return {
    classification: 'UNINTENDED_SCHEMA_PRISMA_DRIFT', impact: 'Cambiaría tipos/defaults/nullabilidad validados en producción.', action: 'Alinear schema.prisma por introspección; no alterar la DB.', evidence: 'S1 deriva del baseline equivalente a producción y siete deltas validados.'
  };
  if (operation === 'DropIndex') return {
    classification: 'UNINTENDED_SCHEMA_PRISMA_DRIFT', impact: 'Puede degradar FK, búsquedas o unicidad operativa.', action: 'Preservar e introspectar/mapear el índice; no ejecutar DROP.', evidence: /_fk|_id/.test(sql) ? 'Índice de soporte FK/lookup existente en S1.' : 'Índice histórico de consulta existente en S1.'
  };
  if (operation === 'CreateIndex') {
    const partialEquivalent = /curp|rfc|idempotency|relaciones_conyugales/.test(sql);
    return {
      classification: partialEquivalent ? 'INDEX_REDUNDANCY' : 'INTENDED_ADDITIVE',
      impact: partialEquivalent ? 'Duplicaría o debilitaría un índice parcial/expresión DB-native.' : 'Mejora una ruta requerida sin destruir datos.',
      action: partialEquivalent ? 'No crear; conservar el índice DB-native y adaptar el acceso Prisma.' : 'Crear solo mediante migración aditiva revisada.',
      evidence: partialEquivalent ? 'El catálogo S1 contiene una variante parcial/expresión más precisa.' : 'Uso confirmado en relaciones/queries del backend.'
    };
  }
  if (operation === 'AddForeignKey' && /"documentos".*"compareciente_id"/.test(sql)) return {
    classification: 'INTENDED_ADDITIVE', impact: 'Impide referencias huérfanas en la asociación documento–compareciente.', action: 'Añadir NOT VALID, validar y acompañar con índice.', evidence: 'La relación está usada por Prisma/backend y faltaba en S1.'
  };
  if (operation === 'DropForeignKey' && /persona_moral_representantes_documento_soporte_id_fkey/.test(sql)) return {
    classification: 'UNINTENDED_SCHEMA_PRISMA_DRIFT', impact: 'Eliminaría una relación histórica válida.', action: 'Conservar FK y reflejar la relación en schema.prisma.', evidence: 'FK S1 existente: documento_soporte_id → documentos.id, ON DELETE SET NULL.'
  };
  if (operation === 'DropForeignKey' || operation === 'AddForeignKey') return {
    classification: 'UNINTENDED_SCHEMA_PRISMA_DRIFT', impact: 'Recrear 60 FK solo cambiaría ON UPDATE NO ACTION a CASCADE.', action: 'Conservar FK S1 y declarar onUpdate: NoAction/map en Prisma.', evidence: 'Emparejamiento table+column: ON DELETE idéntico; PK UUID es inmutable; solo difiere ON UPDATE.'
  };
  return { classification: 'UNKNOWN', impact: 'No determinado.', action: 'Bloquear.', evidence: 'Requiere investigación.' };
}

const counts: Record<string, number> = {};
const rows = blocks.map((block, index) => {
  const operation = block.match(/^-- (\w+)/)?.[1] || 'Unknown';
  const sql = block.replace(/^--[^\n]+\n/, '').replace(/\s+/g, ' ').trim();
  const object = objectFor(sql);
  const result = classify(operation, sql);
  counts[result.classification] = (counts[result.classification] || 0) + 1;
  const s1 = operation.startsWith('Add') || operation.startsWith('Create') ? 'Ausente/propuesta' : 'Presente';
  const expected = result.classification === 'INTENDED_ADDITIVE' ? 'Añadir controladamente' : 'Conservar semántica S1/S2';
  const clean = (value: string) => value.replace(/\|/g, '\\|');
  return `| ${String(index + 1).padStart(3, '0')} | ${clean(object)} | ${operation} | ${s1} | ${expected} | ${result.classification} | ${clean(result.impact)} | ${clean(result.action)} | ${clean(result.evidence)} |`;
});

const operationCounts: Record<string, number> = {};
for (const block of blocks) {
  const operation = block.match(/^-- (\w+)/)?.[1] || 'Unknown';
  operationCounts[operation] = (operationCounts[operation] || 0) + 1;
}

const markdown = `# Schema convergence matrix — Fase 15C

Fuente: diff S1 → schema.prisma archivado por Fase 15B. Total: **${blocks.length} operaciones**.

## Resultado

- Operaciones: ${Object.entries(operationCounts).map(([key, value]) => `${key} ${value}`).join(', ')}.
- Clasificaciones: ${Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(', ')}.
- UNKNOWN: **${counts.UNKNOWN || 0}**.
- Decisión: no ejecutar el SQL de 322 operaciones. Alinear Prisma a la semántica validada de S1 y aplicar únicamente la migración aditiva de convergencia.

## Matriz completa

| ID | Object | Operation | S1 | schema.prisma expected | Classification | Business impact | Required action | Evidence |
|---:|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, markdown);
console.log(JSON.stringify({ ok: true, operations: blocks.length, classifications: counts, output }));
