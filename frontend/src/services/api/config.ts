const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const apiConfig = {
  baseUrl: trimTrailingSlash(import.meta.env.VITE_API_BASE_URL ?? '/api'),
  loginPath: import.meta.env.VITE_AUTH_LOGIN_PATH ?? '/auth/login',
  refreshPath: import.meta.env.VITE_AUTH_REFRESH_PATH ?? '/auth/refresh',
  mePath: import.meta.env.VITE_AUTH_ME_PATH ?? '/auth/me',
  logoutPath: import.meta.env.VITE_AUTH_LOGOUT_PATH ?? '/auth/logout',
  myDayPath: import.meta.env.VITE_MY_DAY_PATH ?? '/dashboard/mi-dia',
  assistantMessagePath: import.meta.env.VITE_ASSISTANT_MESSAGE_PATH || undefined,
  assistantSuggestionsPath: import.meta.env.VITE_ASSISTANT_SUGGESTIONS_PATH || undefined,
  assistantConfirmPath: import.meta.env.VITE_ASSISTANT_CONFIRM_PATH || undefined,
  assistantDismissPath: import.meta.env.VITE_ASSISTANT_DISMISS_PATH || undefined,
  assistantSnoozePath: import.meta.env.VITE_ASSISTANT_SNOOZE_PATH || undefined,
};

export const apiUrl = (path: string) => {
  if (/^https?:\/\//i.test(path)) return path;
  return `${apiConfig.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
};
