import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { assertFrontendDeployment } from './src/config/deploymentGuard.ts';

export default defineConfig(({ mode }) => {
  assertFrontendDeployment(loadEnv(mode, process.cwd(), ''), mode);
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 4173,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      css: true,
      // Los archivos ejercitan la aplicación completa. Un solo worker evita
      // transformar en paralelo los mismos route chunks y mantiene cada prueba
      // bajo el timeout local sin ampliar ese límite.
      maxWorkers: 1,
    },
  };
});
