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
});
