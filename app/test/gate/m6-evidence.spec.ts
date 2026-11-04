import {
  acted,
  comment,
  evidence,
  idOf,
  NOTICE,
  result,
  THREAD,
  wakeUp,
  worldOf,
} from '../fixtures/m6-evidence.fixture';
import { HarnessError } from './gate-attempts';
import {
  commentsOn,
  inThread,
  noticeFrom,
  offeredProposals,
  textsOf,
  wakeOf,
  type Evidence6,
} from './m6-evidence';

const WORLD = worldOf('U1_commitment');

describe('noticeFrom', () => {
  it('parses a notification packet from the payload of a queue row', () => {
    expect(noticeFrom({ ...NOTICE, extra: 'ігнорується' })).toEqual(NOTICE);
  });

  it('treats context and the prepared part as optional parts of the packet', () => {
    expect(noticeFrom({ ...NOTICE, context: 'Контекст', prepared: 'Підготовлено' })).toEqual({
      ...NOTICE,
      context: 'Контекст',
      prepared: 'Підготовлено',
    });
  });

  /** The packet's proposals show whether a proposal can be decided from the notification. */
  it("carries the packet's proposals over: the id and the line of each", () => {
    expect(
      noticeFrom({
        ...NOTICE,
        proposals: [{ pendingActionId: 'p-1', line: 'Закрити задачу', extra: 'ігнорується' }],
      }),
    ).toEqual({ ...NOTICE, proposals: [{ pendingActionId: 'p-1', line: 'Закрити задачу' }] });
  });

  it('records no proposals when the packet has none: an empty list is not the same as no list', () => {
    expect(noticeFrom(NOTICE)).not.toHaveProperty('proposals');
    expect(noticeFrom({ ...NOTICE, proposals: [] })).toHaveProperty('proposals', []);
  });

  it('treats a proposal without an id as a conduct fault', () => {
    expect(() => noticeFrom({ ...NOTICE, proposals: [{ line: 'Закрити' }] })).toThrow(HarnessError);
  });

  /** A shape the gate cannot parse is format drift, not “the run said nothing”. */
  it('treats a payload of another shape as a conduct fault, not an empty packet', () => {
    expect(() => noticeFrom({ text: 'інша форма' })).toThrow(HarnessError);
    expect(() => noticeFrom(null)).toThrow('does not parse');
  });
});

