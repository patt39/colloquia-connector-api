import { Injectable } from '@nestjs/common';
import { NodeMailerServiceAdapter } from './node-mailer-service-adapter';

export type PortalEmailPurpose = 'INVITE' | 'PASSWORD_RESET';

@Injectable()
export class EmailService {
  constructor(private readonly emailAdapter: NodeMailerServiceAdapter) {}

  sendPortalAccessLink(input: {
    to: string;
    url: string;
    purpose: PortalEmailPurpose;
    expiresAt: Date;
  }): Promise<void> {
    const isPasswordReset = input.purpose === 'PASSWORD_RESET';
    const action = isPasswordReset
      ? 'reset your password'
      : 'activate your account';
    const subject = isPasswordReset
      ? 'Reset your VOX GENTIUM Services password'
      : 'Activate your VOX GENTIUM Services account';
    const safeUrl = this.escapeHtml(input.url);
    const expiration = input.expiresAt.toUTCString();

    return this.emailAdapter.send({
      to: [input.to],
      subject,
      text: `Use this link to ${action}: ${input.url}\nThis link expires ${expiration}. If you did not request this, ignore this email.`,
      html: `<p>Use the link below to ${action}:</p><p><a href="${safeUrl}">${isPasswordReset ? 'Reset password' : 'Activate account'}</a></p><p>This link expires ${expiration}. If you did not request this, you can ignore this email.</p>`,
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
