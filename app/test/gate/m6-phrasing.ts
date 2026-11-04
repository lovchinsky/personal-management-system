/**
 * The person's words and memory lessons for the gate M6 scenarios: data, not logic. Each family is
 * a pool of wordings, and a trial takes the variant by its number. A Skill fitted to one sentence
 * shows itself by not holding on other wordings of the same situation.
 *
 * The wordings do not repeat the Skill's words: the pools are written by someone who has not read
 * the Skill, and a test checks the matches against the plugin text. The client is named in quotes
 * and with the attempt tag, as in Task names: the search finds the equivalent Task by that name,
 * and the run's comment names the promise by it.
 */

/**
 * A phrase of the person; the parameter is the name, with an attempt tag, that the phrase mentions:
 * a client, a provider.
 */
export type Phrase = (name: string) => string;

/**
 * A memory lesson with the code word of the mockups; `who` says whose lawyers, as a noun in the
 * nominative case.
 */
type Lesson = (word: string, who: string) => readonly string[];

const phrase =
  (template: string): Phrase =>
  (client: string): string =>
    template.replaceAll('{client}', client);

const lesson =
  (...paragraphs: readonly string[]): Lesson =>
  (word: string, who: string): readonly string[] =>
    paragraphs.map((paragraph) => paragraph.replaceAll('{word}', word).replaceAll('{who}', who));

/**
 * A promise with a date: “tomorrow”. The commitment is named without the word “promise”, so a
 * keyword would not catch it.
 */
export const PROMISE_TOMORROW: readonly Phrase[] = [
  phrase(
    'Так, актуальне, але з «{client}» ми домовились, що комерційну пропозицію я надішлю завтра.',
  ),
  phrase(
    'Я сказав клієнту «{client}», що відправлю комерційну пропозицію до завтра. Сторінку цін при цьому лишаємо в роботі.',
  ),
  phrase(
    'Першою справою завтра скидаю «{client}» комерційну пропозицію. Так їм і написав. А це завдання лишай, воно потрібне.',
  ),
];

/**
 * A promise with a date for the scenario that is not read while the Skill is iterated on: other
 * speakers, other structure.
 */
export const PROMISE_TRACKED: readonly Phrase[] = [
  phrase('Актуальне. Маю до завтра вислати «{client}» КП — підтвердив їм.'),
  phrase(
    'Слухай, розкажу, як є: з «{client}» ми все обговорили, і я запевнив їх, що комерційну пропозицію вони отримають від мене на пошту завтра. Через це все інше, включно зі сторінкою цін, відходить на другий план. А завдання, звісно, актуальне, нікуди воно не подінеться.',
  ),
  phrase(
    'Повідомляю, що завдання лишається актуальним. Відповідно до погодженого з клієнтом «{client}» терміну, комерційну пропозицію мною буде надіслано не пізніше завтрашнього дня.',
  ),
];

/** A promise with no date and without the word “promise”. */
export const PROMISE_UNDATED: readonly Phrase[] = [
  phrase('Ага, потрібне, а з «{client}» ми зійшлися на тому, що комерційну пропозицію надішлю я.'),
  phrase(
    'Підтверджую, сторінка цін актуальна. Окремо: перед клієнтом «{client}» я взяв на себе надіслати комерційну пропозицію.',
  ),
  phrase('Відповів «{client}», що комерційну пропозицію вишлю. А це не закривай.'),
];

/** A promise in English: the word “promise” in only one variant of three. */
export const PROMISE_ENGLISH: readonly Phrase[] = [
  phrase(
    "Told «{client}» I'd have the commercial proposal in their inbox by tomorrow, so that comes first. The pricing page is still needed, though.",
  ),
  phrase(
    'Yes, it is still relevant. As agreed with «{client}», I am sending them the commercial proposal tomorrow.',
  ),
  phrase('Keep it open — promised «{client}» the proposal first thing tomorrow.'),
];

/** An intent, not a promise: the person deliberates, not commits. */
export const INTENT_ONLY: readonly Phrase[] = [
  phrase(
    'Так, актуальне. А «{client}», може, й справді варто скинути комерційну пропозицію? Хоча хтозна.',
  ),
  phrase(
    "Розглядаю, чи варто надсилати «{client}» комерційну пропозицію — якщо вони самі вийдуть на зв'язок, тоді, найімовірніше, так. А сторінка цін, безумовно, актуальна.",
  ),
  phrase(
    'Було б непогано скинути «{client}» комерційну пропозицію, тільки не знаю, чи вони готові.',
  ),
];

/** The promise was made by a third party, not by the person. */
export const THIRD_PARTY: readonly Phrase[] = [
  phrase('Звісно, актуальне. Оксана завтра скидає «{client}» комерційну пропозицію.'),
  phrase(
    "Керівник відділу продажів Андрій пообіцяв клієнту «{client}» надіслати комерційну пропозицію до п'ятниці. Сторінка цін, до речі, актуальна.",
  ),
  phrase('Комерційну пропозицію для «{client}» готує і відправить Богдан з продажів.'),
];

/**
 * A memory lesson is a constraint, not a tactic: “waits for the final mockups”, not “escalate
 * through the channel”. `{word}` is the code word of the mockups, `{who}` is whose lawyers, in
 * words that name the project: in F1 they are the lawyers of this Project, in F2 of another.
 */
export const LESSONS: readonly Lesson[] = [
  lesson(
    'Договір із юристами не зрушить з місця, поки {who} не отримають фінальні макети дизайну під назвою «{word}». Нагадування без макетів уже пробували, толку з них не було.',
  ),
  lesson(
    'Без фінальних дизайн-макетів «{word}» договір із юристами не рухається, бо {who} чекають саме на них.',
    'Просто нагадувати їм без цих макетів не допомагає, вже пробували.',
  ),
  lesson(
    'Якщо {who} не отримають фінальні макети дизайну «{word}», договір із ними не зрушить, а нагадування без макетів не допомагають.',
  ),
];

/**
 * Returns the pool variant for a trial: the first trial takes the first, the second the second, and
 * the pool wraps.
 */
export function variantOf<T>(pool: readonly T[], trial: number): T {
  const variant = pool[(trial - 1) % pool.length];

  if (variant === undefined) throw new Error(`the pool has no variant for trial ${trial}`);

  return variant;
}
