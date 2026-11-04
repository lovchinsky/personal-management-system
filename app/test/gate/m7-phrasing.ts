import type { Phrase } from './m6-phrasing';

/**
 * The person's words for the scenarios of gate M7: data, not logic. Each family is a pool of
 * phrasings, and an attempt takes the variant by its own number (`variantOf` in `m6-phrasing.ts`):
 * a Skill fitted to one sentence gives itself away by failing on other phrasings of the same
 * situation.
 *
 * The phrasings do not repeat the Skill's words: the pools are written by someone who has not read
 * the Skill, and a test checks the overlaps against the plugin text. The name by which a run finds
 * what was written is quoted and includes the attempt tag, as in the page names of the world.
 */
const said =
  (template: string): Phrase =>
  (subject: string): string =>
    template.replaceAll('{subject}', subject);

/** An answer that decides nothing and says nothing new about the project: a date is clarified. */
export const ROUTINE_ANSWER: readonly Phrase[] = [
  said(
    'Так, актуальне. Редакція «{subject}» ще не відповіла, тож перевірку я переніс на понеділок.',
  ),
  said(
    'Завдання лишається. З «{subject}» домовились, що відповідь прийде на початку наступного тижня.',
  ),
  said('Актуальне, нічого не міняється, просто чекаю на «{subject}» до понеділка.'),
];

/** The person made a decision that must affect what follows. */
export const DECISION_STATED: readonly Phrase[] = [
  said(
    'Актуальне. Ми з командою вирішили: платежі в кабінеті підключаємо через «{subject}», інших провайдерів більше не розглядаємо.',
  ),
  said(
    'Рішення ухвалено — беремо «{subject}» для платежів у кабінеті. Порівнювати далі нікого не будемо.',
  ),
  said('Завдання лишай. Я визначився остаточно: платіжний провайдер для кабінету — «{subject}».'),
];

/**
 * The same decision a second time, when it is already stored: different speakers, different
 * structure.
 */
export const DECISION_RESTATED: readonly Phrase[] = [
  said('Нагадую, що з провайдером уже все вирішено: «{subject}». Завдання лишається актуальним.'),
  said('Актуальне. «{subject}» — наш провайдер платежів для кабінету, це не змінилось.'),
  said('Так. Платежі йдуть через «{subject}», як ми й домовлялись раніше.'),
];

/** The person states a fact about the client that will be needed after this conversation too. */
export const FACT_STATED: readonly Phrase[] = [
  said(
    'Актуальне. До речі, замовник «{subject}» приймає макети лише по четвергах до полудня, тож усе під це й плануй.',
  ),
  said(
    'Завдання потрібне. Важливо пам’ятати: у «{subject}» макети погоджують тільки на четвергових оглядах, до полудня.',
  ),
  said(
    'Так. Для довідки, «{subject}» дивиться макети виключно в четвер до 12:00, в інші дні там не відповідають.',
  ),
];

/**
 * The person draws a conclusion from what happened and asks not to forget it: a generalization in
 * their own words, not a candidate the system derived from episodes. A generalization says how the
 * world behaves; the choice of how the person will act next is a decision, and `DECISION_STATED`
 * contains it.
 */
export const LESSON_STATED: readonly Phrase[] = [
  said(
    'Так, чекаю. І запиши собі урок на майбутнє: юристи «{subject}» не рухають договір, поки не отримають фінальні макети.',
  ),
  said(
    'Актуальне. Висновок, який я з цього зробив: з «{subject}» договір підписується лише тоді, коли в них на руках фінальні макети.',
  ),
  said(
    'Лишай. Запам’ятай на майбутнє: «{subject}» без фінальних макетів договір не підписує, хоч скільки їм нагадуй.',
  ),
];

/** The person says what they consider acceptable for an Area of Focus. */
export const STANDARD_STATED: readonly Phrase[] = [
  said(
    'Актуальне. Після пробіжок із клубом «{subject}» мені досить двох на тиждень — більшого від себе в цій сфері не вимагаю.',
  ),
  said(
    'Так, потрібне. Якщо вдається двічі на тиждень побігати з «{subject}», зі здоров’ям усе гаразд, більше мені й не треба.',
  ),
  said('Лишай. Моя межа прийнятного проста: мінімум дві пробіжки на тиждень, як у «{subject}».'),
];
