import type { ReasonRequestedByPerson } from '../runs/provenance';
import type { ReviewMode } from '../runs/trigger-envelope';
import type { Gender } from './gender';
import type { Texts } from './texts';

const PLURAL = new Intl.PluralRules('uk');

/**
 * Selects the sentence for the gender in which the owner is addressed (ADR 0046). The catalog
 * writes all three forms and none is guessed; `neutral` builds the sentence with no gender forms.
 */
function inGender(gender: Gender, forms: Readonly<Record<Gender, string>>): string {
  return forms[gender];
}

/**
 * Returns the noun form for a number: `one` for 1, 21; `few` for 2–4, 22–24; `many` for 5–20,
 * 25–30.
 */
function counted(
  count: number,
  forms: { one: string; few: string; many: string; other: string },
): string {
  const form = PLURAL.select(count);

  return `${count} ${form === 'zero' || form === 'two' ? forms.other : forms[form]}`;
}

const REVIEWS: Readonly<
  Record<ReviewMode, { readonly name: string; readonly scope: string; readonly request: string }>
> = {
  daily_control: {
    name: 'Щоденний огляд',
    scope: "Зобов'язання дня, задачі, з яких можна почати, і відкриті пропозиції",
    request: 'зроби щоденний огляд',
  },
  weekly_control_review: {
    name: 'Тижневий огляд',
    scope: 'Застояні записи Inbox, очікування й ризики',
    request: 'зроби тижневий огляд',
  },
  strategic_review: {
    name: 'Стратегічний огляд',
    scope: 'Objectives, їхні Key Results і конфлікти за ресурси',
    request: 'зроби стратегічний огляд',
  },
  deep_review: {
    name: 'Глибокий огляд',
    scope: 'Identities, їхні принципи й Areas of Focus',
    request: 'зроби глибокий огляд',
  },
};

const QUARTERS = ['I', 'II', 'III', 'IV'] as const;

const WAKES: Readonly<
  Record<
    ReasonRequestedByPerson,
    {
      readonly noticed: (moment: string, gender: Gender) => string;
      readonly whyItMatters: (gender: Gender) => string;
    }
  >
> = {
  user_snooze: {
    noticed: (moment, gender) =>
      inGender(gender, {
        masculine: `Нагадування на ${moment}, про яке ти просив, не спрацювало.`,
        feminine: `Нагадування на ${moment}, про яке ти просила, не спрацювало.`,
        neutral: `Твоє нагадування на ${moment} не спрацювало.`,
      }),
    whyItMatters: () => 'У названий час справа до тебе не повернулася й лишилася без уваги.',
  },
  deadline_followup: {
    noticed: (moment) => `Перевірка дедлайну, призначена на ${moment}, не відбулася.`,
    whyItMatters: (gender) =>
      inGender(gender, {
        masculine: 'Дедлайн ставив ти, а перевірки, чи справа встигає, не було.',
        feminine: 'Дедлайн ставила ти, а перевірки, чи справа встигає, не було.',
        neutral: 'Це твій дедлайн, а перевірки, чи справа до нього встигає, не було.',
      }),
  },
};

