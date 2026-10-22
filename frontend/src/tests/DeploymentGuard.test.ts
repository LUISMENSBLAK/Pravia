import { describe, expect, it } from 'vitest';
import { validateFrontendDeployment } from '../config/deploymentGuard';

describe('deployment guard del frontend', () => {
  it('permite same-origin y desarrollo local', () => {
    expect(validateFrontendDeployment({}, 'production')).toEqual([]);
    expect(validateFrontendDeployment({ VITE_API_BASE_URL: 'http://127.0.0.1:3001/api' }, 'development')).toEqual([]);
  });

  it('bloquea localhost y HTTP en builds de producción', () => {
    expect(validateFrontendDeployment({ VITE_API_BASE_URL: 'http://localhost:3001/api' }, 'production')).toEqual(expect.arrayContaining([
      expect.stringMatching(/localhost/),
      expect.stringMatching(/HTTPS/),
    ]));
  });

  it('exige que staging use HTTPS y el host esperado', () => {
    const errors = validateFrontendDeployment({
      VITE_DEPLOY_ENV: 'staging',
      VITE_API_BASE_URL: 'https://api.production.example/api',
      VITE_EXPECTED_API_HOST: 'api.staging.example',
      VITE_PRODUCTION_API_HOSTS: 'api.production.example',
    }, 'production');
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/no coincide/),
      expect.stringMatching(/producción/),
    ]));
  });

  it('acepta un target staging explícito y separado', () => {
    expect(validateFrontendDeployment({
      VITE_DEPLOY_ENV: 'staging',
      VITE_API_BASE_URL: 'https://api.staging.example/api',
      VITE_EXPECTED_API_HOST: 'api.staging.example',
      VITE_PRODUCTION_API_HOSTS: 'api.production.example',
    }, 'production')).toEqual([]);
  });

  it('rechaza una preview Netlify que heredaría /api y su redirect productivo', () => {
    const errors = validateFrontendDeployment({ CONTEXT: 'deploy-preview', VITE_API_BASE_URL: '/api' }, 'production');
    expect(errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/VITE_DEPLOY_ENV=staging/),
      expect.stringMatching(/HTTPS/),
      expect.stringMatching(/VITE_PRODUCTION_API_HOSTS/),
    ]));
  });

  it('exige la lista de hosts productivos incluso con API staging explícita', () => {
    expect(validateFrontendDeployment({
      CONTEXT: 'branch-deploy',
      VITE_DEPLOY_ENV: 'staging',
      VITE_API_BASE_URL: 'https://api.staging.example/api',
      VITE_EXPECTED_API_HOST: 'api.staging.example',
    }, 'production')).toEqual(expect.arrayContaining([expect.stringMatching(/VITE_PRODUCTION_API_HOSTS/)]));
  });

  it('bloquea el host productivo actual aunque la lista configurable esté mal definida', () => {
    expect(validateFrontendDeployment({
      CONTEXT: 'deploy-preview',
      VITE_DEPLOY_ENV: 'staging',
      VITE_API_BASE_URL: 'https://pravia-api.onrender.com/api',
      VITE_EXPECTED_API_HOST: 'pravia-api.onrender.com',
      VITE_PRODUCTION_API_HOSTS: 'api.production.example',
    }, 'production')).toEqual(expect.arrayContaining([expect.stringMatching(/host API de producción/)]));
  });

  it('permite una preview Netlify sólo con API staging y hosts productivos separados', () => {
    expect(validateFrontendDeployment({
      CONTEXT: 'branch-deploy',
      VITE_DEPLOY_ENV: 'staging',
      VITE_API_BASE_URL: 'https://api.staging.example/api',
      VITE_EXPECTED_API_HOST: 'api.staging.example',
      VITE_PRODUCTION_API_HOSTS: 'api.production.example',
    }, 'production')).toEqual([]);
  });
});
