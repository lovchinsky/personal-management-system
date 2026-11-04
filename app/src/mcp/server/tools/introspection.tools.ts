import { z } from 'zod';
import { personSpeaks } from '../../../runs/actor';
import { AppTool, defineTool, ToolContext } from './app-tool';

/**
 * A question with no fields is closed too (`INV-090`), because the model must get a refusal for
 * a field the tool does not know, instead of believing that its clarification was taken into
 * account.
 */
const noInput = z.strictObject({});

function runtimeState(context: ToolContext): Promise<object> {
  const { session } = context;
  const { identity } = session;

  return Promise.resolve({
    ...(identity.surface === 'run'
      ? { surface: 'run', run_id: identity.runId, mode: identity.mode }
      : { surface: 'chat' }),
    // Whether the App accepts `user_snooze` depends on whether this step has the person's words.
    // The answer comes from the same classifier the capabilities use, not from the model's
    // guess.
    person_speaks: personSpeaks(session.actor),
    now: new Date().toISOString(),
    time_zone: context.timeZone(),
    // The grammatical gender for addressing the person is an installation setting, not the
    // model's guess from a name (ADR 0046).
    person_gender: context.ownerGender(),
    // The name the person calls the assistant by, so that the model understands how it is
    // addressed (ADR 0049). The gender the assistant uses for itself is likewise a setting, not a
    // guess from a name (ADR 0046).
    assistant_name: context.assistantName(),
    assistant_gender: context.assistantGender(),
    delivery: context.delivery.window(session.actor),
  });
}

export const INTROSPECTION_TOOLS: readonly AppTool[] = [
  defineTool({
    name: 'get_runtime_state',
    capability: 'runtime_read',
    bound: 1_000,
    description:
      'Current time and time zone, who is speaking (a run with its id and mode, or a chat), whether ' +
      "this step carries the person's own words (`person_speaks`), the grammatical gender to address " +
      'the person with (`person_gender`) and to speak of yourself in (`assistant_gender`), each ' +
      'masculine, feminine, or neutral (phrase around gendered forms); the name the person calls ' +
      'you by (`assistant_name`, null when you have none); and when a notification queued now ' +
      'would be delivered.',
    inputSchema: noInput,
    handle: runtimeState,
  }),
  defineTool({
    name: 'get_schema_mapping',
    capability: 'schema_read',
    // The mapping bounds itself: however many pages there are, the answer stays the same.
    bound: 40_000,
    description:
      "The installation's mapping of canonical semantics to Notion: data sources, " +
      'carriers with canonical property ids, option ids and signals, and next to each ' +
      'property and option the name the workspace shows for it now. It does not say ' +
      'whether a given page has a value.',
    inputSchema: noInput,
    handle: (context) => context.schema.read(),
  }),
];
