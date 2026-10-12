import * as dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
dotenv.config();

const environment = process.env.NODE_ENV || 'dev';
const configuredCookieKey = process.env.COOKIE_KEY?.trim();
const cookieKey =
  configuredCookieKey ||
  (environment === 'dev' ? randomBytes(32).toString('hex') : '');

if (environment === 'production' && !cookieKey) {
  throw new Error('COOKIE_KEY must be configured in production.');
}

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
  environment,
  /**
   * Cookie configuration
   */

  cookieKey,
  portalProvisioningKey: process.env.PORTAL_PROVISIONING_KEY || '',
  portalBaseUrl:
    process.env.PORTAL_BASE_URL || process.env.NODE_CLIENT_URL || '',
  cookie_access: {
    user: {
      nameLogin: process.env.COOKIE_NAME_LOGIN || 'x-user',
      accessExpireLogin: process.env.COOKIE_ACCESS_EXPIRE || '86400000',
    },
  },
  /**
   * Integration with third-party services
   */
  connector_access: {
    vTiger: {
      baseUrl: process.env.VTIGER_BASE_URL || '',
      username: process.env.VTIGER_USERNAME || '',
      accessKey: process.env.VTIGER_ACCESS_KEY || '',
      timeoutMs: Number(process.env.VTIGER_TIMEOUT_MS || 15000),
    },
  },
  email: {
    resendApiKey:
      process.env.RESEND_SMTP_API_KEY?.trim() ||
      process.env.RESEND_API_KEY?.trim() ||
      '',
    from:
      process.env.RESEND_SMTP_EMAIL?.trim() ||
      process.env.EMAIL_FROM?.trim() ||
      process.env.RESEND_FROM_NO_REPLAY_ADDRESS?.trim() ||
      '',
  },

  /**
   * Resend smtp
   */
  resendSMTP: {
    apiKey:
      process.env.RESEND_SMTP_API_KEY?.trim() ||
      process.env.RESEND_API_KEY?.trim() ||
      '',
    noReplayFrom:
      process.env.RESEND_SMTP_EMAIL?.trim() ||
      process.env.RESEND_FROM_NO_REPLAY_ADDRESS?.trim() ||
      process.env.EMAIL_FROM?.trim() ||
      '',
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
