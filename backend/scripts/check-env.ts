import dotenv from 'dotenv';
import path from 'path';
import { resolveRuntimeConfig, validateRuntimeConfig } from '../src/config/runtime';

dotenv.config({ path: path.join(__dirname, '../.env') });

let hasErrors = false;
let config;
try {
  config = resolveRuntimeConfig();
  console.log(`OK database_mode=${config.database.mode} primary=${config.database.primary} schema=${config.database.schema}`);
  console.log(`OK storage_mode=${config.storage.mode} primary=${config.storage.primary}`);
  for (const error of validateRuntimeConfig(config)) {
    console.error(`INVALIDA ${error}`);
    hasErrors = true;
  }
} catch (error: any) {
  console.error(`INVALIDA ${error.message}`);
  hasErrors = true;
}

if ((process.env.AUTH_JWT_SECRET || '').length < 32) {
  console.error('INVALIDA AUTH_JWT_SECRET: debe tener al menos 32 caracteres aleatorios.');
  hasErrors = true;
} else console.log('OK AUTH_JWT_SECRET');

for (const key of ['OPENAI_API_KEY', 'OPENAI_DOCUMENT_MODEL', 'OPENAI_ESCALATION_MODEL', 'OPENAI_REASONING_EFFORT'] as const) {
  console.log(`${process.env[key]?.trim() ? 'OK' : 'OPCIONAL'} ${key}`);
}

if (hasErrors) process.exitCode = 1;
