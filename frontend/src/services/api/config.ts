const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const apiConfig = {
  baseUrl: trimTrailingSlash(import.meta.env.VITE_API_BASE_URL ?? '/api'),
  loginPath: import.meta.env.VITE_AUTH_LOGIN_PATH ?? '/auth/login',
  refreshPath: import.meta.env.VITE_AUTH_REFRESH_PATH ?? '/auth/refresh',
  mePath: import.meta.env.VITE_AUTH_ME_PATH ?? '/auth/me',
  logoutPath: import.meta.env.VITE_AUTH_LOGOUT_PATH ?? '/auth/logout',
  myDayPath: import.meta.env.VITE_MY_DAY_PATH ?? '/dashboard/mi-dia',
};

export const apiUrl = (path: string) => {
  if (/^https?:\/\//i.test(path)) return path;
  return `${apiConfig.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
};
