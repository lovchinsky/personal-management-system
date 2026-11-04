import { isAbsolute, relative, resolve } from 'node:path';
import { fromUnixTime } from 'date-fns';
import { z } from 'zod';
import { McpServerName } from '../../generated/prisma/enums';
import { ToolCall } from '../../runs/run-outcome';
import { HARNESS_TOOLS, ToolName, toolNameOf } from '../perimeter';
import { Reads } from '../result/evidence';
import type { GbrainCall } from './run-tap';
import {
  assistantMessageSchema,
  InitMessage,
  initMessageSchema,
  messageEnvelopeSchema,
  rateLimitEventSchema,
  refusalFallbackSchema,
  ResultMessage,
  resultMessageSchema,
  userMessageSchema,
} from './stream';

/** The wrapper in which the CLI hands the model a tool error: in the log it only takes up space. */
const TOOL_ERROR = /^<tool_use_error>([\s\S]*)<\/tool_use_error>$/;

/** Strips the CLI wrapper from a tool error's text; a text without a wrapper stays as it is. */
function unwrapped(text: string): string {
  return TOOL_ERROR.exec(text.trim())?.[1]?.trim() ?? text;
}

/** The plan quota a run hit (ADR 0012): why, and when it resets, if known. */
interface Quota {
  readonly reason: string;
  readonly resetsAt?: Date;
}

/**
 * A GBrain call awaiting a response: its arguments and its place among GBrain calls, in issue
 * order.
 */
interface IssuedGbrainCall {
  readonly position: number;
  readonly input: Readonly<Record<string, unknown>>;
}

/** A GBrain call that ended with a response, with its place in issue order. */
interface OrderedGbrainCall {
  readonly position: number;
  readonly call: GbrainCall;
}

/** A model substitution the CLI made without the run's knowledge (`INV-032`). */
interface ModelFallback {
  readonly from: string;
  readonly to: string;
}

/**
 * What the runner saw in a run's stream, as facts. The classifier decides what they mean for the
 * outcome, with its own texts and its own order.
 */
export interface ObservedStream {
  readonly init?: InitMessage;
  readonly initProblems: readonly string[];
  readonly fellBack?: ModelFallback;
  readonly toolCalls: readonly ToolCall[];
  /**
   * Successful reads outside the plugin directory; each means the perimeter did not hold
   * (`INV-311`).
   */
  readonly breaches: readonly string[];
  readonly reads: Reads;
  /**
   * `Read` calls in order: the path relative to the plugin directory, a rejected one with the
   * suffix ` [failed]`.
   */
  readonly skillReads: readonly string[];
  /**
   * GBrain tool calls that ended with a response, in the order the model issued them, not the
   * order the responses arrived, because calls of one turn run in parallel and the order of reads
   * and writes depends on what the model decided, not on GBrain's speed. The arguments are the ones
   * the model passed.
   */
  readonly gbrainCalls: readonly GbrainCall[];
  /**
   * What the CLI answered the model when it rejected the model's result by the schema: which path
   * and rule failed, without the CLI wrapper and without truncation. This is the text of a schema
   * error, not a call payload, so it has no page content (`GAP-07` on payloads); the runner
   * writes it to the log. The run trace keeps only the last reason, when running out of attempts
   * fails the run (`run_traces.reason`).
   */
  readonly rejections: readonly string[];
  readonly quota?: Quota;
  readonly result?: ResultMessage;
}

/**
 * Watches the stream of one run and collects the init snapshot, tool calls, what was read,
 * evidence of the plan quota and the result message.
 *
 * The observer also stops the run before it spends more than it needs to. It stops on an init that
 * cannot be trusted, before the first request to the model; on a plan quota or overage, at once;
 * on a fallback to another model, likewise (`INV-032`); and on a successful read of a file outside
 * the plugin directory, whatever permission rule the CLI granted.
 */
export class RunObserver {
  private init?: InitMessage;
  private problems: readonly string[] = [];
  private fellBack?: ModelFallback;
  private quota?: Quota;
  private result?: ResultMessage;
  private readonly calls: ToolCall[] = [];
  private readonly pending = new Map<string, ToolName>();
  /** The paths of `Read` calls awaiting a response, by call id. */
  private readonly readPaths = new Map<string, string>();
  /** The arguments of GBrain calls awaiting a response, and their issue order, by call id. */
  private readonly gbrainIssued = new Map<string, IssuedGbrainCall>();
  private gbrainIssuedCount = 0;
  /** GBrain calls that ended with a response; in the model's issue order, not that of arrival. */
  private readonly gbrainCalls: OrderedGbrainCall[] = [];
  private readonly breaches: string[] = [];
  private readonly skillReads: string[] = [];
  private readonly reads = new Map<McpServerName, string[]>();
  private readonly rejections: string[] = [];
  private halted = false;

