import { Module } from "@nestjs/common";

import { HostsService } from "./hosts.service";

@Module({ providers: [HostsService], exports: [HostsService] })
export class HostsModule {}
