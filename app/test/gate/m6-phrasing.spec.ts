import {
  INTENT_ONLY,
  LESSONS,
  PROMISE_ENGLISH,
  PROMISE_TOMORROW,
  PROMISE_TRACKED,
  PROMISE_UNDATED,
  THIRD_PARTY,
  variantOf,
} from './m6-phrasing';

const CLIENT = 'Lotus-4821';

const said = (pool: readonly ((client: string) => string)[]): string[] =>
  pool.map((phrase) => phrase(CLIENT));

const ALL = {
  PROMISE_TOMORROW,
  PROMISE_TRACKED,
  PROMISE_UNDATED,
  PROMISE_ENGLISH,
  INTENT_ONLY,
  THIRD_PARTY,
};

describe('wording pools', () => {
  it.each(Object.entries(ALL))(
    '%s: three different variants, the client named once in quotes',
    (_, pool) => {
      const texts = said(pool);

      expect(texts).toHaveLength(3);
      expect(new Set(texts).size).toBe(3);

      for (const text of texts) {
        expect(text.split(`«${CLIENT}»`)).toHaveLength(2);
      }
    },
  );

  it('no Ukrainian variant of the promise uses the word “обіцяти”: the keyword fails the test', () => {
    const texts = [...said(PROMISE_TOMORROW), ...said(PROMISE_TRACKED), ...said(PROMISE_UNDATED)];

    expect(texts.filter((text) => /обіця/i.test(text))).toEqual([]);
  });

  it('the English promise uses “promise” in at most one variant', () => {
    expect(said(PROMISE_ENGLISH).filter((text) => /promis/i.test(text)).length).toBeLessThanOrEqual(
      1,
    );
  });

  it('the “tomorrow” promise speaks of tomorrow relatively, and the undated one says nothing of time', () => {
    const dated = [...said(PROMISE_TOMORROW), ...said(PROMISE_TRACKED), ...said(PROMISE_ENGLISH)];
    const undated = said(PROMISE_UNDATED);

    expect(dated.filter((text) => !/завтра|завтрашн|tomorrow/i.test(text))).toEqual([]);
    expect(
      undated.filter((text) =>
        /завтра|сьогодн|тижн|понеділ|вівтор|середа|середи|четвер|п'ятниц|субот|неділ|днів|скоро|tomorrow/i.test(
          text,
        ),
      ),
    ).toEqual([]);
  });

  it('an intent mentions no commitment: neither an agreement nor “надішлю” (I will send)', () => {
    const texts = said(INTENT_ONLY);

    expect(
      texts.filter((text) =>
        /домовил|зійшлися|надішлю|вишлю|відправлю|скину\b|пообіця/i.test(text),
      ),
    ).toEqual([]);
  });

  it('a lesson is a constraint about mockups: the code word and the party (`who`) are in every variant', () => {
    for (const lesson of LESSONS) {
      const text = lesson('Orvex-4821', 'юристи замовника').join(' ');

      expect(text).toContain('Orvex-4821');
      expect(text).toContain('юристи замовника');
      expect(text).toMatch(/макет/);
    }
  });

  it('takes the variant by number and wraps around the pool', () => {
    expect(variantOf(PROMISE_UNDATED, 1)).toBe(PROMISE_UNDATED[0]);
    expect(variantOf(PROMISE_UNDATED, 5)).toBe(PROMISE_UNDATED[1]);
    expect(() => variantOf([], 1)).toThrow('has no variant');
  });
});
