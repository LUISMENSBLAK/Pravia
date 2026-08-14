type DeploymentEnvironment = Record<string, string | undefined>;

const localHosts = new Set(['localhost', '127.0.0.1', '::1']);

const absoluteUrl = (value: string) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

export function validateFrontendDeployment(
  env: DeploymentEnvironment,
  viteMode: string,
): string[] {
  const errors: string[] = [];
  const apiBase = String(env.VITE_API_BASE_URL || '').trim();
  const deployEnvironment = String(env.VITE_DEPLOY_ENV || '').trim().toLowerCase();
  const apiUrl = absoluteUrl(apiBase);

  if (viteMode === 'production' && apiUrl && localHosts.has(apiUrl.hostname.toLowerCase())) {
    errors.push('VITE_API_BASE_URL no puede apuntar a localhost en un build de producción.');
  }
  if (viteMode === 'production' && apiUrl && apiUrl.protocol !== 'https:') {
    errors.push('VITE_API_BASE_URL debe usar HTTPS en un build de producción.');
  }

  if (deployEnvironment === 'staging') {
    const expectedHost = String(env.VITE_EXPECTED_API_HOST || '').trim().toLowerCase();
    if (!apiUrl || apiUrl.protocol !== 'https:') {
      errors.push('Un deploy staging requiere VITE_API_BASE_URL absoluto con HTTPS.');
    }
    if (!expectedHost) {
      errors.push('Un deploy staging requiere VITE_EXPECTED_API_HOST.');
    } else if (apiUrl && apiUrl.hostname.toLowerCase() !== expectedHost) {
      errors.push('VITE_API_BASE_URL no coincide con VITE_EXPECTED_API_HOST.');
    }

    const productionHosts = String(env.VITE_PRODUCTION_API_HOSTS || '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    if (apiUrl && productionHosts.includes(apiUrl.hostname.toLowerCase())) {
      errors.push('Un deploy staging no puede apuntar a un host API de producción.');
    }
  }

  return errors;
}

export function assertFrontendDeployment(env: DeploymentEnvironment, viteMode: string) {
  const errors = validateFrontendDeployment(env, viteMode);
  if (errors.length) throw new Error(`Configuración frontend insegura: ${errors.join(' ')}`);
}
