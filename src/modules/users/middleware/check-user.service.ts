import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { JwtPayload, sign } from 'jsonwebtoken';
import { config } from '../../../app/config';
export type JwtToken = {
  userId?: string;
  email?: string;
  reqUserId?: string;
  tenantId?: string;
  invitationId?: string;
  role?: string;
};
@Injectable()
export class CheckUserService {
  constructor() {}

  async createTokenCookie(data: JwtPayload, expiryMilliseconds: number) {
    if (!config.cookieKey) {
      throw new ServiceUnavailableException(
        'COOKIE_KEY must be configured before issuing login tokens.',
      );
    }
    const expirySeconds = Math.floor(expiryMilliseconds / 1000);
    if (!Number.isFinite(expirySeconds) || expirySeconds < 1) {
      throw new ServiceUnavailableException('Cookie lifetime is invalid.');
    }
    return sign(data, config.cookieKey, { expiresIn: expirySeconds });
  }
}
