import { Injectable } from '@nestjs/common';
import { subDays } from 'date-fns';
import { OauthCode, OauthToken } from '../../generated/prisma/client';
import { PrismaService } from '../../platform/db/prisma.service';

/** An authorization code issued on the owner's consent. The code itself is not in the database. */
interface NewCode {
  readonly codeHash: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly resource: string;
  readonly expiresAt: Date;
}

/** A newly issued token pair: digests only. */
interface NewTokens {
  readonly familyId: string;
  readonly clientId: string;
  readonly resource: string;
  readonly accessHash: string;
  readonly accessExpiresAt: Date;
  readonly refreshHash: string;
  readonly refreshExpiresAt: Date;
}

/** How an attempt to exchange a refresh token ended. */
type RotationOutcome =
  | { readonly kind: 'rotated'; readonly previous: OauthToken }
  /**
   * The refresh token is already rotated: it was presented a second time, and the family is
   * revoked.
   */
  | { readonly kind: 'replayed' }
  /** An unknown, revoked or expired refresh token. */
  | { readonly kind: 'refused' };

/**
 * Authorization codes and tokens issued by the App (`INV-310`): SHA-256 digests only, a single-use
 * code, and refresh token rotation in which presenting the old token again revokes the whole
 * family.
 */
@Injectable()
export class OauthTokensRepository {
  constructor(private readonly prisma: PrismaService) {}

  async issueCode(code: NewCode): Promise<void> {
    await this.prisma.oauthCode.create({ data: code });
  }

  /**
   * Redeems a code with a conditional update that exactly one call wins. A used or expired code is
   * not returned, so a second redemption of the same code is impossible even with concurrent
   * requests.
   */
  async redeemCode(codeHash: string): Promise<OauthCode | null> {
    const claimed = await this.prisma.oauthCode.updateMany({
      where: { codeHash, redeemedAt: null, expiresAt: { gt: new Date() } },
      data: { redeemedAt: new Date() },
    });

    return claimed.count === 1 ? this.prisma.oauthCode.findUnique({ where: { codeHash } }) : null;
  }

  async issueTokens(tokens: NewTokens): Promise<void> {
    await this.prisma.oauthToken.create({ data: tokens });
  }

  findByAccessHash(accessHash: string): Promise<OauthToken | null> {
    return this.prisma.oauthToken.findUnique({ where: { accessHash } });
  }

  /**
   * Rotates the refresh token: marks it as used and issues the next pair of the same family, in
   * one transaction. A refresh token that is already rotated means theft (or a client race that
   * cannot be told apart from it), so the whole family is revoked, and the client must authorize
   * again.
   */
  rotate(refreshHash: string, next: (previous: OauthToken) => NewTokens): Promise<RotationOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.oauthToken.updateMany({
        where: {
          refreshHash,
          rotatedAt: null,
          revokedAt: null,
          refreshExpiresAt: { gt: new Date() },
        },
        data: { rotatedAt: new Date() },
      });
      const row = await tx.oauthToken.findUnique({ where: { refreshHash } });

      if (!row) return { kind: 'refused' };

      if (claimed.count === 0) {
        if (row.rotatedAt === null) return { kind: 'refused' };

        await tx.oauthToken.updateMany({
          where: { familyId: row.familyId, revokedAt: null },
          data: { revokedAt: new Date() },
        });

        return { kind: 'replayed' };
      }

      await tx.oauthToken.create({ data: next(row) });

      return { kind: 'rotated', previous: row };
    });
  }

  /** Revokes the family of the token identified by either of its two digests. */
  async revokeFamilyOf(hash: string): Promise<void> {
    const row = await this.prisma.oauthToken.findFirst({
      where: { OR: [{ accessHash: hash }, { refreshHash: hash }] },
      select: { familyId: true },
    });

    if (!row) return;

    await this.prisma.oauthToken.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Prunes expired codes and the tokens that are of no further use. */
  async prune(days: number): Promise<number> {
    const cutoff = subDays(new Date(), days);
    const codes = await this.prisma.oauthCode.deleteMany({
      where: { expiresAt: { lt: subDays(new Date(), 1) } },
    });
    const tokens = await this.prisma.oauthToken.deleteMany({
      where: { OR: [{ refreshExpiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    });

    return codes.count + tokens.count;
  }
}
