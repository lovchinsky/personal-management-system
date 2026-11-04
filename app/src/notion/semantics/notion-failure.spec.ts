import { APIErrorCode, RequestTimeoutError } from '@notionhq/client';
import { notionAnswer } from '../../../test/fixtures/notion-answer.fixture';
import { BotIdentityUnknownError, NotionAccessError } from '../client/notion.error';
import { AdapterConfigurationError } from './adapter.error';
import { needsAttention, NotionFailure, notionFailureOf } from './notion-failure';

describe('the class of a Notion failure', () => {
  const cases: [string, unknown, NotionFailure][] = [
    ['a rate limit', notionAnswer(APIErrorCode.RateLimited, 429), 'transient'],
    ['a server failure', notionAnswer(APIErrorCode.InternalServerError, 500), 'transient'],
    ['an overload', notionAnswer(APIErrorCode.ServiceUnavailable, 503), 'transient'],
    // A revoked token and a page closed to the integration do not clear on their own (ADR 0044).
    ['a token Notion did not accept', notionAnswer(APIErrorCode.Unauthorized, 401), 'no_access'],
    [
      'a page closed to the integration',
      notionAnswer(APIErrorCode.RestrictedResource, 403),
      'no_access',
    ],
    ['a missing object', notionAnswer(APIErrorCode.ObjectNotFound, 404), 'absent'],
    ['an object without content', new NotionAccessError('page p-1', 'no content'), 'no_access'],
    [
      'an unusable binding',
      new AdapterConfigurationError('task', [{ slot: 'task.status', named: 'x', detail: 'gone' }]),
      'misconfigured',
    ],
    [
      'a query that Notion rejected',
      notionAnswer(APIErrorCode.ValidationError, 400),
      'misconfigured',
    ],
    ['an error in the code', new TypeError('undefined is not a function'), 'unknown'],
    // The Notion client does not wrap a network failure: `fetch` throws it as is (ADR 0045).
    ['a network failure', new TypeError('fetch failed'), 'transient'],
  ];

  it.each(cases)('%s → %s', (_name, error, failure) => {
    expect(notionFailureOf(error)).toBe(failure);
  });

  it('a client timeout is `transient`', () => {
    expect(notionFailureOf(new RequestTimeoutError())).toBe('transient');
  });

  /** A write refused because Notion did not say who we are is the same failure as its cause. */
  const unknownBot: [string, unknown, NotionFailure][] = [
    ['a rate limit', notionAnswer(APIErrorCode.RateLimited, 429), 'transient'],
    ['a network failure', new TypeError('fetch failed'), 'transient'],
    ['a token Notion did not accept', notionAnswer(APIErrorCode.Unauthorized, 401), 'no_access'],
    ['a missing object', notionAnswer(APIErrorCode.ObjectNotFound, 404), 'absent'],
  ];

  it.each(unknownBot)('the bot is unknown because of %s → %s', (_name, cause, failure) => {
    expect(notionFailureOf(new BotIdentityUnknownError({ cause }))).toBe(failure);
  });

  it('an unknown bot without a cause is classed as `unknown`', () => {
    expect(notionFailureOf(new BotIdentityUnknownError())).toBe('unknown');
  });

  it("only an unusable binding and an unknown failure need the person's attention", () => {
    const classes: NotionFailure[] = [
      'transient',
      'absent',
      'no_access',
      'misconfigured',
      'unknown',
    ];

    expect(classes.filter(needsAttention)).toEqual(['misconfigured', 'unknown']);
  });
});
