import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Prisma, PortalInvitationPurpose } from '../../app/database/prisma';
import { config } from '../../app/config';
import { DatabaseService } from '../../app/database/database.service';
import { VtigerService } from '../../integrations/vtiger/vtiger.service';
import { hashPassword } from './users.type';
import { EmailService } from '../../integrations/email.service';

export interface ProvisionPortalContactInput {
  tenantId: string;
  vtigerContactId: string;
}

export interface AcceptedPortalAccount {
  id: string;
  email: string;
  username: string;
  tenantId: string;
}

@Injectable()
export class PortalInvitationsService {
  private readonly logger = new Logger(PortalInvitationsService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly vtiger: VtigerService,
    private readonly emailService: EmailService,
  ) {}

  inviteContact(input: ProvisionPortalContactInput, provisioningKey?: string) {
    return this.issueForContact(input, 'INVITE', provisioningKey);
  }

  requestActivation(email: string): Promise<void> {
    return this.requestSelfServiceLink(email, PortalInvitationPurpose.INVITE);
  }

  requestPasswordReset(email: string): Promise<void> {
    return this.requestSelfServiceLink(
      email,
      PortalInvitationPurpose.PASSWORD_RESET,
    );
  }

  issuePasswordReset(
    input: ProvisionPortalContactInput,
    provisioningKey?: string,
  ) {
    return this.issueForContact(input, 'PASSWORD_RESET', provisioningKey);
  }

