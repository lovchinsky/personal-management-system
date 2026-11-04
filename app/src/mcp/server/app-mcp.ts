import { Inject, Injectable, Logger } from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ApprovalsService } from '../../approvals/approvals.service';
import { appConfig, type AppConfig } from '../../config/app.config';
import { ContinuationsService } from '../../continuations/continuations.service';
import { DeliveryService } from '../../delivery/delivery.service';
import { SchemaMappingReader } from '../../notion/semantics/schema-mapping.reader';
import { messageOf, stackOf } from '../../platform/error/message-of';
import { InvalidRequestError } from '../../platform/request/invalid-request';
import { assistantConfig, type AssistantConfig } from './assistant.config';
import { McpSession } from './mcp-session';
import { ToolContext } from './tools/app-tool';
import { APP_TOOLS } from './tools/app-tools';

/**
 * What the model sees when a call fails through no fault of the model. The session is poisoned
 * after that, and the model must know the main thing: the writes of this run cannot be relied
 * on.
 */
const TEMPORARY_FAILURE =
  "App could not complete this call. None of this run's App writes will be applied, " +
  'so do not tell the person that anything was scheduled, queued or proposed.';

/**
 * The App MCP server for a session, a run's or a chat's.
 *
 * The server is built per request and registers only the tools that the session sees: for a run,
 * the tools of the App bundles in the row for the run's mode; for a chat, the `chat_toolset`. It
 * handles the protocol only: the table of tools and how a call error becomes a response. The
 * rules and what is shown belong to the capabilities, and the writes belong to the session's
 * write policy (ADR 0015).
 */
@Injectable()
export class AppMcp {
  private readonly logger = new Logger(AppMcp.name);

  constructor(
    private readonly continuations: ContinuationsService,
    private readonly delivery: DeliveryService,
    private readonly approvals: ApprovalsService,
    private readonly schema: SchemaMappingReader,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
    @Inject(assistantConfig.KEY) private readonly assistant: AssistantConfig,
  ) {}

  serverFor(session: McpSession): McpServer {
    const server = new McpServer(
      { name: 'personal-management-system-app', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    const context: ToolContext = {
      session,
      continuations: this.continuations,
      delivery: this.delivery,
      approvals: this.approvals,
      schema: this.schema,
      timeZone: () => this.app.timeZone,
      ownerGender: () => this.app.ownerGender,
      assistantName: () => this.assistant.name,
      assistantGender: () => this.assistant.gender,
      respond: (tool, work) => this.respond(session, tool, work),
    };

    for (const tool of APP_TOOLS) {
      if (session.tools.has(tool.name)) tool.register(server, context);
    }

    return server;
  }

  /**
   * Returns a tool's response: either a refusal or a failure.
   *
   * A capability's refusal goes back to the model as text, because the request has to change and
   * the model can fix it. Anything else is a failure. The model learns nothing useful about its
   * causes: it sees only that the writes of this run cannot be relied on. The session is
   * poisoned (`docs/2-system.md` § “App MCP”). The write policy keeps the cause, which goes
   * into the run trace.
   */
  private async respond(
    session: McpSession,
    tool: string,
    work: () => Promise<object>,
  ): Promise<CallToolResult> {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await work()) }] };
    } catch (error) {
      if (error instanceof InvalidRequestError) {
        session.writes.refuse(tool, error.message);

        return { content: [{ type: 'text', text: error.message }], isError: true };
      }

      // The model learns nothing useful about a failure, so the stack stays for whoever fixes
      // it. Only the cause goes into the run trace.
      this.logger.error(`${label(session)}: ${tool} failed — ${messageOf(error)}`, stackOf(error));
      session.writes.poison(`${tool}: ${messageOf(error)}`);

      return { content: [{ type: 'text', text: TEMPORARY_FAILURE }], isError: true };
    }
  }
}

/** Returns who made the call for the log line: the run id or “chat”. */
function label({ identity }: McpSession): string {
  return identity.surface === 'run' ? identity.runId : 'chat';
}
