const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const apiConfig = {
  baseUrl: trimTrailingSlash(import.meta.env.VITE_API_BASE_URL ?? '/api'),
  uploadBaseUrl: trimTrailingSlash(import.meta.env.VITE_API_UPLOAD_BASE_URL ?? ''),
  loginPath: import.meta.env.VITE_AUTH_LOGIN_PATH ?? '/auth/login',
  refreshPath: import.meta.env.VITE_AUTH_REFRESH_PATH ?? '/auth/refresh',
  mePath: import.meta.env.VITE_AUTH_ME_PATH ?? '/auth/me',
  logoutPath: import.meta.env.VITE_AUTH_LOGOUT_PATH ?? '/auth/logout',
  myDayPath: import.meta.env.VITE_MY_DAY_PATH ?? '/mi-dia',
  assistantMessagePath: import.meta.env.VITE_ASSISTANT_MESSAGE_PATH || '/ia/assistant/messages',
  assistantConversationsPath: import.meta.env.VITE_ASSISTANT_CONVERSATIONS_PATH || '/ia/assistant/conversations',
  assistantSuggestionsPath: import.meta.env.VITE_ASSISTANT_SUGGESTIONS_PATH || undefined,
  assistantConfirmPath: import.meta.env.VITE_ASSISTANT_CONFIRM_PATH || '/ia/assistant/confirmations',
  assistantDismissPath: import.meta.env.VITE_ASSISTANT_DISMISS_PATH || undefined,
  assistantSnoozePath: import.meta.env.VITE_ASSISTANT_SNOOZE_PATH || undefined,
};

export const apiUrl = (path: string) => {
  if (/^https?:\/\//i.test(path)) return path;
  return `${apiConfig.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
};

// Large multipart bodies must not traverse a hosting proxy with a lower body
// limit. Auth/session requests keep their existing same-origin cookie route.
export const apiUploadUrl = (path: string) => apiConfig.uploadBaseUrl && !/^https?:\/\//i.test(path)
  ? `${apiConfig.uploadBaseUrl}${path.startsWith('/') ? path : `/${path}`}` : apiUrl(path);

// The existing Netlify rewrite has a 26-second ceiling. Long IA operations
// reuse the already configured Render origin, just like multipart uploads.
// Auth/refresh and ordinary business writes keep the same-origin cookie route.
export const apiOperationUrl = (path: string, method = 'GET') => {
  const route = path.split('?')[0];
  const longRunning = method.toUpperCase() === 'POST' && (
    /\/(?:ia|propuestas?-ia)(?:\/|$)/.test(route)
    || /\/(?:extraer(?:-ia)?|extract|interpret-operation|interpretar(?:-operacion)?|analizar-ia)$/.test(route)
    || /\/proyecto\/(?:generar|aplicar-indicaciones)$/.test(route)
    || /\/predios\/[^/]+\/extracciones\/preview$/.test(route)
  );
  return longRunning ? apiUploadUrl(path) : apiUrl(path);
};
