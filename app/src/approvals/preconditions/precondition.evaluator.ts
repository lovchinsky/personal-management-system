import { Injectable, Logger } from '@nestjs/common';
import { Page, PageProperty } from '../../notion/client/page';
import { PageReader } from '../../notion/client/page.reader';
import { isEmpty, optionIdOf } from '../../notion/client/property-facts';
import { AdapterConfigurationError } from '../../notion/semantics/adapter.error';
import { readsAs } from '../../notion/semantics/canonical-write';
import { notionFailureOf } from '../../notion/semantics/notion-failure';
import { SemanticAdapter } from '../../notion/semantics/semantic.adapter';
import { UnwritableValueError } from '../../notion/semantics/unwritable-value.error';
import { messageOf } from '../../platform/error/message-of';
import { Precondition } from './precondition';

/**
 * How the check of the preconditions ended. Each answer leads to a different fate for the approval
 * (`docs/2-system.md` § “Preconditions and executor”):
 *
 * - `holds` means execute;
 * - `broken` means the state changed between the proposal and the approval, and the action is no
 *   longer the one shown to the person (`INV-027`: the model composes a new one);
 * - `undecidable` means the question has no answer in this form: an authoring defect of the
 *   proposal, not of the state;
 * - `degraded` means the state could not be inspected; the person's decision stands, and
 *   `unreachable` says whether the failure will clear on its own (ADR 0044).
 */
export type FailedVerdict =
  | {
      readonly outcome: 'broken' | 'undecidable';
      readonly failed: Precondition;
      readonly detail: string;
    }
  | {
      readonly outcome: 'degraded';
      readonly failed: Precondition;
      readonly detail: string;
      readonly unreachable: Unreachable;
    };

/**
 * Why the inspection failed: Notion is temporarily unresponsive, which clears on its own; the
 * integration lacks access, which does not clear on its own.
 */
export type Unreachable = 'transient' | 'no_access';

/** A page that was read (`null`: it does not exist) or the reason it could not be read. */
type PageRead =
  | { readonly known: true; readonly value: Page | null }
  | { readonly known: false; readonly why: string; readonly unreachable: Unreachable };

/**
 * The preconditions hold, and the page the write goes to is the page as it was just checked. The
 * write is encoded on this same state, not on one read a second time.
 */
export type Verdict = { readonly outcome: 'holds'; readonly subject: Page } | FailedVerdict;

/** One precondition: holds on the page that was checked, or why it does not. */
type Held = { readonly outcome: 'holds'; readonly page: Page };

type Checked = Held | FailedVerdict;

/** A precondition about a property of the page. */
type PropertyPrecondition = Extract<Precondition, { readonly propertyId: unknown }>;

/**
 * Checks whether the action makes sense **currently**, that is, when it is proposed and again
 * before execution.
 *
 * The state is reread from Notion, not taken from the proposal: the proposal could have sat for an
 * hour, and in that time the person could have done the same thing by hand, or something else that
 * made the action stop being correct. At the time of the proposal the same check stops a proposal
 * that was false from the start from reaching the person.
 *
 * The same check keeps the domain effect once-only. An executor that wrote and crashed before it
 * could mark the row will see on the second attempt that the precondition tied to the effect no
 * longer holds, and will return `conflict` instead of a second write.
 */
@Injectable()
export class PreconditionEvaluator {
  private readonly logger = new Logger(PreconditionEvaluator.name);

  constructor(
    private readonly pages: PageReader,
    private readonly semantics: SemanticAdapter,
  ) {}

  async evaluate(subject: string, preconditions: readonly Precondition[]): Promise<Verdict> {
    // The page is read once for all preconditions about it: a separate request per precondition
    // would mean extra calls and the possibility of seeing two different states.
    const pages = new Map<string, PageRead>();
    // Writing to a page presupposes that it exists and is not in the trash. This precondition is
    // implicit in every proposal, so it is checked first and yields the page for the write.
    const written = await this.check({ kind: 'page_exists', pageId: subject }, pages);
    if (written.outcome !== 'holds') {
      return written;
    }

    for (const precondition of preconditions) {
      const verdict = await this.check(precondition, pages);
      if (verdict.outcome !== 'holds') {
        return verdict;
      }
    }

    return { outcome: 'holds', subject: written.page };
  }