  constructor(
    private readonly judge: (init: InitMessage) => string[],
    private readonly stop: (reason: string) => void,
    private readonly pluginDir: string,
  ) {}

  /** Sends a stream message to the handler of its kind and skips unknown kinds. */
  see(message: unknown): void {
    const envelope = messageEnvelopeSchema.safeParse(message);
    if (!envelope.success) {
      return;
    }

    switch (envelope.data.type) {
      case 'system':
        if (envelope.data.subtype === 'init') this.onInit(message);
        if (envelope.data.subtype === 'model_refusal_fallback') this.onFallback(message);

        return;

      case 'assistant':
        return this.onAssistant(message);

      case 'user':
        return this.onUser(message);

      case 'rate_limit_event':
        return this.onRateLimit(message);

      case 'result':
        return this.onResult(message);
    }
  }

  /**
   * Takes the init snapshot and checks it before the first request to the model. An init that
   * cannot be read is a perimeter that cannot be checked: letting it through would send the run
   * through all its turns unchecked, and the problem would become known only from the result, when
   * the writes to the domains are already done.
   */
  private onInit(message: unknown): void {
    const init = initMessageSchema.safeParse(message);

    if (init.success) {
      this.init = init.data;
      this.problems = this.judge(init.data);
    } else {
      this.problems = [`the init message has an unexpected shape: ${z.prettifyError(init.error)}`];
    }

    if (this.problems.length > 0) this.halt('init check failed');
  }

  /**
   * Handles a message in which the model asks for a tool: the call awaits its response. A
   * rate-limit refusal means the plan quota was hit.
   */
  private onAssistant(message: unknown): void {
    const assistant = assistantMessageSchema.safeParse(message);
    if (!assistant.success) {
      return;
    }

    if (assistant.data.error === 'rate_limit') {
      this.hitQuota({ reason: 'rate limited by the plan' });
    }

    for (const block of assistant.data.message.content) {
      if (block.type === 'tool_use' && block.id && block.name) {
        this.pending.set(block.id, toolNameOf(block.name));

        const path = readPathOf(block.name, block.input);
        if (path !== undefined) this.readPaths.set(block.id, path);

        if (toolNameOf(block.name).server === 'gbrain') {
          this.gbrainIssued.set(block.id, {
            position: this.gbrainIssuedCount++,
            input: recordOf(block.input),
          });
        }
      }
    }
  }

  /** Handles the tools' responses to the calls that are waiting. */
  private onUser(message: unknown): void {
    const user = userMessageSchema.safeParse(message);
    if (!user.success || typeof user.data.message.content === 'string') {
      return;
    }

    for (const block of user.data.message.content) {
      if (block.type === 'tool_result' && block.tool_use_id) {
        this.settle(block.tool_use_id, block.is_error !== true, block.content);
      }
    }
  }

  /** Handles a rate-limit event: the plan quota refused, or the run started spending overage. */
  private onRateLimit(message: unknown): void {
    const limit = rateLimitEventSchema.safeParse(message);
    if (!limit.success) {
      return;
    }

    const info = limit.data.rate_limit_info;
    const resetsAt = info.resetsAt === undefined ? undefined : fromUnixTime(info.resetsAt);

    if (info.status === 'rejected') {
      this.hitQuota({
        reason: `plan limit reached (${info.rateLimitType ?? 'unknown window'})`,
        resetsAt,
      });
    } else if (info.isUsingOverage === true || info.overageInUse === true) {
      this.hitQuota({ reason: 'the run started spending plan overage', resetsAt });
    }
  }

  /** Handles the replacement of the model by another: the run stops (`INV-032`). */
  private onFallback(message: unknown): void {
    const fallback = refusalFallbackSchema.safeParse(message);
    if (!fallback.success) {
      return;
    }

    this.fellBack ??= { from: fallback.data.original_model, to: fallback.data.fallback_model };
    this.halt('model fallback (INV-032)');
  }

  private onResult(message: unknown): void {
    const result = resultMessageSchema.safeParse(message);
    if (!result.success) {
      return;
    }

    this.result = result.data;

    if (result.data.terminal_reason === 'blocking_limit') {
      this.hitQuota({ reason: 'plan limit blocked the run' });
    }
  }

