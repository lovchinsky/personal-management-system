import { FakeM9Port } from '../fixtures/m9-port.fixture';
import type { Check } from './m6-preflight';
import { scenariosOf, shortOf, type ScenarioInfo } from './m6-scenarios';
import { M9_CHECK_COUNT, m9Checks } from './m9-preflight';

const SELECTED: readonly ScenarioInfo[] = scenariosOf('m9');

/** Lists the observations that did not hold, which is how the verdict of a check refers to them. */
function failed(check: Check | undefined): string[] {
  const detail = check?.detail;

  if (!Array.isArray(detail)) return [];

  return detail.flatMap((observation: unknown) =>
    typeof observation === 'object' &&
    observation !== null &&
    'item' in observation &&
    typeof observation.item === 'string'
      ? [observation.item]
      : [],
  );
}

const named = (checks: readonly Check[], part: string): Check | undefined =>
  checks.find((check) => check.check.includes(part));

/**
 * Model-free checks of gate M9 on a fake App: on a sound App all of them pass, each blocks its own
 * scenarios, and an App fault that a check must catch fails that check.
 */
describe('model-free checks of gate M9', () => {
  it('on a sound App all of them pass, and there are as many as the GATE.md table has rows', async () => {
    const port = new FakeM9Port();
    const checks = await m9Checks(port, SELECTED, '1234');

    expect(checks).toHaveLength(M9_CHECK_COUNT);
    expect(checks.filter((check) => !check.ok)).toEqual([]);
  });

  it('each blocks its own scenarios; “not written” and the label block nothing', async () => {
    const checks = await m9Checks(new FakeM9Port(), SELECTED, '1234');
    const blocks = (part: string): string[] => (named(checks, part)?.blocks ?? []).map(shortOf);

    expect(blocks('app_db_gate holds no row')).toEqual(['AP1', 'AP2', 'AP3', 'AP4', 'AP5']);
    expect(blocks('approved proposal is written by the bot')).toEqual(['AP1', 'AP3']);
    expect(blocks('the person outpaced closes as conflict')).toEqual(['AP2']);
    expect(blocks('before the tick is not written')).toEqual([]);
    expect(blocks('lands in its thread')).toEqual(['AP1', 'AP2', 'AP4']);
    expect(blocks('carry the label')).toEqual([]);
  });

  it('blocks only the selected scenarios', async () => {
    const only = SELECTED.filter((info) => shortOf(info.id) === 'AP4');
    const checks = await m9Checks(new FakeM9Port(), only, '1234');

    expect(checks.map((check) => check.blocks.map(shortOf))).toEqual([
      ['AP4'],
      [],
      [],
      [],
      ['AP4'],
      [],
    ]);
  });

  it('each check with its own world cleans up after itself', async () => {
    const port = new FakeM9Port();

    await m9Checks(port, SELECTED, '1234');

    expect(port.calls.filter((call) => call === 'build')).toHaveLength(4);
    expect(port.calls.filter((call) => call === 'clean')).toHaveLength(4);
  });

  it('a foreign row that a tick would take is an isolation failure that blocks all scenarios', async () => {
    const port = new FakeM9Port();

    port.foreign = ['the pending delivery gate-m9-left'];

    const isolation = named(await m9Checks(port, SELECTED, '1234'), 'app_db_gate holds no row');

    expect(isolation).toMatchObject({ ok: false, detail: ['the pending delivery gate-m9-left'] });
    expect(isolation?.blocks).toHaveLength(SELECTED.length);
  });

  it('an executor that writes without a press fails the chain at the first tick', async () => {
    const port = new FakeM9Port();

    port.broken.executesUnapproved = true;

    const chain = named(await m9Checks(port, SELECTED, '1234'), 'written by the bot');

    expect(failed(chain)).toEqual(
      expect.arrayContaining([
        'the first executor tick leaves the proposal waiting',
        'the first tick writes nothing',
      ]),
    );
  });

  it('answering a press before the decision is recorded fails the chain (INV-023)', async () => {
    const port = new FakeM9Port();

    port.broken.answersFirst = true;

    const checks = await m9Checks(port, SELECTED, '1234');

    expect(failed(named(checks, 'written by the bot'))).toEqual([
      'the press is answered once the approval is recorded',
    ]);
    expect(failed(named(checks, 'before the tick is not written'))).toEqual([
      'the press is answered once the approval is recorded',
    ]);
  });

  it('remaining buttons of a decided proposal fail every chain check', async () => {
    const port = new FakeM9Port();

    port.broken.keepsButtons = true;

    const checks = await m9Checks(port, SELECTED, '1234');
    const gone = 'every message with the proposal is rewritten without its buttons';

    expect(failed(named(checks, 'written by the bot'))).toEqual([gone]);
    expect(failed(named(checks, 'outpaced closes as conflict'))).toEqual([gone]);
    expect(failed(named(checks, 'before the tick is not written'))).toEqual([gone]);
  });
});
