import * as dotenv from 'dotenv';
dotenv.config();

export const config = {
  /**
   * Url site
   */
  url: {
    allowedOrigins: process.env.ALLOWED_ORIGINS,
    client: process.env.NODE_CLIENT_URL,
    dashboard: process.env.NODE_DASHBOARD_URL,
  },
  /**
   * Node environment
   */
  environment: process.env.NODE_ENV || 'dev',
  /**
   * Cookie configuration
   */

  cookieKey: process.env.COOKIE_KEY || '@3%NE8IksyHK4yC5POFurDCAVW@FqxBe',
  cookie_access: {
    user: {
      nameLogin: process.env.COOKIE_NAME_LOGIN || 'x-user',
      accessExpireLogin: process.env.COOKIE_ACCESS_EXPIRE || '86400000000',
      nameVerify: process.env.COOKIE_NAME_LOGIN || 'x-verify-code',
      accessExpireVerify:
        process.env.COOKIE_VALIDATION_TOKEN_EXPIRE || '300000000000',
    },
  },
  /**
   * Integration with third-party services
   */
  connector_access: {
    vTiger: {
      baseUrl: process.env.VTIGER_BASE_URL || 'https://example.com',
      username: process.env.VTIGER_USERNAME || 'username',
      password: process.env.VTIGER_PASSWORD || 'password',
    },
  },

  /**
   * Api
   */
  api: {
    prefix: '/api',
    version: process.env.API_VERSION,
    headerSecretKey: process.env.HEADER_API_SECRET_KEY,
  },
  /**
   * Server port
   */
  port: process.env.PORT || 5500,
  /**
   * Database
   */
  database: {
    url: process.env.DATABASE_URL,
  },
  /**
   * Show or not console.log
   */
  showLog: true,
};