export const uk = {
  language: 'uk',
  notices: {
    breaker: {
      noticed: (failures) =>
        `Автономні прогони зупинено: ${counted(failures, {
          one: 'провал',
          few: 'провали',
          many: 'провалів',
          other: 'провалу',
        })} поспіль.`,
      whyItMatters:
        'Схоже, зламано сам шлях прогону, і наступний теж упаде. Те, про що просиш ти, іде як ' +
        'зазвичай; автономні прогони повернуться після першого успішного.',
      reason: (text) => `Остання причина: ${text}`,
      ask: 'Глянеш, чому вони падають?',
    },
    connection: {
      noticed: (client, host) => `До Personal Management System підключився «${client}» (${host}).`,
      whyItMatters: 'Через нього можна читати стан системи й діяти від твого імені в чаті.',
      ask:
        'Якщо це був ти — нічого не роби. Якщо ні, хтось знає пароль власника: зміни його й ' +
        'відклич токени (infra/RUNBOOK.md § “App MCP and chat”).',
    },
    reviewFailure: {
      noticed: (mode, period) => `${REVIEWS[mode].name} за ${period} не відбувся.`,
      whyItMatters: (mode) => `${REVIEWS[mode].scope} лишилися без перегляду.`,
      reason: (text) => `Причина: ${text}`,
      ask: (mode) => `Якщо він потрібен, напиши мені в чаті Claude: «${REVIEWS[mode].request}».`,
      quarter: (quarter, year) => `${QUARTERS[quarter - 1] ?? String(quarter)} квартал ${year} р.`,
    },
    notionWait: {
      waiting: {
        noticed: 'Твоя відповідь дійшла, але Notion зараз недоступний.',
        whyItMatters:
          'Без нього я не бачу ні справи, ні твоєї відповіді, тож відповісти поки не можу.',
        ask: 'Нічого робити не треба: відповім, щойно Notion запрацює.',
      },
      gaveUp: {
        noticed: 'Notion був недоступний добу, і відповісти на твоє повідомлення не вдалося.',
        whyItMatters:
          'Чекати далі я не буду, тож без нового повідомлення справа лишиться без відповіді.',
        ask: 'Напиши, будь ласка, ще раз — відповіддю на це повідомлення.',
      },
    },
    wakeFailure: {
      noticed: (reason, moment, gender) => WAKES[reason].noticed(moment, gender),
      whyItMatters: (reason, gender) => WAKES[reason].whyItMatters(gender),
      ask: 'Глянь на справу в Notion, коли зможеш: сама система до неї вже не повернеться.',
    },
  },
  comments: {
    labels: {
      channelReply: (channel) => `Відповідь з ${channel}`,
      proposalDecision: 'Твоє рішення',
      proposalResult: 'Результат зміни',
    },
    fields: {
      status: 'статус',
      date: 'дата',
      deadline: 'дедлайн',
    },
    proposal: {
      approved: (change, gender) =>
        inGender(gender, {
          masculine: `Ти схвалив: ${change}.`,
          feminine: `Ти схвалила: ${change}.`,
          neutral: `Твоє рішення — схвалити: ${change}.`,
        }),
      rejected: (change, gender) =>
        inGender(gender, {
          masculine: `Ти відхилив: ${change}.`,
          feminine: `Ти відхилила: ${change}.`,
          neutral: `Твоє рішення — відхилити: ${change}.`,
        }),
      notWritten: (change, reason) => `Схвалену зміну не записано (${change}): ${reason}.`,
      reasons: {
        conflict: 'сторінка встигла змінитися після пропозиції',
        noAccess: 'у системи немає доступу до сторінки',
        unavailable: 'Notion не відповідав добу',
        other: 'Notion не прийняв запис',
      },
      cleared: 'порожньо',
      links: (count) =>
        counted(count, { one: "зв'язок", few: "зв'язки", many: "зв'язків", other: "зв'язку" }),
    },
  },
  outcomes: {
    approved: 'Схвалено — виконується',
    rejected: 'Відхилено',
    executed: 'Виконано',
    conflict: 'Не виконано: сторінка змінилася',
    failed: 'Не виконано: збій',
    expired: 'Застаріла: рішення не було до наступного огляду',
  },
  telegram: {
    openInNotion: 'Відкрити в Notion',
    moreWaiting: (count) => `Ще чекають рішення: ${count}.`,
    buttons: {
      approve: '✓ Підтвердити',
      reject: '✕ Відхилити',
      snooze: '⏱ Відкласти',
      dismiss: '— Не треба',
    },
    answers: {
      // “Approved”, not “executing”: execution is still ahead, and it may end in a conflict.
      approved: 'Схвалено',
      rejected: 'Відхилено',
      notAwaiting: 'Пропозиція вже не чекає рішення',
      expired:
        'Ця пропозиція вже застаріла. Якщо зміна ще потрібна, скажи мені про це в чаті Claude',
      dismissed: 'Гаразд',
      needsTime: 'До коли відкласти? Напиши відповіддю на це повідомлення',
      replied: 'Прийнято',
      unconsumed: 'Це не відповідь на моє повідомлення',
      notRecorded:
        'Notion зараз недоступний, тож твою відповідь не записано. Надішли її трохи пізніше',
      unreadable: 'Кнопку не вдалося прочитати',
    },
    nowhere:
      'Ці слова нікуди не ляжуть: сюди я приймаю лише відповіді на мої повідомлення про конкретну справу. Запиши це в Notion або напиши мені в чаті Claude',
  },
  consent: {
    title: 'Personal Management System — доступ до App MCP',
    heading: 'Дозволити доступ?',
    client: 'Клієнт',
    returnsTo: 'Повернеться на',
    resource: 'Ресурс',
    explanation:
      'Клієнт зможе читати стан App і діяти від твого імені в чаті: класти й закривати записи Inbox, ставити продовження, схвалювати пропозиції.',
    passphrase: 'Пароль власника',
    allow: 'Дозволити',
    deny: 'Відмовити',
    refused: 'Пароль не підійшов',
    locked: (seconds) => `Забагато невдалих спроб: спробуй знову за ${seconds} с.`,
    errorTitle: 'Personal Management System — запит відхилено',
    errorHeading: 'Запит відхилено',
  },
} as const satisfies Texts;
