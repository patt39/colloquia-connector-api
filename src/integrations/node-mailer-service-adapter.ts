import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Resend } from 'resend';
import { config } from '../app/config';

export interface EmailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
}

@Injectable()
export class NodeMailerServiceAdapter {
  private client?: Resend;

  async send(message: EmailMessage): Promise<void> {
    if (!config.email.resendApiKey || !config.email.from) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured.',
      );
    }

    this.client ??= new Resend(config.email.resendApiKey);
    const { error } = await this.client.emails.send({
      from: config.email.from,
      ...message,
    });

    if (error) {
      throw new ServiceUnavailableException('Email delivery failed.');
    }
  }
}
