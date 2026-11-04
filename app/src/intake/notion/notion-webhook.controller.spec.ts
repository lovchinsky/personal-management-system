import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BadRequestException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotionEvent } from './notion-event.schema';
import { IntakeOutcome, NotionIntake } from './notion-intake';
import { notionWebhookConfig, type NotionWebhookConfig } from './notion-webhook.config';
import { NotionWebhookController } from './notion-webhook.controller';

const TOKEN = 'secret_tGhXqMfF2y';

class FakeIntake implements Pick<NotionIntake, 'accept'> {
  readonly accepted: NotionEvent[] = [];

  accept(event: NotionEvent): Promise<IntakeOutcome> {
    this.accepted.push(event);

    return Promise.resolve({ kind: 'absorbed', windowId: 'window-1' });
  }
}

/** An intake that fails, like a database that went down in the middle of the receipt commit. */
class FailingIntake extends FakeIntake {
  override accept(): Promise<IntakeOutcome> {
    return Promise.reject(new Error('database is down'));
  }
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt-1',
    type: 'page.properties_updated',
    timestamp: new Date().toISOString(),
    entity: { id: 'page-1', type: 'page' },
    authors: [{ type: 'person', id: 'person-1' }],
    attempt_number: 1,
    subscription_id: 'sub-1',
    data: { updated_properties: ['p_task_status'] },
    ...overrides,
  };
}

async function controllerWith(
  intake: FakeIntake,
  awaiting: boolean,
  tokenPath = join(
    mkdtempSync(join(tmpdir(), 'personal-management-system-token-')),
    'verification_token',
  ),
): Promise<NotionWebhookController> {
  const webhook: NotionWebhookConfig = {
    secret: 'whsec',
    awaitingVerification: awaiting,
    verificationTokenPath: tokenPath,
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [NotionWebhookController],
    providers: [
      { provide: NotionIntake, useValue: intake },
      { provide: notionWebhookConfig.KEY, useValue: webhook },
    ],
  }).compile();

  return moduleRef.get(NotionWebhookController);
}

describe('NotionWebhookController', () => {
  let intake: FakeIntake;
  let warned: jest.SpyInstance;

  beforeEach(() => {
    intake = new FakeIntake();
    warned = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  it('an event reaches intake and the response is a success', async () => {
    const controller = await controllerWith(intake, false);

    await expect(controller.receive(event())).resolves.toEqual({ ok: true });
    expect(intake.accepted).toHaveLength(1);
    expect(intake.accepted[0]?.id).toBe('evt-1');
  });

  /**
   * The token value is written to a file on tmpfs, and only the path reaches the log
   * (`docs/2-system.md` § “Subscription verification token”). Catches a log that would keep the
   * secret itself, because there is no way to wipe a single line from it.
   */
  it('the handshake writes the token to a file, not to the log', async () => {
    const path = join(
      mkdtempSync(join(tmpdir(), 'personal-management-system-token-')),
      'verification_token',
    );
    const controller = await controllerWith(intake, true, path);

    await expect(controller.receive({ verification_token: TOKEN })).resolves.toEqual({ ok: true });

    expect(readFileSync(path, 'utf8')).toBe(TOKEN);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(warned).toHaveBeenCalledWith(expect.stringContaining(path));
    expect(warned).not.toHaveBeenCalledWith(expect.stringContaining(TOKEN));
    expect(intake.accepted).toHaveLength(0);
  });

  /**
   * Outside the provisioning window the handshake branch is dead. Catches a branch that would
   * come alive outside the window and stay open forever.
   */
  it('a handshake outside the provisioning window is not processed', async () => {
    const controller = await controllerWith(intake, false);

    await expect(controller.receive({ verification_token: TOKEN })).rejects.toThrow(
      BadRequestException,
    );
    expect(warned).not.toHaveBeenCalled();
  });

  it('an unrecognized body shape is rejected with a list of fields', async () => {
    const controller = await controllerWith(intake, false);

    await expect(controller.receive({ kind: 'something', payload: {} })).rejects.toThrow(
      /kind, payload/,
    );
  });

  /**
   * The event time is the only measured field that is written straight to a `DateTime` column.
   * An unvalidated string would yield `Invalid Date`, Prisma would reject the write, and the
   * receipt would stay `failed`. `failed` is deliberately not counted as settled, so every
   * redelivery would run into the same error, eight times in all, and the event would vanish with
   * no hint of the cause. So the event is rejected at the door, before any write.
   */
  it('an event whose time is not a date is rejected without intake', async () => {
    const controller = await controllerWith(intake, false);

    await expect(controller.receive(event({ timestamp: 'yesterday afternoon' }))).rejects.toThrow(
      BadRequestException,
    );
    expect(intake.accepted).toHaveLength(0);
  });

  it('an empty body is rejected instead of crashing', async () => {
    const controller = await controllerWith(intake, false);

    await expect(controller.receive(null)).rejects.toThrow(BadRequestException);
  });

  /**
   * The provider redelivers on a non-2xx, so the response is sent only after intake has finished:
   * an exception from intake must propagate.
   */
  it('an intake failure does not turn into a successful response', async () => {
    const controller = await controllerWith(new FailingIntake(), false);

    await expect(controller.receive(event())).rejects.toThrow('database is down');
  });
});
