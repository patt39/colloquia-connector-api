export type Env = 'dev' | 'production';

export const getCookieSettings = (env: string) =>
  env === 'production' ? settingsMap.production : settingsMap.dev;

const settingsMap: {
  [Key in Env]: {
    httpOnly: true;
    secure: boolean;
    domain?: string;
    sameSite: 'none' | 'lax' | 'strict';
  };
} = {
  dev: {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
  },
  production: {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
  },
};
