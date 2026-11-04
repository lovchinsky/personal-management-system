import { randomUUID } from 'node:crypto';
import { lostFacts, lostTimelineEntries } from '../../src/knowledge/anchor-drift';
import { checkAnchor } from '../../src/knowledge/anchor-page';
import { ANCHOR_TYPES } from '../../src/knowledge/anchor-types';
import { candidateSlugs } from '../../src/knowledge/exact-identity';
import { LINK_VERBS } from '../../src/knowledge/memory-writes';
import { isRefusal } from '../../src/memory/gbrain-client';
import { identityOf } from '../../src/memory/gbrain-identity';
import { messageOf } from '../../src/platform/error/message-of';
import type { Residue } from './gate-cleanup';
import {
  anchorPage,
  DEFAULT_WAITING,
  plantPage,
  until,
  type GbrainPage,
  type Waiting,
} from './gbrain-fixture';
import { checked, type Check } from './m6-preflight';
import type { ScenarioInfo } from './m6-scenarios';
import type { M6World } from './m6-world';
import type { M7ScenarioId } from './m7-scenarios';

/**
 * Model-free checks of M7, on a live GBrain, before the first quota. The scenarios rest on
 * assumptions about GBrain that the documentation does not show: that exact search finds an id
 * only in the page body, that an event without a page is not written, that a fact with an `entity`
 * lands in the page file, that a rough replacement of a page leaves a trace behind. Each
 * assumption is checked here, on the pages of this launch, and cleaned up together with them. A
 * change in GBrain's behavior after a version bump stops the scenarios here instead of spoiling
 * their verdict.
 *
 * A write to GBrain is slow (it computes the embedding of the page), so a check that no selected
 * scenario stands on does not run.
 */

/** The result of one probe: whether the assumption holds and what was found for it. */
interface Probed {
  readonly ok: boolean;
  readonly detail: unknown;
}

/**
 * The world whose GBrain the probe works in, and the registry by which everything planted is
 * cleaned up.
 */
interface Bench {
  readonly world: M6World;
  readonly residue: Residue;
  readonly run: string;
  readonly waiting: Waiting;
}

/** Builds the anchor page of a project with the object's id; without a slug, by convention. */
function probePage(
  run: string,
  label: string,
  id: string,
  slug?: string,
  paragraph = 'Сторінку створює перевірка gate M7.',
): GbrainPage {
  return anchorPage({
    type: 'project',
    notionId: id,
    title: `Перевірка пам'яті ${label} ${run}`,
    paragraphs: [paragraph],
    slug,
  });
}

/**
 * Plants the anchor of a new object (or a duplicate of an existing one when `id` is given) and
 * waits for search by id.
 */
async function plantedAnchor(
  { world, residue, run, waiting }: Bench,
  label: string,
  id: string = randomUUID(),
  slug?: string,
): Promise<{ slug: string; id: string }> {
  const page = probePage(run, label, id, slug);

  await plantPage(world.gbrain(), residue, { ...page, findBy: id }, waiting);

  return { slug: page.slug, id };
}

/** Places a page “by hand”, as someone outside the convention could. */
async function placedByHand(bench: Bench, slug: string, content: string): Promise<void> {
  bench.residue.gbrainPages.push(slug);

  await bench.world.gbrain().putPage(slug, content);
}

/**
 * Checks that search by id among the anchor types reports the planted anchor as an exact match and
 * that the page follows the convention.
 */
async function roundTrip(bench: Bench): Promise<Probed> {
  const gbrain = bench.world.gbrain();
  const { slug, id } = await plantedAnchor(bench, 'round trip');
  const [hits, page, identity] = await Promise.all([
    gbrain.searchHits(id, ANCHOR_TYPES),
    gbrain.getPage(slug),
    identityOf(gbrain, 'project', id),
  ]);
  const violations = page === null ? ['the page is not readable'] : checkAnchor(page);
  const exact = candidateSlugs(hits).includes(slug);

  return {
    ok: exact && violations.length === 0 && identity.state === 'exact' && identity.slug === slug,
    detail: { exact, violations, identity },
  };
}

