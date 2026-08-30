import {
  PermanentEmailError,
  TemporaryEmailError,
  type EmailMessage,
} from "../../src/modules/notifications/domain/notification";
import type { EmailProvider } from "../../src/modules/notifications/infrastructure/email-provider";

/**
 * Stand-in for SMTP. Automated tests must not depend on a live provider, and
 * this also lets a test decide to fail temporarily or permanently on demand
 * (milestone 05 §81).
 */
export class FakeEmailProvider implements EmailProvider {
  readonly sent: EmailMessage[] = [];

  private failures = 0;
  private mode: "ok" | "temporary" | "permanent" = "ok";

  failTemporarily(times: number): void {
    this.mode = "temporary";
    this.failures = times;
  }

  failPermanently(): void {
    this.mode = "permanent";
  }

  succeed(): void {
    this.mode = "ok";
    this.failures = 0;
  }

  reset(): void {
    this.sent.length = 0;
    this.succeed();
  }

  countOf(subjectFragment: string): number {
    return this.sent.filter((message) => message.subject.includes(subjectFragment)).length;
  }

  async send(message: EmailMessage): Promise<void> {
    if (this.mode === "permanent") {
      throw new PermanentEmailError("Adres odrzucony", "SMTP_550");
    }

    if (this.mode === "temporary" && this.failures > 0) {
      this.failures -= 1;
      throw new TemporaryEmailError("Chwilowy błąd serwera", "SMTP_451");
    }

    this.sent.push({ ...message });
  }
}
