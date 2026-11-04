import { Injectable } from '@nestjs/common';
import { SweepRule } from '../generated/prisma/enums';
import { PrismaService } from '../platform/db/prisma.service';

/** A wake the sweep has already made: the page, the rule and the hash of the basis. */
interface SweepWake {
  readonly pageId: string;
  readonly rule: SweepRule;
  readonly basisHash: string;
}

/**
 * The sweep's memory: which pages it has already woken, and on what basis
 * (`docs/2-system.md` § “Periodic safety sweep”).
 */
@Injectable()
export class SweepMarkRepository {
  constructor(private readonly prisma: PrismaService) {}

  async has(wake: SweepWake): Promise<boolean> {
    const found = await this.prisma.sweepMark.findUnique({
      where: { pageId_rule_basisHash: wake },
      select: { wokeAt: true },
    });

    return found !== null;
  }

  /** Remembers a wake. If the same one is already recorded, nothing changes. */
  async mark(wake: SweepWake): Promise<void> {
    await this.prisma.sweepMark.createMany({ data: [wake], skipDuplicates: true });
  }

  /** Returns how many wakes the sweep has made since `at`. */
  wokeSince(at: Date): Promise<number> {
    return this.prisma.sweepMark.count({ where: { wokeAt: { gte: at } } });
  }

  /**
   * Forgets wakes older than `at`. A situation arose no later than it was woken, so past the
   * recency threshold the sweep is no longer interested in it even without a mark.
   */
  async forgetBefore(at: Date): Promise<number> {
    const { count } = await this.prisma.sweepMark.deleteMany({ where: { wokeAt: { lt: at } } });

    return count;
  }
}
