import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { appConfig, type AppConfig } from '../../config/app.config';
import { RunWrites } from '../../effects/run-writes';
import {
  actorOf,
  EffectsGrant,
  EffectsReport,
  RunEffects,
  RunEffectsSession,
} from '../../runs/run-effects';
import { loopbackAppMcpUrl } from './app-mcp.address';
import { RunSession } from './run-session';

/**
 * The App MCP run sessions, and the adapter for the `RunEffects` port.
 *
 * The bearer is 32 random bytes and lives only here, in process memory: no other process knows
 * it, and a closed session is forgotten together with it (`docs/2-system.md` § “Authentication
 * boundary”). The bearer expires when the run's ticket does.
 *
 * A run's writes are kept by the deferred write policy of its session (ADR 0015). Through the
 * port, the dispatcher decides whether to apply or discard them.
 */
@Injectable()
export class RunSessions implements RunEffects {
  readonly available = true;

  private readonly sessions = new Map<string, RunSession>();

  constructor(
    private readonly writes: RunWrites,
    @Inject(appConfig.KEY) private readonly app: AppConfig,
  ) {}

  /**
   * Opens a run session. The run reaches the App MCP over the loopback of the same container
   * (`docs/2-system.md` § “Runner execution environment”).
   */
  open(grant: EffectsGrant): RunEffectsSession {
    const bearer = randomBytes(32).toString('base64url');

    this.sessions.set(
      bearer,
      new RunSession(grant, this.writes.open(actorOf(grant), grant.deadline)),
    );

    return {
      url: loopbackAppMcpUrl(this.app.port),
      bearer,
      commit: () => this.end(bearer, (session) => session.writes.commit()),
      discard: () => this.end(bearer, (session) => Promise.resolve(session.writes.discard())),
    };
  }

  /**
   * Returns the session if it still accepts calls. `null` means the bearer is unknown, the
   * session is closed or the ticket has expired.
   */
  resolve(bearer: string): RunSession | null {
    const session = this.sessions.get(bearer);

    return session?.accepts() ? session : null;
  }

  /**
   * Ends the session exactly once. The first step of applying or discarding closes the policy,
   * so a call that arrives afterwards gets a 401 instead of slipping past the decision. Ending a
   * session a second time does nothing, because the session is already gone.
   */
  private async end(
    bearer: string,
    finish: (session: RunSession) => Promise<EffectsReport>,
  ): Promise<EffectsReport> {
    const session = this.sessions.get(bearer);
    if (!session) {
      return { applied: [], refused: [] };
    }

    try {
      return await finish(session);
    } finally {
      this.sessions.delete(bearer);
    }
  }
}
