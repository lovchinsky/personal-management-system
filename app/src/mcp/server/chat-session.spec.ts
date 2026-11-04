import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { unreached } from '../../../test/fixtures/test-module';
import { ApprovalsService } from '../../approvals/approvals.service';
import { AttentionService } from '../../attention/attention.service';
import { CaptureService } from '../../capture/capture.service';
import { CaptureStep } from '../../capture/conversion';
import { inboxClosureSchema } from '../../capture/inbox-closure.schema';
import { inboxParkingSchema } from '../../capture/inbox-parking.schema';
import { appConfig, type AppConfig } from '../../config/app.config';
import { ContinuationsService } from '../../continuations/continuations.service';
import { DeliveryService } from '../../delivery/delivery.service';
import { RunWrites } from '../../effects/run-writes';
import { MemoryService } from '../../memory/memory.service';
import { SchemaMappingReader } from '../../notion/semantics/schema-mapping.reader';
import { InvalidRequestError } from '../../platform/request/invalid-request';
import { Actor, CHAT } from '../../runs/actor';
import { AppMcp } from './app-mcp';
import { assistantConfig, type AssistantConfig } from './assistant.config';
import { ChatSessions } from './chat-sessions';

const APP: AppConfig = {
  port: 3000,
  timeZone: 'Europe/Kyiv',
  language: 'uk',
  ownerGender: 'neutral',
};

/** An assistant with no name, as in an installation where the setting is not configured. */
const NAMELESS: AssistantConfig = { name: null, gender: 'neutral' };

const PARKED = '7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b';
const ITEM = '1f2e3d4c-5b6a-4978-8a9b-0c1d2e3f4a5b';
const PROPOSAL = '9b2d5c1e-3f4a-4b6c-8d7e-1a2b3c4d5e6f';

/** What the capabilities received from the chat, in call order. */
interface Call {
  readonly capability: string;
  readonly actor?: Actor;
  readonly what: string;
}

/**
 * Capabilities that only record who called them and with what: a chat must neither stage writes
 * nor replace the actor.
 */
class World {
  readonly calls: Call[] = [];

  constructor(private readonly assistant: AssistantConfig = NAMELESS) {}

  /** The chat only asks delivery when a message would arrive; that is part of `runtime_read`. */
  readonly delivery: Pick<DeliveryService, 'window'> = {
    window: () => ({ quiet_hours_exempt: true }),
  };

  readonly capture: Pick<
    CaptureService,
    'check' | 'convert' | 'checkPark' | 'park' | 'checkClose' | 'close'
  > = {
    check: () => Promise.reject(new Error('conversion was not expected')),
    convert: () => Promise.reject(new Error('conversion was not expected')),
    checkPark: (actor, request) => {
      this.calls.push({ capability: 'checkPark', actor, what: request.title });

      return Promise.resolve(inboxParkingSchema.parse(request));
    },
    park: (actor, parking, done) => {
      this.calls.push({ capability: 'park', actor, what: parking.title });

      const step: CaptureStep = { step: 'item_parked', pageId: PARKED };

      done(step);

      return Promise.resolve(PARKED);
    },
    checkClose: (actor, request) => {
      this.calls.push({ capability: 'checkClose', actor, what: request.reason });

      return Promise.resolve(inboxClosureSchema.parse(request));
    },
    close: (closure) => {
      this.calls.push({ capability: 'close', what: closure.reason });

      return Promise.resolve(closure.inboxPageId);
    },
  };

  readonly approvals: Pick<
    ApprovalsService,
    'check' | 'record' | 'awaitsDecision' | 'openLike' | 'state' | 'listOpen' | 'decide'
  > = {
    check: () => Promise.reject(new Error('a chat does not propose')),
    record: () => Promise.reject(new Error('a chat does not propose')),
    awaitsDecision: () => Promise.resolve(false),
    openLike: () => Promise.resolve(null),
    state: (id) => Promise.resolve({ pending_action_id: id, found: false }),
    listOpen: () => Promise.resolve({ proposals: [] }),
    decide: (actor, id, decision) => {
      this.calls.push({ capability: 'decide', actor, what: `${decision} ${id}` });

      if (id === 'stale') {
        return Promise.resolve({ pending_action_id: id, decision, accepted: false });
      }

      return Promise.resolve({ pending_action_id: id, decision, accepted: true });
    },
  };

  /** Reaches a chat: an MCP client over a chat session. */
  async chat(): Promise<{ client: Client; names: string[] }> {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AppMcp,
        ChatSessions,
        RunWrites,
        { provide: CaptureService, useValue: this.capture },
        { provide: ApprovalsService, useValue: this.approvals },
        unreached(AttentionService),
        unreached(ContinuationsService),
        { provide: DeliveryService, useValue: this.delivery },
        unreached(MemoryService),
        unreached(SchemaMappingReader),
        { provide: appConfig.KEY, useValue: APP },
        { provide: assistantConfig.KEY, useValue: this.assistant },
      ],
    }).compile();
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'chat-spec', version: '1.0.0' });

    await moduleRef.get(AppMcp).serverFor(moduleRef.get(ChatSessions).open()).connect(serverSide);
    await client.connect(clientSide);

    const { tools } = await client.listTools();

    return { client, names: tools.map((tool) => tool.name) };
  }
}

