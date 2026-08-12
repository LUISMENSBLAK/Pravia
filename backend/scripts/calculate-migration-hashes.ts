import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

function getHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

const baseDir = path.resolve(__dirname, '..');
const schemaPath = path.join(baseDir, 'prisma', 'schema.prisma');
const migrationPath = path.join(baseDir, 'prisma', 'migrations', '20260731_comparecientes_alta_session_ia', 'migration.sql');
const rollbackPath = path.join(baseDir, 'prisma', 'migrations', '20260731_comparecientes_alta_session_ia', 'rollback.sql');

console.log('=== HASHES SHA-256 PAQUETE DE MIGRACIÓN ===');
console.log(`schema.prisma:                    ${getHash(schemaPath)}`);
console.log(`migration.sql:                    ${getHash(migrationPath)}`);
console.log(`rollback.sql:                     ${getHash(rollbackPath)}`);
