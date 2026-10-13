import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  createTransport,
  createTestAccount,
  getTestMessageUrl,
  type Transporter,
} from 'nodemailer';
import { Resend } from 'resend';
import { config, EnvironmentEnum } from '../app/config';

export interface EmailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

@Injectable()
export class NodeMailerServiceAdapter {
  private resend?: Resend;
  private ethereal?: Promise<{ transporter: Transporter; sender: string }>;

  async send(message: EmailMessage): Promise<void> {
    if (
      [EnvironmentEnum.Production, EnvironmentEnum.Demo].includes(
        config.environment as EnvironmentEnum,
      )
    ) {
      await this.sendWithResend(message);
      return;
    }

    if (
      [EnvironmentEnum.Dev, EnvironmentEnum.Local].includes(
        config.environment as EnvironmentEnum,
      )
    ) {
      await this.sendWithEthereal(message);
      return;
    }

    throw new ServiceUnavailableException(
      `Email delivery is unsupported for NODE_ENV=${config.environment}.`,
    );
  }

  private async sendWithResend(message: EmailMessage): Promise<void> {
    const apiKey = config.email.resendApiKey || config.resendSMTP.apiKey;
    const from = config.email.from || config.resendSMTP.noReplayFrom;
    if (!apiKey || !from) {
      throw new ServiceUnavailableException(
        'Resend email delivery is not configured.',
      );
    }

    this.resend ??= new Resend(apiKey);
    const { error } = await this.resend.emails.send({ from, ...message });
    if (error) {
      throw new ServiceUnavailableException('Resend email delivery failed.');
    }
  }

  private async sendWithEthereal(message: EmailMessage): Promise<void> {
    this.ethereal ??= this.createEtherealTransporter();
    const { transporter, sender } = await this.ethereal;
    const result = await transporter.sendMail({
      from: sender,
      ...message,
    });
    const previewUrl = getTestMessageUrl(result);
    if (previewUrl) {
      console.info(`Ethereal email preview: ${previewUrl}`);
    }
  }

  private async createEtherealTransporter(): Promise<{
    transporter: Transporter;
    sender: string;
  }> {
    const hasConfiguredCredentials =
      config.mailSMTP.host && config.mailSMTP.user && config.mailSMTP.pass;

    if (hasConfiguredCredentials) {
      return {
        transporter: createTransport({
          host: config.mailSMTP.host,
          port: config.mailSMTP.port || 587,
          secure: config.mailSMTP.port === 465,
          auth: {
            user: config.mailSMTP.user,
            pass: config.mailSMTP.pass,
          },
        }),
        sender: config.mailSMTP.user,
      };
    }

    const account = await createTestAccount();
    return {
      transporter: createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: { user: account.user, pass: account.pass },
      }),
      sender: account.user,
    };
  }
}
