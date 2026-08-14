/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_DEPLOY_ENV?: string;
  readonly VITE_EXPECTED_API_HOST?: string;
  readonly VITE_PRODUCTION_API_HOSTS?: string;
  readonly VITE_AUTH_LOGIN_PATH?: string;
  readonly VITE_AUTH_REFRESH_PATH?: string;
  readonly VITE_AUTH_ME_PATH?: string;
  readonly VITE_AUTH_LOGOUT_PATH?: string;
  readonly VITE_MY_DAY_PATH?: string;
  readonly VITE_ASSISTANT_MESSAGE_PATH?: string;
  readonly VITE_ASSISTANT_SUGGESTIONS_PATH?: string;
  readonly VITE_ASSISTANT_CONFIRM_PATH?: string;
  readonly VITE_ASSISTANT_DISMISS_PATH?: string;
  readonly VITE_ASSISTANT_SNOOZE_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
