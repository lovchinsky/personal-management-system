import type { SearchHit } from '../../src/knowledge/gbrain-pages';
import { FakeGbrain } from '../fixtures/fake-gbrain.fixture';
import { worldThat } from '../fixtures/m6-probe-world.fixture';
import type { Waiting } from './gbrain-fixture';
import type { Check } from './m6-preflight';
import { scenariosOf, shortOf } from './m6-scenarios';
import { lifecycleChecks } from './m7-preflight';

const M7_SCENARIOS = scenariosOf('m7');

/** No pauses: a fake GBrain has nothing to wait for, and a refusal must not cost twenty seconds. */
const QUICK: Waiting = { attempts: 2, pauseMs: 0, sleep: () => Promise.resolve() };

const NAMES = [
  'an anchor is found by the typed search for its id and conforms to the convention',
  'a page with the id only in its frontmatter is not an exact match',
  'two pages with one id resolve to an integrity error',
  'a timeline entry for a page that does not exist is refused',
  'an event and a fact land in the page text and a bare replace shows as drift',
  'every declared link type is accepted and an invented one refused',
];

async function checksWith(
  gbrain: FakeGbrain,
  left: readonly string[] = [],
): Promise<Record<string, Check>> {
  const world = await worldThat({ gbrain, left });
  const checks = await lifecycleChecks(world, M7_SCENARIOS, '4821', QUICK);

  return Object.fromEntries(checks.map((check) => [check.check, check]));
}

const okOf = (checks: Record<string, Check>): [string, boolean][] =>
  NAMES.map((name) => [name, checks[name]?.ok ?? false]);

describe('M7 memory checks before the first quota', () => {
  it('a GBrain that behaves as designed passes all the checks', async () => {
    const checks = await checksWith(new FakeGbrain());

    expect(okOf(checks)).toEqual(NAMES.map((name) => [name, true]));
  });

  it('each check blocks only the scenarios that depend on it and does not run without them', async () => {
    const checks = await checksWith(new FakeGbrain());
    const short = (name: string): string[] =>
      (checks[name]?.blocks ?? []).map((id) => shortOf(id)).sort();

    expect(short(NAMES[0] ?? '')).toHaveLength(M7_SCENARIOS.length);
    expect(short(NAMES[2] ?? '')).toEqual(['H3']);
    expect(short(NAMES[3] ?? '')).toEqual(['H10', 'H4', 'H5', 'H6']);
    expect(short(NAMES[5] ?? '')).toEqual(['H9']);

    const world = await worldThat({ gbrain: new FakeGbrain() });
    const only = M7_SCENARIOS.filter((info) => shortOf(info.id) === 'H1');
    const ran = await lifecycleChecks(world, only, '4821', QUICK);

    expect(ran.map((check) => check.check)).toEqual([NAMES[0], NAMES[1]]);
  });

  it('a search that finds the id in the frontmatter too breaks the exact-match check and no other', async () => {
    class ByFrontmatter extends FakeGbrain {
      override searchHits(text: string, types: readonly string[]): Promise<SearchHit[]> {
        return Promise.resolve(
          [...this.pages.values()]
            .filter(
              (page) =>
                types.includes(page.type) &&
                (page.compiledTruth.includes(text) ||
                  JSON.stringify(page.frontmatter).includes(text)),
            )
            .map((page) => ({
              slug: page.slug,
              title: page.title,
              type: page.type,
              evidence: 'keyword_exact',
            })),
        );
      }
    }

    const checks = await checksWith(new ByFrontmatter());

    expect(okOf(checks).filter(([, ok]) => !ok)).toEqual([
      ['a page with the id only in its frontmatter is not an exact match', false],
    ]);
  });

  it('a GBrain that accepts an event for a page that does not exist breaks its own check', async () => {
    class Accepting extends FakeGbrain {
      override addTimelineEntry(): Promise<void> {
        return Promise.resolve();
      }
    }

    const checks = await checksWith(new Accepting());
    const failed = okOf(checks).filter(([, ok]) => !ok);

    expect(failed.map(([name]) => name)).toContain(
      'a timeline entry for a page that does not exist is refused',
    );
  });

  it('a connection failure is not mistaken for a GBrain refusal: the checks do not count the assumption as proven', async () => {
    class Unreachable extends FakeGbrain {
      override addTimelineEntry(): Promise<void> {
        return Promise.reject(new Error('gbrain add_timeline_entry: connect ECONNREFUSED'));
      }

      override addLink(): Promise<void> {
        return Promise.reject(new Error('gbrain add_link: connect ECONNREFUSED'));
      }
    }

    const checks = await checksWith(new Unreachable());

    expect(checks[NAMES[3] ?? '']).toMatchObject({
      ok: false,
      detail: expect.stringContaining('ECONNREFUSED'),
    });
    expect(checks[NAMES[5] ?? '']?.ok).toBe(false);
  });

  it('a page replacement that leaves no trace in the database does not show as drift', async () => {
    class Forgetting extends FakeGbrain {
      override putPage(slug: string, content: string): Promise<void> {
        this.timelines.delete(slug);
        this.factsBy.delete(slug);

        return super.putPage(slug, content);
      }
    }

    const checks = await checksWith(new Forgetting());

    expect(checks[NAMES[4] ?? '']?.ok).toBe(false);
  });

  it('a GBrain that does not rewrite a page with the same content does not hide drift from the probe: the probe changes the content', async () => {
    const checks = await checksWith(new FakeGbrain());

    expect(checks[NAMES[4] ?? '']).toMatchObject({
      ok: true,
      detail: { lost: { entries: 1, facts: 1 } },
    });
  });

  it('a GBrain that accepts an invented link type breaks its own check', async () => {
    class Lenient extends FakeGbrain {
      override addLink(): Promise<void> {
        return Promise.resolve();
      }
    }

    const checks = await checksWith(new Lenient());

    expect(checks[NAMES[5] ?? '']?.ok).toBe(false);
  });

  it('a search that returns only one match does not see the duplicate: no integrity error is found', async () => {
    class Single extends FakeGbrain {
      override async searchHits(text: string, types: readonly string[]): Promise<SearchHit[]> {
        return (await super.searchHits(text, types)).slice(0, 1);
      }
    }

    const checks = await checksWith(new Single());

    expect(checks[NAMES[2] ?? '']?.ok).toBe(false);
  });

  it('a GBrain failure is a check result, not an exception; the remaining checks continue', async () => {
    class Down extends FakeGbrain {
      override putPage(): Promise<void> {
        return Promise.reject(new Error('gbrain put_page: 502'));
      }
    }

    const checks = await checksWith(new Down());

    expect(checks[NAMES[0] ?? '']).toMatchObject({ ok: false, detail: 'gbrain put_page: 502' });
    expect(Object.keys(checks)).toEqual(NAMES);
  });

  it('what the cleanup did not remove is a check failure, with what remained', async () => {
    const checks = await checksWith(new FakeGbrain(), ['projects/left-behind']);

    expect(checks[NAMES[0] ?? '']).toMatchObject({
      ok: false,
      detail: { left: ['projects/left-behind'] },
    });
  });
});