/**
 * Checks that a page that has the id only in the frontmatter is not reported as an exact match,
 * because the exact match rests on the identity line in the anchor body. A control anchor with the
 * id in the body proves that the index is caught up, so the absence of a match is the answer of the
 * search, not its lag.
 */
async function frontmatterOnly(bench: Bench): Promise<Probed> {
  const gbrain = bench.world.gbrain();
  const id = randomUUID();
  const slug = `projects/frontmatter-only-${bench.run}`;

  await placedByHand(
    bench,
    slug,
    [
      '---',
      'type: project',
      `title: Перевірка frontmatter ${bench.run}`,
      `notion_id: ${id}`,
      '---',
      '',
      'Без id у тілі.',
      '',
    ].join('\n'),
  );

  const control = await plantedAnchor(bench, 'control');
  const [hits, controlHits] = await Promise.all([
    gbrain.searchHits(id, ANCHOR_TYPES),
    gbrain.searchHits(control.id, ANCHOR_TYPES),
  ]);
  const named = candidateSlugs(hits).includes(slug);
  const controlled = candidateSlugs(controlHits).includes(control.slug);

  return { ok: controlled && !named, detail: { named, controlled } };
}

/**
 * Checks that two pages with one id yield an `integrity_error` with the slugs of both, so neither
 * is chosen.
 */
async function twoAnchors(bench: Bench): Promise<Probed> {
  const first = await plantedAnchor(bench, 'duplicate');
  const copy = await plantedAnchor(bench, 'duplicate copy', first.id, `projects/copy-${bench.run}`);
  const identity = await identityOf(bench.world.gbrain(), 'project', first.id);

  return {
    ok:
      identity.state === 'integrity_error' &&
      identity.slugs.includes(first.slug) &&
      identity.slugs.includes(copy.slug),
    detail: identity,
  };
}

/**
 * Returns what GBrain refused a request with, or `null` when GBrain accepted it. A connection
 * failure is not a refusal: a probe that got no answer would prove nothing, so the connection
 * failure propagates as a failure.
 */
async function refusalOf(request: Promise<unknown>): Promise<string | null> {
  try {
    await request;
  } catch (error) {
    if (isRefusal(error)) return messageOf(error);

    throw error;
  }

  return null;
}

/**
 * Checks that an event for a page that does not exist is not written: a write to an anchor not read
 * in this run lands nowhere.
 */
async function timelineNeedsPage(bench: Bench): Promise<Probed> {
  const slug = `projects/missing-${bench.run}`;
  const refusal = await refusalOf(
    bench.world
      .gbrain()
      .addTimelineEntry({ slug, date: '2026-01-01', summary: 'Перевірка', source: 'gate M7' }),
  );

  if (refusal !== null) return { ok: true, detail: refusal };

  bench.residue.gbrainPages.push(slug);

  return { ok: false, detail: 'the entry for a missing page was accepted' };
}

/**
 * Checks that an event and a fact with an `entity` land in the page text, from which the database
 * can be restored, and that a rough replacement of the page without them leaves a trace: rows in
 * the database that are no longer in the text. The rows are read after the replacement, because if
 * the server dropped them together with the page there would be no drift, and the drift check in
 * `anchors:check` would see nothing.
 */