describe("the run's text", () => {
  const given = acted(
    WORLD,
    {
      comments: [
        comment('prices', 'У нитці людини'),
        comment('prices', 'В іншій нитці', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'),
        comment('project', 'На проєкті'),
      ],
      notices: [{ ...NOTICE, context: 'Контекст' }],
    },
    result([]),
    { discussionId: THREAD },
  );

  it("commentsOn returns the run's comments on a world page, by its key", () => {
    expect(commentsOn(given, 'prices').map((item) => item.text)).toEqual([
      'У нитці людини',
      'В іншій нитці',
    ]);
    expect(commentsOn(given, 'project').map((item) => item.text)).toEqual(['На проєкті']);
  });

  it('inThread returns only the comments in the thread where the person replied', () => {
    expect(inThread(given, 'prices').map((item) => item.text)).toEqual(['У нитці людини']);
  });

  it('inThread without a reply thread is empty, because the run did not come from a reply', () => {
    expect(inThread({ ...given, discussionId: null }, 'prices')).toEqual([]);
  });

  it('compares the thread canonically: with hyphens or without', () => {
    const plain = { ...given, discussionId: THREAD.replaceAll('-', '') };

    expect(inThread(plain, 'prices')).toHaveLength(1);
  });

  it('textsOf returns everything the run wrote to the person: comments on any pages and packet text', () => {
    expect(textsOf(given)).toEqual([
      'У нитці людини',
      'В іншій нитці',
      'На проєкті',
      NOTICE.noticed,
      NOTICE.whyItMatters,
      NOTICE.ask,
      'Контекст',
    ]);
  });

  it('does not count the link of a packet as text for the person', () => {
    expect(textsOf(given)).not.toContain(NOTICE.link);
  });

  it('a run that wrote nothing said nothing', () => {
    expect(textsOf(evidence(WORLD))).toEqual([]);
  });

  it('treats a comment on a page not in the world as a scenario error, not an empty selection', () => {
    expect(() => commentsOn(given, 'absent')).toThrow('has no page absent');
  });
});

describe('wakeOf', () => {
  const WAKE = ['await_external_event', 'safety_recheck'];
  const pages = [idOf('prices'), idOf('project')];
  const given = (...continuations: ReturnType<typeof wakeUp>[]): ReturnType<typeof evidence> =>
    evidence(WORLD, { continuations });

  it('finds the first continuation of the wake class on a world page', () => {
    expect(wakeOf(given(wakeUp('prices')), pages, WAKE)?.id).toBe('check-prices');
  });

  /**
   * A continuation on a foreign page must not be woken, because the run would operate on the
   * owner's real data.
   */
  it('does not wake a continuation on a foreign page', () => {
    expect(
      wakeOf(given({ ...wakeUp('prices'), pageId: 'elsewhere-page' }), pages, WAKE),
    ).toBeUndefined();
  });

  it('does not treat other classes as wakes', () => {
    expect(
      wakeOf(given({ ...wakeUp('prices'), reasonCode: 'user_snooze' }), pages, WAKE),
    ).toBeUndefined();
  });

  it('wakes the one on a world page when a foreign and an own continuation are both present', () => {
    expect(
      wakeOf(
        given({ ...wakeUp('prices'), pageId: 'elsewhere-page', id: 'foreign' }, wakeUp('project')),
        pages,
        WAKE,
      )?.id,
    ).toBe('check-project');
  });

  it('compares the page canonically: with hyphens or without', () => {
    const dashed = '0f1e2d3c-4b5a-4968-8776-655443322110';

    expect(
      wakeOf(given({ ...wakeUp('prices'), pageId: dashed.replaceAll('-', '') }), [dashed], WAKE)
        ?.id,
    ).toBe('check-prices');
  });

  it('has nothing to wake without continuations', () => {
    expect(wakeOf(given(), pages, WAKE)).toBeUndefined();
  });
});

describe('offeredProposals', () => {
  const proposal = (id: string): Evidence6['proposals'][number] => ({
    id,
    status: 'proposed',
    effects: [],
  });
  const carried = (pendingActionId: string): { pendingActionId: string; line: string } => ({
    pendingActionId,
    line: 'Закрити задачу',
  });
  const noticesWith = (...packets: string[][]): Evidence6 => ({
    ...evidence(WORLD, { proposals: [proposal('p-1'), proposal('p-2')] }),
    written: {
      comments: [],
      notices: packets.map((ids) => ({ ...NOTICE, proposals: ids.map(carried) })),
      packetLengths: [],
    },
  });

  it('reports each proposal separately: whether a packet carries it or not', () => {
    expect(offeredProposals(noticesWith(['p-1']))).toEqual([
      { proposal: 'p-1', offered: true },
      { proposal: 'p-2', offered: false },
    ]);
  });

  it('counts proposals spread over several packets of the run', () => {
    expect(offeredProposals(noticesWith(['p-1'], ['p-2']))).toEqual([
      { proposal: 'p-1', offered: true },
      { proposal: 'p-2', offered: true },
    ]);
  });

  it('is empty without proposals', () => {
    expect(offeredProposals(evidence(WORLD))).toEqual([]);
  });

  it('offers nothing in a notification without proposals', () => {
    expect(offeredProposals(noticesWith([]))).toEqual([
      { proposal: 'p-1', offered: false },
      { proposal: 'p-2', offered: false },
    ]);
  });
});
