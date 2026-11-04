import { Controller, Delete, Get, Post, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { DEFAULT_THROTTLE } from '../../config/throttle.config';
import { OauthServer } from '../oauth/oauth-server';
import { AppMcp } from './app-mcp';
import { APP_MCP_PATH } from './app-mcp.address';
import { ChatSessions } from './chat-sessions';
import { McpSession } from './mcp-session';
import { RunSessions } from './run-sessions';

/**
 * The App MCP endpoint (`POST /mcp`), which speaks stateless streamable HTTP with JSON responses.
 *
 * The server and the transport are built per request: nothing is kept between requests except
 * the run session that the run's bearer identifies, or the OAuth token the person connected with
 * in a chat. A request without a valid bearer gets a 401 with no explanation beyond a pointer to
 * where an OAuth client finds the metadata (`docs/2-system.md` § “Authentication boundary”). The
 * same goes for any other method: whoever is not authenticated does not even learn that `GET` is
 * not served here.
 *
 * The endpoint skips the `default` throttler profile because a run makes dozens of calls a
 * minute, and a limit sized for a person would cut the run off in the middle of its work. The
 * `webhooks` profile enforces the external limit.
 */
@Controller(APP_MCP_PATH)
@SkipThrottle({ [DEFAULT_THROTTLE]: true })
export class AppMcpController {
  constructor(
    private readonly sessions: RunSessions,
    private readonly chats: ChatSessions,
    private readonly oauth: OauthServer,
    private readonly mcp: AppMcp,
  ) {}

  @Post()
  async call(@Req() request: Request, @Res() response: Response): Promise<void> {
    const session = await this.authenticated(request, response);
    if (!session) {
      return;
    }

    const server = this.mcp.serverFor(session);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    response.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(request, response, request.body);
  }

  /** A stateless server sends no messages on its own, so it has no stream for `GET`. */
  @Get()
  stream(@Req() request: Request, @Res() response: Response): Promise<void> {
    return this.notAllowed(request, response);
  }

  /**
   * There is no MCP session to close, because only the run session exists, and the dispatcher
   * closes it.
   */
  @Delete()
  close(@Req() request: Request, @Res() response: Response): Promise<void> {
    return this.notAllowed(request, response);
  }

  private async notAllowed(request: Request, response: Response): Promise<void> {
    if (!(await this.authenticated(request, response))) return;

    response.status(405).set('Allow', 'POST').end();
  }

  /**
   * Returns the session that the bearer identifies. Otherwise it sends a 401 response and returns
   * `null`. A run's bearer is a secret in process memory. A chat token is kept in the database as
   * a digest. Neither can stand in for the other.
   */
  private async authenticated(request: Request, response: Response): Promise<McpSession | null> {
    const header = request.headers.authorization ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(header);
    const bearer = match ? match[1] : null;
    const run = bearer ? this.sessions.resolve(bearer) : null;

    if (run) return run;

    if (bearer && (await this.oauth.verify(bearer))) return this.chats.open();

    response
      .status(401)
      .set('WWW-Authenticate', this.oauth.challenge(bearer !== null))
      .end();

    return null;
  }
}
