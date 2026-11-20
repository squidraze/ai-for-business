import 'i18next';

import type en from './locales/en.json';

// Keys are typed against the English bundle: a typo fails `tsc`.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'chat';
    resources: { chat: typeof en };
  }
}