  private async check(precondition: Precondition, pages: Map<string, PageRead>): Promise<Checked> {
    const page = await this.pageOf(precondition.pageId, pages);
    if (!page.known) {
      return this.degraded(precondition, page.why, page.unreachable);
    }
    if (!page.value) {
      return this.broken(precondition, 'page no longer exists');
    }
    // A page in the trash can still be read but accepts no writes, and for the domain it no longer
    // exists: an action about it is no longer the one that was shown.
    if (page.value.inTrash) return this.broken(precondition, 'page is in the trash');

    const holds: Held = { outcome: 'holds', page: page.value };

    switch (precondition.kind) {
      case 'page_exists':
        return holds;

      // This precondition guards against **someone else's later** edit, and only against that: it
      // does not see the system's own write in the same minute — see `observes()`.
      case 'unchanged_since':
        return page.value.last_edited_time === precondition.lastEditedTime
          ? holds
          : this.broken(
              precondition,
              `page changed at ${page.value.last_edited_time}, ` +
                `expected ${precondition.lastEditedTime}`,
            );

      case 'property_equals':
      case 'property_empty':
      case 'property_reads_as': {
        // Both sides are canonical: the page is translated when it is read, the precondition when
        // the proposal comes in.
        const property = page.value.properties.get(precondition.propertyId);
        if (!property) {
          return this.broken(precondition, 'property is absent from the page');
        }

        return this.onProperty(precondition, property, holds);
      }
    }
  }

  /**
   * Returns the page, or an honest answer about why it is not there.
   *
   * The reasons for “no page” differ in substance, and confusing them is costly. An object that
   * is gone is a change of state that made the action stop being correct. A lack of access, a
   * rate limit, a server failure or a timeout say nothing about the domain: as `conflict` they
   * would declare a change of state where there is none, and the person's approval would be
   * spent. The failure class says whether the failure clears on its own (ADR 0044).
   *
   * The remaining errors propagate: reporting “could not inspect” for a rejected request or a code
   * defect would turn a breakage into a repeating silence.
   */
  private async pageOf(pageId: string, pages: Map<string, PageRead>): Promise<PageRead> {
    const seen = pages.get(pageId);
    if (seen) {
      return seen;
    }

    const observed = await this.read(pageId);

    pages.set(pageId, observed);

    return observed;
  }

  private async read(pageId: string): Promise<PageRead> {
    try {
      return { known: true, value: await this.pages.page(pageId) };
    } catch (error) {
      const failure = notionFailureOf(error);

      switch (failure) {
        case 'absent':
          return { known: true, value: null };

        case 'transient':
        case 'no_access':
          return { known: false, why: messageOf(error), unreachable: failure };

        case 'misconfigured':
        case 'unknown':
          throw error;
      }
    }
  }

  /**
   * Evaluates a precondition about a property that is on the page. A question to which this form
   * of property has no answer is `undecidable`: an authoring defect, not a defect of state.
   */
  private onProperty(
    precondition: PropertyPrecondition,
    property: PageProperty,
    holds: Held,
  ): Checked {
    switch (precondition.kind) {
      case 'property_equals': {
        const option = optionIdOf(property);
        if (!option.known) {
          return this.undecidable(precondition, option.why);
        }

        return option.value === precondition.optionId
          ? holds
          : this.broken(precondition, `property holds ${option.value ?? 'nothing'}`);
      }

      case 'property_reads_as':
        return this.reads(precondition, holds);

      case 'property_empty': {
        const emptiness = isEmpty(property);
        if (!emptiness.known) {
          return this.undecidable(precondition, emptiness.why);
        }

        return emptiness.value ? holds : this.broken(precondition, 'property is not empty');
      }
    }
  }

  /**
   * Checks that a property reads as named, using the adapter's reading and a comparison by
   * content (`readsAs`). What is compared is a state, not the system's own write, so a date's time
   * zone is not a difference. A property that has no canonical field, or a binding that has
   * diverged from the workspace, has no answer: an authoring or configuration defect, not a defect
   * of state, and a retry would change nothing.
   */
  private reads(
    precondition: Extract<Precondition, { readonly kind: 'property_reads_as' }>,
    holds: Held,
  ): Checked {
    try {
      const reading = this.semantics.readBack(holds.page, precondition.propertyId);

      return readsAs(precondition.value, reading)
        ? holds
        : this.broken(precondition, `property reads as ${reading.state}, not as named`);
    } catch (error) {
      if (error instanceof UnwritableValueError || error instanceof AdapterConfigurationError) {
        return this.undecidable(precondition, error.message);
      }

      throw error;
    }
  }

  private broken(failed: Precondition, detail: string): FailedVerdict {
    return this.logged({ outcome: 'broken', failed, detail });
  }

  private undecidable(failed: Precondition, detail: string): FailedVerdict {
    return this.logged({ outcome: 'undecidable', failed, detail });
  }

  private degraded(failed: Precondition, detail: string, unreachable: Unreachable): FailedVerdict {
    return this.logged({ outcome: 'degraded', failed, detail, unreachable });
  }

  private logged(verdict: FailedVerdict): FailedVerdict {
    this.logger.log(`precondition ${verdict.failed.kind} ${verdict.outcome}: ${verdict.detail}`);

    return verdict;
  }
}
