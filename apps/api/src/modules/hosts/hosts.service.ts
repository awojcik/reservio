import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";

import { DATABASE } from "../../infrastructure/database/database.module";
import type { Database, Executor } from "../../infrastructure/database/connection";
import { hosts, type HostRow } from "../../infrastructure/database/schema";

@Injectable()
export class HostsService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * The only way Host identity is ever established: Session → User → Host.
   * A hostId sent by a client is never trusted (milestone 02 §18).
   */
  async findByUserId(
    userId: string,
    executor: Executor = this.database.db,
  ): Promise<HostRow | null> {
    const [host] = await executor
      .select()
      .from(hosts)
      .where(eq(hosts.userId, userId))
      .limit(1);
    return host ?? null;
  }

  async create(
    input: { userId: string; displayName: string },
    executor: Executor = this.database.db,
  ): Promise<HostRow> {
    const [host] = await executor
      .insert(hosts)
      .values({ userId: input.userId, displayName: input.displayName.trim() })
      .returning();
    return host;
  }
}
