import { Injectable } from '@nestjs/common';
import { subDays } from 'date-fns';
import { OauthClient } from '../../generated/prisma/client';
import { PrismaService } from '../../platform/db/prisma.service';

/** OAuth clients registered to connect to the App MCP. */
@Injectable()
export class OauthClientsRepository {
  constructor(private readonly prisma: PrismaService) {}

  register(clientName: string, redirectUris: readonly string[]): Promise<OauthClient> {
    return this.prisma.oauthClient.create({
      data: { clientName, redirectUris: [...redirectUris] },
    });
  }

  find(id: string): Promise<OauthClient | null> {
    return this.prisma.oauthClient.findUnique({ where: { id } });
  }

  count(): Promise<number> {
    return this.prisma.oauthClient.count();
  }

  /**
   * Prunes the clients the owner never gave access to, because Claude registers a new client for
   * every connection and an unfinished attempt leaves a row. A client with a live token pair is
   * left untouched.
   */
  async pruneUnused(days: number): Promise<number> {
    const { count } = await this.prisma.oauthClient.deleteMany({
      where: {
        createdAt: { lt: subDays(new Date(), days) },
        tokens: { none: { revokedAt: null, refreshExpiresAt: { gt: new Date() } } },
      },
    });

    return count;
  }
}
