import { constants } from 'node:os';
import { messageOf } from '../../src/platform/error/message-of';
import { cleanupVerdict } from './gate-cleanup';

/** Cleanup after the gate, requested when the gate is stopped; returns the residue. */
type Cleanup = () => Promise<readonly string[]>;

/**
 * Signals on which the gate stops itself and cleans up after itself: Ctrl+C, `kill` and a closed
 * terminal. `infra/bin/gate` catches the same list.
 */
export const STOP_SIGNALS: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

/** The source of signals: the process in normal operation, an emitter in the spec. */
interface SignalSource {
  on(signal: NodeJS.Signals, listener: () => void): unknown;
  off(signal: NodeJS.Signals, listener: () => void): unknown;
}

/** Everything the guard uses to interact with the world. */
interface AbortPorts {
  readonly signals: SignalSource;
  /** Closes the application after cleanup, because cleanup uses the database. */
  readonly close: () => Promise<void>;
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
  /** Ends the process with a code. */
  readonly exit: (code: number) => void;
}

/**
 * A gate stopped by a signal cleans up after itself.
 *
 * On a signal Nest destroys the application and passes the signal on to the process, so the
 * gate's `finally` blocks, which contain the cleanup, do not run, and pages stay behind in the
 * workspace. So the gate does not enable `enableShutdownHooks` and catches the signal here. It runs
 * all registered cleanup, closes the application, writes a verdict stub to stdout (so that
 * `> gate-mN.json` does not stay empty) and ends the process with code `128 + signal`.
 *
 * One stop reaches the gate as several signals: Compose passes the operator's signal to the
 * container, and `bin/gate` also asks for TERM. A signal during cleanup is the same stop, so it
 * neither interrupts cleanup nor starts it a second time. Stopping at once is the wrapper's job,
 * because it sees each operator action separately.
 */
export class AbortGuard {
  private readonly cleanups: Cleanup[] = [];
  private readonly listeners = new Map<NodeJS.Signals, () => void>();
  private aborted = false;
  private reported = false;

  constructor(
    private readonly gate: string,
    private readonly ports: AbortPorts,
  ) {}

  /** Registers the cleanup that runs when the gate is stopped. */
  hold(cleanup: Cleanup): void {
    this.cleanups.push(cleanup);
  }

  /**
   * The gate is being stopped: cleanup is running, the application is about to be closed and the
   * verdict stub is already being written. Work that is still running alongside the stop starts
   * nothing new and writes no verdict.
   */
  get stopping(): boolean {
    return this.aborted;
  }

  /**
   * Writes the gate's verdict, the only document on stdout, so that `> gate-mN.json` stays JSON.
   * A gate that is being stopped writes no verdict (the guard writes the stub), and after a
   * verdict there is no stub.
   */
  report(verdict: unknown): void {
    if (this.aborted || this.reported) return;

    this.reported = true;
    this.ports.stdout(`${JSON.stringify(verdict, null, 2)}\n`);
  }

  arm(): void {
    for (const signal of STOP_SIGNALS) {
      const listener = (): void => {
        if (this.aborted) {
          this.ports.stderr(
            `${this.gate} gate: ${signal} while cleaning up, the cleanup goes on\n`,
          );

          return;
        }

        void this.abort(signal);
      };

      this.listeners.set(signal, listener);
      this.ports.signals.on(signal, listener);
    }
  }

  disarm(): void {
    for (const [signal, listener] of this.listeners) {
      this.ports.signals.off(signal, listener);
    }

    this.listeners.clear();
  }

  private async abort(signal: NodeJS.Signals): Promise<void> {
    this.aborted = true;
    this.ports.stderr(`${this.gate} gate: ${signal}, cleaning up\n`);

    const left: string[] = [];

    for (const cleanup of this.cleanups) {
      try {
        left.push(...(await cleanup()));
      } catch (error) {
        left.push(`cleanup: ${messageOf(error)}`);
      }
    }

    try {
      await this.ports.close();
    } catch (error) {
      this.ports.stderr(`${this.gate} gate: could not close the app: ${messageOf(error)}\n`);
    }

    if (!this.reported) {
      this.reported = true;
      this.ports.stdout(
        `${JSON.stringify(
          {
            gate: this.gate.toUpperCase(),
            ok: false,
            aborted: signal,
            cleanup: cleanupVerdict(left),
          },
          null,
          2,
        )}\n`,
      );
    }

    this.ports.exit(128 + (constants.signals[signal] ?? 0));
  }
}
