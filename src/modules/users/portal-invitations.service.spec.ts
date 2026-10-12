import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PortalInvitationPurpose } from '../../app/database/prisma';
import { config } from '../../app/config';
import { PortalInvitationsService } from './portal-invitations.service';

describe('PortalInvitationsService', () => {
  const previousProvisioningKey = config.portalProvisioningKey;
  const previousPortalBaseUrl = config.portalBaseUrl;

  afterEach(() => {
    config.portalProvisioningKey = previousProvisioningKey;
    config.portalBaseUrl = previousPortalBaseUrl;
  });

  it('requires the provisioning key before making CRM calls', async () => {
    config.portalProvisioningKey = 'expected-secret';
    const vtiger = { retrieve: vi.fn() };
    const service = new PortalInvitationsService(
      {} as never,
      vtiger as never,
      {} as never,
    );

    await expect(
      service.inviteContact(
        { tenantId: 'tenant-1', vtigerContactId: 'contact-1' },
        'wrong-secret',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(vtiger.retrieve).not.toHaveBeenCalled();
  });

  it('creates an expiring invite for an existing Contact on the tenant Account', async () => {
    config.portalProvisioningKey = 'provisioning-secret';
    config.portalBaseUrl = 'https://portal.example.test';
    const invitationCreate = vi.fn().mockImplementation(({ data }) => ({
      id: 'invitation-1',
      ...data,
    }));
    const database = {
      tenant: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'tenant-1',
          name: 'Client Account',
          vtigerAccountId: 'account-1',
        }),
        update: vi.fn(),
      },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      portalInvitation: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: invitationCreate,
      },
    };
    const vtiger = {
      retrieve: vi.fn().mockResolvedValue({
        id: 'contact-1',
        email: 'Client@Example.com',
        firstname: 'Portal',
        lastname: 'Client',
        account_id: { value: 'account-1' },
      }),
      query: vi.fn(),
    };
    const emailService = { sendPortalAccessLink: vi.fn() };
    const service = new PortalInvitationsService(
      database as never,
      vtiger as never,
      emailService as never,
    );

    const result = await service.inviteContact(
      { tenantId: 'tenant-1', vtigerContactId: 'contact-1' },
      'provisioning-secret',
    );
    const sentEmail = emailService.sendPortalAccessLink.mock.calls[0][0];
    const inviteUrl = new URL(sentEmail.url);
    const rawToken = inviteUrl.searchParams.get('token');
    const saved = invitationCreate.mock.calls[0][0].data;

    expect(result.email).toBe('client@example.com');
    expect(result.purpose).toBe(PortalInvitationPurpose.INVITE);
    expect(result.sent).toBe(true);
    expect(inviteUrl.origin).toBe('https://portal.example.test');
    expect(inviteUrl.pathname).toBe('/accept-invitation');
    expect(rawToken).toBeTruthy();
    expect(saved.tokenHash).toBe(
      createHash('sha256').update(rawToken!).digest('hex'),
    );
    expect(saved.tokenHash).not.toBe(rawToken);
    expect(saved.vtigerContactId).toBe('contact-1');
    expect(emailService.sendPortalAccessLink).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'client@example.com',
        purpose: PortalInvitationPurpose.INVITE,
      }),
    );
    expect(result).not.toHaveProperty('inviteUrl');
    expect(vtiger.query).not.toHaveBeenCalled();
  });

  it('allows a client to request activation with only their Contact email', async () => {
    config.portalBaseUrl = 'https://portal.example.test';
    const contact = {
      id: '12x-contact-1',
      email: 'client@example.com',
      firstname: 'Portal',
      lastname: 'Client',
      account_id: { value: '11x-account-1' },
    };
    const tenant = {
      id: 'tenant-1',
      name: 'Client Account',
      vtigerAccountId: '11x-account-1',
    };
    const database = {
      tenant: {
        findFirst: vi.fn().mockResolvedValue(tenant),
        findMany: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      portalInvitation: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: 'invitation-1' }),
      },
    };
    const vtiger = {
      query: vi.fn().mockResolvedValue([contact]),
      retrieve: vi.fn().mockResolvedValue(contact),
    };
    const emailService = {
      sendPortalAccessLink: vi.fn().mockResolvedValue(undefined),
    };
    const service = new PortalInvitationsService(
      database as never,
      vtiger as never,
      emailService as never,
    );

    await expect(
      service.requestActivation(' Client@Example.com '),
    ).resolves.toBe(undefined);
    expect(vtiger.query).toHaveBeenCalledWith(
      expect.stringContaining("email = 'client@example.com'"),
    );
    expect(emailService.sendPortalAccessLink).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'client@example.com',
        purpose: PortalInvitationPurpose.INVITE,
      }),
    );
    expect(database.portalInvitation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: tenant.id,
          vtigerContactId: contact.id,
        }),
      }),
    );
  });

  it('maps an unmapped tenant using an Account query instead of Account retrieve', async () => {
    config.portalBaseUrl = 'https://portal.example.test';
    const contact = {
      id: '12x-contact-1',
      email: 'client@example.com',
      firstname: 'Portal',
      lastname: 'Client',
      account_id: { value: '11x-account-1' },
    };
    const tenant = {
      id: 'tenant-1',
      name: 'Client Account',
      vtigerAccountId: null,
    };
    const database = {
      tenant: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValue(tenant),
        findMany: vi.fn().mockResolvedValue([tenant]),
        update: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      portalInvitation: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: 'invitation-1' }),
      },
    };
    const vtiger = {
      query: vi
        .fn()
        .mockImplementation((query: string) =>
          Promise.resolve(
            query.includes('from Contacts')
              ? [contact]
              : [{ id: '11x-account-1', accountname: 'Client Account' }],
          ),
        ),
      retrieve: vi.fn().mockResolvedValue(contact),
    };
    const emailService = {
      sendPortalAccessLink: vi.fn().mockResolvedValue(undefined),
    };
    const service = new PortalInvitationsService(
      database as never,
      vtiger as never,
      emailService as never,
    );

    await service.requestActivation('client@example.com');

    expect(vtiger.query).toHaveBeenCalledWith(
      "select id, accountname from Accounts where id = '11x-account-1';",
    );
    expect(vtiger.retrieve).toHaveBeenCalledTimes(1);
    expect(vtiger.retrieve).toHaveBeenCalledWith('Contacts', contact.id);
    expect(database.tenant.updateMany).toHaveBeenCalledWith({
      where: { id: tenant.id, vtigerAccountId: null, deletedAt: null },
      data: { vtigerAccountId: '11x-account-1' },
    });
    expect(emailService.sendPortalAccessLink).toHaveBeenCalled();
  });

  it('does not reveal or email when no matching vTiger Contact exists', async () => {
    const database = { tenant: { findFirst: vi.fn() } };
    const vtiger = { query: vi.fn().mockResolvedValue([]) };
    const emailService = { sendPortalAccessLink: vi.fn() };
    const service = new PortalInvitationsService(
      database as never,
      vtiger as never,
      emailService as never,
    );

    await expect(
      service.requestActivation('unknown@example.com'),
    ).resolves.toBe(undefined);
    expect(emailService.sendPortalAccessLink).not.toHaveBeenCalled();
    expect(database.tenant.findFirst).not.toHaveBeenCalled();
  });

  it('redeems an invite once, hashes the password, and creates tenant membership', async () => {
    const token = 'single-use-invite-token';
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const invitation = {
      id: 'invitation-1',
      tokenHash,
      purpose: PortalInvitationPurpose.INVITE,
      email: 'client@example.com',
      username: 'Portal Client',
      tenantId: 'tenant-1',
      vtigerContactId: 'contact-1',
      userId: null,
      expiresAt: new Date(Date.now() + 60_000),
      redeemedAt: null,
      revokedAt: null,
    };
    const createdUser = {
      id: 'user-1',
      email: invitation.email,
      username: invitation.username,
      tenantId: invitation.tenantId,
    };
    const transaction = {
      portalInvitation: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn(),
      },
      user: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue(createdUser),
      },
      userTenant: { create: vi.fn() },
    };
    const database = {
      portalInvitation: { findUnique: vi.fn().mockResolvedValue(invitation) },
      $transaction: vi.fn((callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
      ),
    };
    const service = new PortalInvitationsService(
      database as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.accept(token, 'A-longer-password-123'),
    ).resolves.toEqual(createdUser);
    const createArgs = transaction.user.create.mock.calls[0][0];
    expect(createArgs.data.password).not.toBe('A-longer-password-123');
    expect(createArgs.data.vtigerContactId).toBe('contact-1');
    expect(transaction.userTenant.create).toHaveBeenCalledWith({
      data: { userId: 'user-1', tenantId: 'tenant-1', role: 'client' },
    });
    expect(transaction.portalInvitation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: invitation.id,
          redeemedAt: null,
          revokedAt: null,
        }),
      }),
    );
  });
});
