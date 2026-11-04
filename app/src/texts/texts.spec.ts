import { appConfig } from '../config/app.config';
import { isLanguage, LANGUAGES } from './language';
import { textsOf } from './texts';

/** The grammar of the catalogs: what would be a condition in code is the language's job here. */
describe('the “uk” catalog', () => {
  const { breaker, reviewFailure } = textsOf('uk').notices;

  /**
   * Ukrainian has three noun forms for whole numbers: 1 and 21 take one, 2–4 and 22 another, 5–20 a
   * third.
   */
  it.each([
    [1, '1 провал'],
    [2, '2 провали'],
    [5, '5 провалів'],
    [11, '11 провалів'],
    [21, '21 провал'],
    [22, '22 провали'],
  ])('%i is rendered as “%s поспіль”', (failures, words) => {
    expect(breaker.noticed(failures)).toBe(`Автономні прогони зупинено: ${words} поспіль.`);
  });

  it('the quarter is a Roman numeral, the year is written as `Intl` writes it', () => {
    expect(reviewFailure.quarter(4, 2026)).toBe('IV квартал 2026 р.');
  });
});

describe('the “en” catalog', () => {
  const { breaker, reviewFailure } = textsOf('en').notices;

  it.each([
    [1, '1 failure'],
    [2, '2 failures'],
    [5, '5 failures'],
  ])('%i is rendered as “%s in a row”', (failures, words) => {
    expect(breaker.noticed(failures)).toBe(`Autonomous runs have stopped: ${words} in a row.`);
  });

  it('the quarter', () => {
    expect(reviewFailure.quarter(4, 2026)).toBe('Q4 2026');
  });
});

describe("the installation's language", () => {
  const env = process.env.APP_LANGUAGE;

  afterEach(() => {
    if (env === undefined) delete process.env.APP_LANGUAGE;
    else process.env.APP_LANGUAGE = env;
  });

  it('is English without the variable', () => {
    delete process.env.APP_LANGUAGE;

    expect(appConfig().language).toBe('en');
  });

  it.each(LANGUAGES)('“%s” is the language of its catalog', (language) => {
    process.env.APP_LANGUAGE = language;

    expect(appConfig().language).toBe(language);
    expect(textsOf(appConfig().language).language).toBe(language);
  });

  /**
   * A country code instead of a language code: the environment check refuses it at startup, and
   * here it is not a language.
   */
  it('“ua” is not a catalog language', () => {
    expect(isLanguage('ua')).toBe(false);
  });
});
