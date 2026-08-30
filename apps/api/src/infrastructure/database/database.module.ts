import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { createDatabase, type Database } from "./connection";

export const DATABASE = Symbol("DATABASE");

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Database => {
        const url = config.get<string>("DATABASE_URL");
        if (!url) throw new Error("DATABASE_URL is not set");
        return createDatabase(url);
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /** Release the pool so the process can exit cleanly (tests, SIGTERM). */
  async onApplicationShutdown(): Promise<void> {
    await this.database.client.end({ timeout: 5 });
  }
}
