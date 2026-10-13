import jwt from 'jsonwebtoken';
import { config } from '../../../app/config';
import { CheckUserService } from './check-user.service';

describe('CheckUserService', () => {
  const previousCookieKey = config.cookieKey;

  afterEach(() => {
    config.cookieKey = previousCookieKey;
  });

  it('creates a signed login token using the configured cookie key', async () => {
    config.cookieKey = 'test-cookie-signing-key';
    const service = new CheckUserService();

    const token = await service.createTokenCookie({ userId: 'user-1' }, 60_000);

    expect(jwt.decode(token)).toMatchObject({ userId: 'user-1' });
    expect(jwt.verify(token, config.cookieKey)).toMatchObject({
      userId: 'user-1',
    });
  });
});
