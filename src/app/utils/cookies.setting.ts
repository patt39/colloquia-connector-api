export type Env = 'dev';

/** Get the correct cookie settings based on environment */
export const getCookieSettings = (env: string) =>
  env in settingsMap ? settingsMap[(env as Env) ?? 'dev'] : settingsMap.dev;

const settingsMap: {
  [Key in Env]: {
    httpOnly: false;
    secure: boolean;
    domain?: string;
    sameSite: 'none' | 'lax' | 'strict';
  };
} = {
  dev: {
    httpOnly: false,
    secure: true,
    sameSite: 'none',
  },
};
