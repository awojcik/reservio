import { Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createTransport, type Transporter } from "nodemailer";

import {
  PermanentEmailError,
  TemporaryEmailError,
  type EmailMessage,
} from "../domain/notification";
import type { EmailProvider } from "./email-provider";

/**
 * Plain SMTP. Locally this points at Mailpit, which captures everything so no
 * test email can escape to a real inbox; in production the same class talks to
 * whatever SMTP relay is configured.
 */
@Injectable()
export class SmtpEmailProvider implements EmailProvider, OnApplicationShutdown {
  private readonly logger = new Logger(SmtpEmailProvider.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.from = config.get<string>("EMAIL_FROM") ?? "no-reply@rezervio.local";

    this.transporter = createTransport({
      host: config.get<string>("SMTP_HOST") ?? "localhost",
      port: Number(config.get("SMTP_PORT") ?? 1025),
      secure: config.get("SMTP_SECURE") === "true",
      // Mailpit needs no credentials; a relay that does will have them set.
      ...(config.get<string>("SMTP_USER")
        ? {
            auth: {
              user: config.get<string>("SMTP_USER"),
              pass: config.get<string>("SMTP_PASSWORD"),
            },
          }
        : {}),
    });
  }

  async send(message: EmailMessage): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      throw classify(error);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.transporter.close();
  }
}

/**
 * SMTP 5xx means the server has made up its mind; 4xx is "try later". Anything
 * unrecognised is treated as temporary, because giving up on a Booking
 * notification is worse than one extra attempt.
 */
function classify(error: unknown): Error {
  const code = (error as { responseCode?: number }).responseCode;
  const message = (error as Error).message ?? "Nie udało się wysłać wiadomości.";

  if (typeof code === "number" && code >= 500 && code < 600) {
    return new PermanentEmailError(message, `SMTP_${code}`);
  }
  if (typeof code === "number" && code >= 400 && code < 500) {
    return new TemporaryEmailError(message, `SMTP_${code}`);
  }

  const errno = (error as { code?: string }).code;
  if (errno === "EENVELOPE" || errno === "EMESSAGE") {
    return new PermanentEmailError(message, errno);
  }

  return new TemporaryEmailError(message, errno ?? "SMTP_UNKNOWN");
}