  observed(): ObservedStream {
    return {
      init: this.init,
      initProblems: this.problems,
      fellBack: this.fellBack,
      toolCalls: [...this.calls],
      breaches: [...this.breaches],
      reads: this.reads,
      skillReads: [...this.skillReads],
      gbrainCalls: [...this.gbrainCalls]
        .sort((first, second) => first.position - second.position)
        .map(({ call }) => call),
      rejections: [...this.rejections],
      quota: this.quota,
      result: this.result,
    };
  }

  private settle(id: string, ok: boolean, content: unknown): void {
    const call = this.pending.get(id);
    if (!call) {
      return;
    }

    this.pending.delete(id);
    this.calls.push({ ...(call.server ? { server: call.server } : {}), tool: call.tool, ok });
    this.noteGbrain(id, call, ok);
    this.noteRead(id, ok);
    this.guardRead(id, ok);

    if (!ok && HARNESS_TOOLS.includes(call.tool)) {
      this.rejections.push(unwrapped(textOf(content)));
    }

    if (ok && call.server) {
      this.reads.set(call.server, [...(this.reads.get(call.server) ?? []), textOf(content)]);
    }
  }

  /** Records a GBrain call that ended with a response, with the arguments the model passed. */
  private noteGbrain(id: string, call: ToolName, ok: boolean): void {
    const issued = this.gbrainIssued.get(id);

    this.gbrainIssued.delete(id);

    if (issued !== undefined) {
      this.gbrainCalls.push({
        position: issued.position,
        call: { tool: call.tool, ok, input: issued.input },
      });
    }
  }

  /**
   * Records a `Read` that succeeded or was rejected. It runs before `guardRead`, which removes the
   * call's path.
   */
  private noteRead(id: string, ok: boolean): void {
    const path = this.readPaths.get(id);

    if (path !== undefined) this.skillReads.push(skillReadOf(path, ok, this.pluginDir));
  }

  /**
   * Guards `Read` as the second layer of the perimeter. The CLI enforces the `Read` perimeter with
   * a permission rule, and a successful read outside the plugin directory means the rule did not
   * work (managed policies, `GAP-13`). A rejected attempt is not a failure: it is the perimeter at
   * work.
   */
  private guardRead(id: string, ok: boolean): void {
    const path = this.readPaths.get(id);
    this.readPaths.delete(id);

    if (!ok || path === undefined || withinDirectory(path, this.pluginDir)) return;

    this.breaches.push(`Read of ${path} succeeded outside the plugin directory`);
    this.halt('perimeter breach');
  }

  private hitQuota(quota: Quota): void {
    this.quota ??= quota;
    this.halt(quota.reason);
  }

  /** Stops the run once. The cause is the first fact that demands it. */
  private halt(reason: string): void {
    if (this.halted) return;

    this.halted = true;
    this.stop(reason);
  }
}

/**
 * Returns the call's arguments as a record: whatever is not a record is a call without
 * arguments.
 */
function recordOf(input: unknown): Readonly<Record<string, unknown>> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
    ? Object.fromEntries(Object.entries(input))
    : {};
}

/**
 * Returns the path of a `Read` call: only for `Read` itself, and only when the path is a string.
 */
function readPathOf(tool: string, input: unknown): string | undefined {
  if (tool !== 'Read' || typeof input !== 'object' || input === null) return undefined;

  return 'file_path' in input && typeof input.file_path === 'string' ? input.file_path : undefined;
}

/**
 * Returns the read path for the report: relative to the plugin directory when the file is in it; a
 * rejected read is marked.
 */
function skillReadOf(file: string, ok: boolean, directory: string): string {
  const shown = withinDirectory(file, directory)
    ? relative(resolve(directory), resolve(file))
    : file;

  return ok ? shown : `${shown} [failed]`;
}

/**
 * Checks whether the file is inside the directory. A relative path counts as outside, because the
 * run's cwd resolves it, not the plugin directory, and a successful read through it is not a read
 * of a reference.
 */
function withinDirectory(file: string, directory: string): boolean {
  if (!isAbsolute(file)) return false;

  const path = relative(resolve(directory), resolve(file));

  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}

/** Extracts the text of a tool response, which is a string or `text` blocks. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;

  if (!Array.isArray(content)) return '';

  return content
    .map((block: unknown) =>
      typeof block === 'object' &&
      block !== null &&
      'text' in block &&
      typeof block.text === 'string'
        ? block.text
        : '',
    )
    .join('\n');
}
