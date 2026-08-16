import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import type { ProxyOptions } from 'vite';
import { assertFrontendDeployment } from './src/config/deploymentGuard.ts';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  assertFrontendDeployment(env, mode);

  const localApiProxyTarget = String(env.LOCAL_API_PROXY_TARGET || '').trim().replace(/\/+$/, '');
  const localApiProxy = localApiProxyTarget
    ? {
        '/api': {
          target: localApiProxyTarget,
          changeOrigin: true,
          secure: true,
          configure(proxy) {
            // El navegador habla same-origin con Vite. El proxy no debe reenviar
            // el Origin local a un backend productivo con allowlist estricta.
            proxy.on('proxyReq', (proxyRequest) => proxyRequest.removeHeader('origin'));
          },
        } satisfies ProxyOptions,
      }
    : undefined;

  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: 4173,
      proxy: localApiProxy,
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      proxy: localApiProxy,
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