  private async requestSelfServiceLink(
    rawEmail: string,
    purpose: PortalInvitationPurpose,
  ): Promise<void> {
    try {
      const email = rawEmail.trim().toLocaleLowerCase();
      const contacts = await this.vtiger.query<unknown>(
        `select id, email, firstname, lastname, account_id from Contacts where email = '${this.escapeQuery(email)}';`,
      );
      if (!Array.isArray(contacts)) return;

      const matchingContacts = contacts.filter(
        (contact): contact is Record<string, unknown> =>
          this.isRecord(contact) &&
          typeof contact.email === 'string' &&
          contact.email.trim().toLocaleLowerCase() === email,
      );

      if (matchingContacts.length !== 1) return;

      const contact = matchingContacts[0];
      const contactId = this.getRelatedId(contact.id);
      const accountId = this.getRelatedId(contact.account_id);

      if (!contactId || !accountId) return;

      const tenant = await this.findTenantForAccount(
        accountId,
        this.getRelatedName(contact.account_id),
      );
      if (!tenant) {
        return;
      }
      await this.issueForContact(
        { tenantId: tenant.id, vtigerContactId: contactId },
        purpose,
        undefined,
        false,
        contact,
      );
    } catch (error) {
      this.logger.error(
        'Self-service portal access email could not be issued.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async findTenantForAccount(accountId: string, accountName?: string) {
    const mappedTenant = await this.database.tenant.findFirst({
      where: { vtigerAccountId: accountId, deletedAt: null },
    });
    if (mappedTenant) return mappedTenant;

    const normalizedName = accountName?.trim();
    if (normalizedName) {
      const matchingTenants = await this.database.tenant.findMany({
        where: {
          name: normalizedName,
          vtigerAccountId: null,
          deletedAt: null,
        },
        take: 2,
      });
      if (matchingTenants.length > 1) return undefined;

      if (matchingTenants.length === 1) {
        const tenant = matchingTenants[0];
        const mapped = await this.database.tenant.updateMany({
          where: { id: tenant.id, vtigerAccountId: null, deletedAt: null },
          data: { vtigerAccountId: accountId },
        });
        if (mapped.count === 1) {
          return { ...tenant, vtigerAccountId: accountId };
        }

        const concurrentlyMappedTenant = await this.database.tenant.findFirst({
          where: { vtigerAccountId: accountId, deletedAt: null },
        });
        if (concurrentlyMappedTenant) return concurrentlyMappedTenant;
      }
    }

    try {
      return await this.database.tenant.create({
        data: {
          name: normalizedName || accountId,
          vtigerAccountId: accountId,
        },
      });
    } catch (error) {
      const concurrentlyMappedTenant = await this.database.tenant.findFirst({
        where: { vtigerAccountId: accountId, deletedAt: null },
      });
      if (concurrentlyMappedTenant) return concurrentlyMappedTenant;
      throw error;
    }
  }

  async accept(
    token: string,
    password: string,
  ): Promise<AcceptedPortalAccount> {
    const tokenHash = this.hashToken(token);
    const invitation = await this.database.portalInvitation.findUnique({
      where: { tokenHash },
    });
    const now = new Date();
    if (
      !invitation ||
      invitation.redeemedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= now
    ) {
      throw new UnauthorizedException('Invitation link is invalid or expired.');
    }

    const passwordHash = await hashPassword(password);
    return this.database.$transaction(async (transaction) => {
      const consumed = await transaction.portalInvitation.updateMany({
        where: {
          id: invitation.id,
          redeemedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { redeemedAt: now },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException(
          'Invitation link is invalid or expired.',
        );
      }

      let user: AcceptedPortalAccount;
      if (invitation.purpose === PortalInvitationPurpose.INVITE) {
        const existing = await transaction.user.findUnique({
          where: { email: invitation.email },
        });
        if (existing) {
          throw new ConflictException(
            'This email already has a portal account. Request a password reset instead.',
          );
        }

        const created = await transaction.user.create({
          data: {
            email: invitation.email,
            username: invitation.username,
            password: passwordHash,
            tenantId: invitation.tenantId,
            vtigerContactId: invitation.vtigerContactId,
          },
          select: { id: true, email: true, username: true, tenantId: true },
        });
        await transaction.userTenant.create({
          data: {
            userId: created.id,
            tenantId: invitation.tenantId,
            role: 'client',
          },
        });
        await transaction.portalInvitation.update({
          where: { id: invitation.id },
          data: { userId: created.id },
        });
        user = created;
      } else {
        if (!invitation.userId) {
          throw new UnauthorizedException(
            'Invitation link is invalid or expired.',
          );
        }
        const updated = await transaction.user.updateMany({
          where: {
            id: invitation.userId,
            email: invitation.email,
            tenantId: invitation.tenantId,
            vtigerContactId: invitation.vtigerContactId,
          },
          data: { password: passwordHash },
        });
        if (updated.count !== 1) {
          throw new UnauthorizedException(
            'Invitation link is invalid or expired.',
          );
        }
        const resetUser = await transaction.user.findUniqueOrThrow({
          where: { id: invitation.userId },
          select: { id: true, email: true, username: true, tenantId: true },
        });
        user = resetUser;
      }

      return user;
    });
  }

  private async issueForContact(
    input: ProvisionPortalContactInput,
    purpose: PortalInvitationPurpose,
    suppliedKey?: string,
    requireProvisioningKey = true,
    verifiedContact?: Record<string, unknown>,
  ) {
    if (requireProvisioningKey) this.assertProvisioningKey(suppliedKey);
    if (!config.portalBaseUrl) {
      throw new InternalServerErrorException(
        'PORTAL_BASE_URL must be configured to create invitation links.',
      );
    }

    const tenant = await this.database.tenant.findFirst({
      where: { id: input.tenantId, deletedAt: null },
    });
    if (!tenant) throw new NotFoundException('Tenant not found.');

    const contact =
      verifiedContact ??
      (await this.vtiger.retrieve<Record<string, unknown>>(
        'Contacts',
        input.vtigerContactId,
      ));
    const email =
      typeof contact.email === 'string'
        ? contact.email.trim().toLocaleLowerCase()
        : '';
    if (!email) {
      throw new ForbiddenException('The vTiger Contact has no email address.');
    }

    const accountId =
      tenant.vtigerAccountId ?? (await this.findAccountId(tenant.name));
    if (this.getRelatedId(contact.account_id) !== accountId) {
      throw new ForbiddenException(
        'The vTiger Contact does not belong to the selected tenant Account.',
      );
    }
    if (!tenant.vtigerAccountId) {
      await this.database.tenant.update({
        where: { id: tenant.id },
        data: { vtigerAccountId: accountId },
      });
    }

    const user = await this.database.user.findUnique({ where: { email } });
    if (purpose === PortalInvitationPurpose.INVITE && user) {
      throw new ConflictException(
        'This email already has a portal account. Issue a password-reset link instead.',
      );
    }
    if (purpose === PortalInvitationPurpose.PASSWORD_RESET) {
      if (
        !user ||
        user.tenantId !== tenant.id ||
        (user.vtigerContactId && user.vtigerContactId !== input.vtigerContactId)
      ) {
        throw new NotFoundException(
          'Portal account not found for this Contact.',
        );
      }
      if (!user.vtigerContactId) {
        await this.database.user.update({
          where: { id: user.id },
          data: { vtigerContactId: input.vtigerContactId },
        });
      }
    }

    const username = this.getContactName(contact, email);
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      Date.now() +
        (purpose === PortalInvitationPurpose.INVITE ? 24 * 60 : 15) * 60 * 1000,
    );

    await this.database.portalInvitation.updateMany({
      where: {
        email,
        tenantId: tenant.id,
        purpose,
        redeemedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    const invitation = await this.database.portalInvitation.create({
      data: {
        tokenHash: this.hashToken(token),
        purpose,
        email,
        username,
        vtigerContactId: input.vtigerContactId,
        tenantId: tenant.id,
        userId: user?.id,
        expiresAt,
      },
    });

    const portalBase = config.portalBaseUrl.replace(/\/+$/, '');
    const inviteUrl = new URL('/accept-invitation', `${portalBase}/`);
    inviteUrl.searchParams.set('token', token);
    inviteUrl.searchParams.set(
      'purpose',
      purpose === PortalInvitationPurpose.INVITE ? 'invite' : 'password-reset',
    );

    try {
      await this.emailService.sendPortalAccessLink({
        to: email,
        url: inviteUrl.toString(),
        purpose,
        expiresAt,
      });
    } catch {
      await this.database.portalInvitation.updateMany({
        where: { id: invitation.id, redeemedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new ServiceUnavailableException(
        'The access email could not be sent. Please try again later.',
      );
    }

    return { email, purpose, expiresAt, sent: true };
  }

  private assertProvisioningKey(suppliedKey?: string): void {
    const configuredKey = config.portalProvisioningKey;
    if (!configuredKey || !suppliedKey) {
      throw new UnauthorizedException('Invalid provisioning credentials.');
    }

    const expected = Buffer.from(configuredKey);
    const received = Buffer.from(suppliedKey);
    if (
      expected.length !== received.length ||
      !timingSafeEqual(expected, received)
    ) {
      throw new UnauthorizedException('Invalid provisioning credentials.');
    }
  }

  private async findAccountId(tenantName: string): Promise<string> {
    const accounts = await this.vtiger.query<unknown>(
      `select id from Accounts where accountname = '${tenantName.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}';`,
    );
    const account = Array.isArray(accounts)
      ? accounts.find((item) => this.isRecord(item))
      : undefined;
    const id = this.isRecord(account) ? account.id : undefined;
    if (typeof id !== 'string' || !id) {
      throw new NotFoundException('No matching vTiger Account was found.');
    }
    return id;
  }

  private getContactName(
    contact: Record<string, unknown>,
    email: string,
  ): string {
    const firstName =
      typeof contact.firstname === 'string' ? contact.firstname.trim() : '';
    const lastName =
      typeof contact.lastname === 'string' ? contact.lastname.trim() : '';
    return `${firstName} ${lastName}`.trim() || email.split('@')[0];
  }

  private getRelatedId(value: unknown): string | undefined {
    if (typeof value === 'string') return value;
    if (!this.isRecord(value)) return undefined;
    if (typeof value.value === 'string') return value.value;
    if (typeof value.id === 'string') return value.id;
    return undefined;
  }

  private getRelatedName(value: unknown): string | undefined {
    if (!this.isRecord(value)) return undefined;
    for (const key of ['label', 'name', 'accountname']) {
      const name = value[key];
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
    return undefined;
  }

  private escapeQuery(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
