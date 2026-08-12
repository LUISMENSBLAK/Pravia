import 'dotenv/config';
import { checkStorageHealth, getStorageInfo } from '../src/storage/storage.service';

async function main() {
  const info = getStorageInfo();
  const status = await checkStorageHealth();
  console.log(JSON.stringify({ storage: status, ...info }));
  if (status !== 'ok') process.exitCode = 1;
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