/** Calls a tool and returns its response: its JSON or the text of a refusal. */
async function answerOf(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ readonly text: string; readonly isError: boolean }> {
  const result = await client.callTool({ name, arguments: args });
  const [block] = Array.isArray(result.content) ? result.content : [];
  const text = block && 'text' in block && typeof block.text === 'string' ? block.text : '';

  return { text, isError: result.isError === true };
}

describe('chat session in the App MCP', () => {
  it("shows the `chat_toolset` tools and does not show the system's voice (`add_comment`) or proposals (`create_pending_action`)", async () => {
    const { client, names } = await new World().chat();

    try {
      expect(names).toEqual(
        expect.arrayContaining([
          'park_inbox_item',
          'close_inbox_item',
          'convert_inbox_item',
          'decide_pending_action',
          'list_pending_actions',
        ]),
      );
      expect(names).not.toContain('add_comment');
      expect(names).not.toContain('create_pending_action');
    } finally {
      await client.close();
    }
  });

  /**
   * A chat has no run result, so the write is applied on the call and the model is told about it.
   */
  it('applies parking an Inbox item at once and says so', async () => {
    const world = new World();
    const { client } = await world.chat();

    try {
      const answer = await answerOf(client, 'park_inbox_item', {
        title: 'Василь / контракт',
        comment: 'Не зрозуміло, чи це задача',
      });

      expect(answer.isError).toBe(false);
      expect(JSON.parse(answer.text)).toEqual({ applied: true, inbox_page_id: PARKED });
      expect(world.calls).toEqual([
        { capability: 'checkPark', actor: CHAT, what: 'Василь / контракт' },
        { capability: 'park', actor: CHAT, what: 'Василь / контракт' },
      ]);
    } finally {
      await client.close();
    }
  });

  it('checks closing an Inbox item on behalf of the person, then applies it', async () => {
    const world = new World();
    const { client } = await world.chat();

    try {
      const answer = await answerOf(client, 'close_inbox_item', {
        inbox_page_id: ITEM,
        reason: 'trash',
        comment: 'Не дія',
      });

      expect(JSON.parse(answer.text)).toEqual({
        applied: true,
        inbox_page_id: ITEM,
        reason: 'trash',
      });
      expect(world.calls.map((call) => call.capability)).toEqual(['checkClose', 'close']);
      expect(world.calls[0].actor).toEqual(CHAT);
    } finally {
      await client.close();
    }
  });

  it('returns a capability refusal as text and applies nothing', async () => {
    const world = new World();

    world.capture.checkPark = () =>
      Promise.reject(new InvalidRequestError('Inbox parking: the Inbox has no carrier for text'));

    const { client } = await world.chat();

    try {
      const answer = await answerOf(client, 'park_inbox_item', {
        title: 'x',
        comment: 'y',
      });

      expect(answer).toEqual({
        isError: true,
        text: 'Inbox parking: the Inbox has no carrier for text',
      });
      expect(world.calls).toEqual([]);
    } finally {
      await client.close();
    }
  });

  it('sends the decision on a proposal on behalf of the person in the chat', async () => {
    const world = new World();
    const { client } = await world.chat();

    try {
      const accepted = await answerOf(client, 'decide_pending_action', {
        pending_action_id: PROPOSAL,
        decision: 'approve',
      });
      const stale = await answerOf(client, 'decide_pending_action', {
        pending_action_id: 'stale',
        decision: 'reject',
      });

      expect(JSON.parse(accepted.text)).toEqual({
        pending_action_id: PROPOSAL,
        decision: 'approve',
        accepted: true,
      });
      expect(JSON.parse(stale.text)).toMatchObject({ accepted: false });
      expect(world.calls).toEqual([
        { capability: 'decide', actor: CHAT, what: `approve ${PROPOSAL}` },
        { capability: 'decide', actor: CHAT, what: 'reject stale' },
      ]);
    } finally {
      await client.close();
    }
  });

  it('refuses an unknown decision and an extra field at the schema, before any capability is called', async () => {
    const world = new World();
    const { client } = await world.chat();

    try {
      const unknown = await answerOf(client, 'decide_pending_action', {
        pending_action_id: PROPOSAL,
        decision: 'postpone',
      });
      const extra = await answerOf(client, 'decide_pending_action', {
        pending_action_id: PROPOSAL,
        decision: 'approve',
        note: 'x',
      });

      expect(unknown.isError).toBe(true);
      expect(extra.isError).toBe(true);
      expect(world.calls).toEqual([]);
    } finally {
      await client.close();
    }
  });

  /**
   * The assistant's name and gender are a setting separate from the owner's gender (ADR 0049,
   * ADR 0046): each goes in its own field, and the assistant's gender is not replaced by the
   * owner's.
   */
  it("`runtime_read` returns the assistant's name and gender separately from the owner's gender", async () => {
    const { client } = await new World({ name: 'Алекс', gender: 'feminine' }).chat();

    try {
      const { text, isError } = await answerOf(client, 'get_runtime_state', {});

      expect(isError).toBe(false);
      expect(JSON.parse(text)).toMatchObject({
        person_gender: APP.ownerGender,
        assistant_name: 'Алекс',
        assistant_gender: 'feminine',
      });
    } finally {
      await client.close();
    }
  });
});
