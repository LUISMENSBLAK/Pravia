import 'dotenv/config';
import { platformWorkerService } from '../src/platform/platformWorker.service';

const workerId = process.env.PLATFORM_WORKER_ID || `platform-worker:${process.pid}`;
const globalConcurrency = Number(process.env.PLATFORM_WORKER_GLOBAL_CONCURRENCY || '2');
const perTenantConcurrency = Number(process.env.PLATFORM_WORKER_TENANT_CONCURRENCY || '1');
const once = process.argv.includes('--once');

async function main() {
  if (process.env.PRAVIA_PLATFORM_WORKER_ENABLE !== '1') {
    throw new Error('Platform worker deshabilitado: configura PRAVIA_PLATFORM_WORKER_ENABLE=1 explícitamente.');
  }
  let databaseHost: string;
  try { databaseHost = new URL(process.env.DATABASE_URL || '').hostname; }
  catch { throw new Error('Platform worker requiere DATABASE_URL válida.'); }
  if (!['127.0.0.1', 'localhost', '::1'].includes(databaseHost)
    && process.env.PRAVIA_PLATFORM_WORKER_ALLOW_REMOTE !== '1') {
    throw new Error('Platform worker remoto requiere autorización explícita PRAVIA_PLATFORM_WORKER_ALLOW_REMOTE=1.');
  }
  do {
    const result = await platformWorkerService.runOnce({ workerId, globalConcurrency, perTenantConcurrency });
    if (once || !result) break;
  } while (true);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
