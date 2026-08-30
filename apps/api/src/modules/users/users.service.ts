import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database, Executor } from "../../infrastructure/database/connection";
import { users, type UserRow } from "../../infrastructure/database/schema";

/** Email is the login identity, so it is normalised in exactly one place. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async findByEmail(email: string, executor: Executor = this.database.db) {
    const [user] = await executor
      .select()
      .from(users)
      .where(eq(users.email, normaliseEmail(email)))
      .limit(1);
    return user ?? null;
  }

  async findById(id: string): Promise<UserRow | null> {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return user ?? null;
  }

  async create(
    input: {
      email: string;
      passwordHash: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
    },
    executor: Executor = this.database.db,
  ): Promise<UserRow> {
    const [user] = await executor
      .insert(users)
      .values({
        email: normaliseEmail(input.email),
        passwordHash: input.passwordHash,
        firstName: input.firstName ?? null,
        lastName: input.lastName ?? null,
        phone: input.phone ?? null,
      })
      .returning();
    return user;
  }

  /**
   * Profile only. Email is deliberately absent: changing a login identity
   * needs a verification flow, which is out of scope (milestone 06 §8).
   *
   * This never touches a Booking — historical snapshots stay as they were.
   */
  async updateProfile(
    id: string,
    patch: {
      firstName?: string | null;
      lastName?: string | null;
      phone?: string | null;
      preferredLocale?: string | null;
    },
  ): Promise<UserRow> {
    const [user] = await this.database.db
      .update(users)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }
}
