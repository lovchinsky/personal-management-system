import { randomUUID } from 'node:crypto';
import { INestApplicationContext } from '@nestjs/common';
import { Client } from '@notionhq/client';
import { runnerConfig, type RunnerConfig } from '../../src/claude/runner/runner.config';
import { appConfig, type AppConfig } from '../../src/config/app.config';
import { runDeliveryKey } from '../../src/delivery/delivery-key';
import { DeliveryService } from '../../src/delivery/delivery.service';
import { loopbackAppMcpUrl } from '../../src/mcp/server/app-mcp.address';
import { BotIdentity } from '../../src/notion/client/bot-identity';
import { LiveSchema } from '../../src/notion/client/live-schema';
import { NotionWriter } from '../../src/notion/client/notion.writer';
import { Page } from '../../src/notion/client/page';
import { SemanticAdapter } from '../../src/notion/semantics/semantic.adapter';
import { required } from '../../src/platform/config/env-value';
import { TraceView } from '../../src/runs/run-traces';
import { RunShape } from '../../src/runs/run.launcher';
import { eventEnvelope, TriggerEnvelope } from '../../src/runs/trigger-envelope';
import type { GateResult } from './gate-boot';
import { cleanupVerdict, Residue } from './gate-cleanup';
import { GateSession } from './gate-session';
import { gateConfig, type GateConfig } from './gate.config';
import { claimsOf, GateEvidence, GateTraces, PageComment, Probe } from './m3-claims';
import { GATE_MODE, GateTarget, shapesOf } from './m3-runs';
import { allComments, commentText, GateWorld } from './m4-world';

/** How long to wait for the App MCP endpoint to answer a probe. */
const PROBE_TIMEOUT_MS = 15_000;

/**
 * Conducts the gate and says whether everything is proven: the runs through a second App
 * instance, an inspection of what they left behind, and the verdict, which is JSON on stdout.
 */
export async function runGate(): Promise<GateResult> {
  const session = await GateSession.open('m3');
  const { app } = session;

  try {
    await session.ready();
    await session.assertRunnable();

    const world = new GateWorld(app, 'm3');

    session.holdAgainstAbort(() => world.abandon());

    const residue = world.begin();
    const dataSourceId = taskDataSource(app);
    const page = await gatePage(app, dataSourceId);

    residue.pages.push(page.id);

    let proved: Proved;

    try {
      proved = await prove(app, world, residue, {
        dataSourceId,
        pageId: page.id,
        validEvent: `gate-m3-valid-${randomUUID()}`,
        invalidEvent: `gate-m3-invalid-${randomUUID()}`,
      });
    } finally {
      await world.clean(residue);
    }

    const cleanup = cleanupVerdict(world.leftovers);
    const { ok, claims, runs } = proved;

    session.report({ gate: 'M3', at: new Date().toISOString(), ok, cleanup, claims, runs });

    return { ok, clean: cleanup.clean };
  } finally {
    await session.close();
  }
}

/** What the gate proved: the claims, the runs behind them, and whether everything is proven. */
interface Proved {
  readonly ok: boolean;
  readonly claims: ReturnType<typeof claimsOf>;
  readonly runs: GateTraces;
}

/** Conducts the gate's runs and inspects what they left behind. */
async function prove(
  app: INestApplicationContext,
  world: GateWorld,
  residue: Residue,
  target: GateTarget,
): Promise<Proved> {
  const runs = await conduct(world, target, residue);
  const claims = claimsOf(runs, await evidenceOf(app, target));

  return { ok: Object.values(claims).every((claim) => claim.ok), claims, runs };
}

function taskDataSource(app: INestApplicationContext): string {
  return app.get(SemanticAdapter).dataSourceOf('task');
}

/**
 * Creates the page on which the valid run leaves a comment in the system's voice and the invalid
 * run does not. The page is created with a system write, and the gate moves it to the trash
 * itself.
 */
async function gatePage(app: INestApplicationContext, dataSourceId: string): Promise<Page> {
  const properties = app.get(SemanticAdapter).encode(
    'task',
    {
      name: { kind: 'text', text: `gate-m3-${new Date().toISOString()}` },
      status: { kind: 'option', option: 'Someday/Maybe' },
    },
    await app.get(LiveSchema).typesOf(dataSourceId),
  );

  return app.get(NotionWriter).createPage(dataSourceId, properties);
}

/** Conducts the gate's runs one at a time, in the order of `GateRun`. */
async function conduct(
  world: GateWorld,
  target: GateTarget,
  residue: Residue,
): Promise<GateTraces> {
  const shapes = shapesOf(target);
  const run = (shape: RunShape, eventId: string = `gate-m3-${randomUUID()}`): Promise<TraceView> =>
    world.run(envelope(target.dataSourceId, eventId), { origin: 'operator' }, residue, shape);

  return {
    valid: await run(shapes.valid, target.validEvent),
    invalid: await run(shapes.invalid, target.invalidEvent),
    builtin: await run(shapes.builtin),
    unavailable: await run(shapes.unavailable),
  };
}

function envelope(dataSourceId: string, eventId: string): TriggerEnvelope {
  return eventEnvelope(GATE_MODE, {
    type: 'operator.gate',
    event_types: ['operator.gate'],
    event_id: eventId,
    timestamp: new Date().toISOString(),
    entity_id: dataSourceId,
    page_id: dataSourceId,
    updated_property_ids: [],
  });
}

/**
 * Collects what the runs left outside the traces, what the endpoints answer, and what is
 * declared.
 */
async function evidenceOf(app: INestApplicationContext, target: GateTarget): Promise<GateEvidence> {
  const delivery = app.get(DeliveryService);
  const { port } = app.get<AppConfig>(appConfig.KEY);
  // The App's own endpoint is always probed, because the runs have just used it. The public one is
  // probed when there is one, because it is the one the world reaches.
  const publicUrl = app.get<GateConfig>(gateConfig.KEY).appMcpUrl;

  return {
    // The App derives the delivery key from the run's cause, so the gate knows it in advance.
    delivered: await delivery.state(runDeliveryKey(target.validEvent)),
    leaked: await delivery.state(runDeliveryKey(target.invalidEvent)),
    page: target.pageId,
    comments: await commentsOn(app.get(Client), target.pageId),
    bot: await app.get(BotIdentity).require(),
    probes: [
      await probeOf(loopbackAppMcpUrl(port)),
      ...(publicUrl ? [await probeOf(publicUrl)] : []),
    ],
    publicProbed: publicUrl !== undefined,
    pluginDir: required(app.get<RunnerConfig>(runnerConfig.KEY).pluginDir, 'RUNNER_PLUGIN_DIR'),
  };
}

/** Reads the comments of a page as REST returns them. */
async function commentsOn(notion: Client, pageId: string): Promise<PageComment[]> {
  const results = await allComments(notion, pageId);

  return results.map((comment) => ({
    text: commentText(comment),
    author: comment.created_by.id,
  }));
}

async function probeOf(url: string): Promise<Probe> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });

  return { url, status: response.status, challenge: response.headers.get('www-authenticate') };
}