async function writesLandAndDriftShows(bench: Bench): Promise<Probed> {
  const gbrain = bench.world.gbrain();
  const { slug, id } = await plantedAnchor(bench, 'writes');
  const summary = `Перевірка події ${bench.run}`;
  const fact = `Перевірка факту ${bench.run}`;

  await gbrain.addTimelineEntry({ slug, date: '2026-01-01', summary, source: 'gate M7' });
  await gbrain.remember({ fact, provenance: 'gate M7', entity: slug, kind: 'fact' });

  const landed = await until(bench.waiting, async () => {
    const page = await gbrain.getPage(slug);

    return page !== null && page.timeline.includes(summary) && page.compiledTruth.includes(fact);
  });

  if (!landed) return { ok: false, detail: { landed } };

  // The content must differ from what was written, because GBrain does not rewrite a page with the
  // same content.
  const bareContent = probePage(
    bench.run,
    'writes',
    id,
    undefined,
    'Сторінку перезаписано без секцій.',
  ).content;

  await gbrain.putPage(slug, bareContent);

  const [bare, entries, facts] = await Promise.all([
    gbrain.getPage(slug),
    gbrain.getTimeline(slug),
    gbrain.facts(slug),
  ]);
  const lost =
    bare === null
      ? null
      : {
          entries: lostTimelineEntries(bare, entries).length,
          facts: lostFacts(bare, facts).length,
        };

  return {
    ok: lost !== null && lost.entries > 0 && lost.facts > 0,
    detail: { landed, lost },
  };
}

/**
 * Checks that GBrain accepts every declared link type and rejects an invented one, which means the
 * list in the Skill matches the server.
 */
async function linkTypes(bench: Bench): Promise<Probed> {
  const gbrain = bench.world.gbrain();
  const from = await plantedAnchor(bench, 'link');
  const to = await plantedAnchor(bench, 'linked');
  const refused = async (type: string): Promise<boolean> =>
    (await refusalOf(gbrain.addLink({ from: from.slug, to: to.slug, type }))) !== null;
  const rejected = [];

  for (const verb of LINK_VERBS) {
    if (await refused(verb)) rejected.push(verb);
  }

  const invented = await refused(`invented_${bench.run}`);

  return { ok: rejected.length === 0 && invented, detail: { rejected, inventedRefused: invented } };
}

/** Scenarios in which a run writes an event or a fact to an anchor. */
const WRITING: readonly M7ScenarioId[] = [
  'H4_decision_stated',
  'H5_decision_stored',
  'H6_fact_stated',
  'H10_standard_stated',
];

interface Probe {
  readonly check: string;
  /** Scenarios that depend on this assumption; `null` means all scenarios of the suite. */
  readonly uses: readonly M7ScenarioId[] | null;
  readonly run: (bench: Bench) => Promise<Probed>;
}

const PROBES: readonly Probe[] = [
  {
    check: 'an anchor is found by the typed search for its id and conforms to the convention',
    uses: null,
    run: roundTrip,
  },
  {
    check: 'a page with the id only in its frontmatter is not an exact match',
    uses: null,
    run: frontmatterOnly,
  },
  {
    check: 'two pages with one id resolve to an integrity error',
    uses: ['H3_two_anchors'],
    run: twoAnchors,
  },
  {
    check: 'a timeline entry for a page that does not exist is refused',
    uses: WRITING,
    run: timelineNeedsPage,
  },
  {
    check: 'an event and a fact land in the page text and a bare replace shows as drift',
    uses: WRITING,
    run: writesLandAndDriftShows,
  },
  {
    check: 'every declared link type is accepted and an invented one refused',
    uses: ['H9_structure_first'],
    run: linkTypes,
  },
];

/** Checks the assumptions about GBrain that the selected scenarios of the M7 suite rest on. */
export async function lifecycleChecks(
  world: M6World,
  selected: readonly ScenarioInfo[],
  run: string,
  waiting: Waiting = DEFAULT_WAITING,
): Promise<Check[]> {
  const checks: Check[] = [];

  for (const probe of PROBES) {
    const blocks = selected
      .map((info) => info.id)
      .filter((id) => probe.uses === null || probe.uses.some((used) => used === id));

    if (blocks.length === 0) continue;

    checks.push(
      await checked(world, probe.check, blocks, (residue) =>
        probe.run({ world, residue, run, waiting }),
      ),
    );
  }

  return checks;
}
