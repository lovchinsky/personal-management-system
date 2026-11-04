import { Test } from '@nestjs/testing';
import { APIErrorCode, Client, RequestTimeoutError } from '@notionhq/client';
import { z } from 'zod';
import { notionAnswer } from '../../../../test/fixtures/notion-answer.fixture';
import {
  formulaProperty,
  fullDataSource,
  LivePropertyConfig,
  notionWithDataSources,
  partialDataSource,
  plainProperty,
  statusProperty,
} from '../../../../test/fixtures/notion-data-source.fixture';
import { VALID_BINDING_FILE } from '../../../../test/fixtures/notion-mapping.fixture';
import { bindingProvider } from '../../../../test/fixtures/test-module';
import { LiveSchema } from '../../client/live-schema';
import { bindingOf, propertyOf } from '../binding';
import { CANONICAL_TYPES, CanonicalType } from '../binding.schema';
import { BindingDriftAuditor } from './binding-drift.auditor';

/** The model of the same binding. The audit walks it too, so the fixture reads it the same way. */
const BINDING = bindingOf(VALID_BINDING_FILE, 'fixture');

/**
 * Builds a live workspace from the binding itself.
 *
 * This is how the test checks what the audit checks: not “whether it knows the list of
 * properties” but whether it sees the **absence** of one the binding declared.
 */
function workspaceFromBinding(
  missing: readonly string[] = [],
  missingOptions: readonly string[] = [],
  gone: readonly CanonicalType[] = [],
): Client {
  const bySource = new Map<string, LivePropertyConfig[]>();

  // The binding is traversed through the same accessors the audit uses: otherwise the fixture and
  // the subject under test would read the binding differently.
  for (const type of CANONICAL_TYPES) {
    const properties: LivePropertyConfig[] = [];

    for (const { slot, field, carrier } of BINDING.fieldsOf(type)) {
      const property = propertyOf(carrier);

      if (!property || missing.includes(slot)) continue;

      const optionSet = BINDING.optionSet(slot);
      const declared: readonly string[] = optionSet
        ? [...optionSet.canonical, ...optionSet.knownNonCanonical].map(([, id]) => id)
        : [];

      properties.push(
        optionSet
          ? statusProperty(
              property.spelled,
              field,
              declared.filter((id) => !missingOptions.includes(id)),
            )
          : plainProperty(property.spelled, field, 'rich_text'),
      );
    }

    for (const { slot, property } of BINDING.signalsOf(type)) {
      if (missing.includes(slot)) continue;

      properties.push(formulaProperty(property.spelled, slot));
    }

    bySource.set(BINDING.dataSource(type), properties);
  }

  const goneIds = new Set(gone.map((type) => BINDING.dataSource(type)));

  return notionWithDataSources((id) =>
    goneIds.has(id)
      ? Promise.reject(notionAnswer(APIErrorCode.ObjectNotFound, 404))
      : Promise.resolve(fullDataSource(id, bySource.get(id) ?? [])),
  );
}

async function auditorWith(notion: Client): Promise<BindingDriftAuditor> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      BindingDriftAuditor,
      LiveSchema,
      { provide: Client, useValue: notion },
      bindingProvider(),
    ],
  }).compile();

  return moduleRef.get(BindingDriftAuditor);
}

/** The binding as a plain object, in the form the count walks it in. */
const plainBinding = z.object({
  data_sources: z.record(z.string(), z.string()),
  fields: z.record(z.string(), z.record(z.string(), z.object({ kind: z.string() }))),
  signals: z.record(z.string(), z.string()).optional(),
});

/**
 * Counts how many carriers the audit is **required** to check.
 *
 * It counts by a plain walk of the binding object, not by the typed accessors the audit uses.
 * This is deliberate. The fixture above is built with the same accessors, so narrowing the audit
 * would narrow the fixture too. The disappearance of a whole category of carriers would stay
 * invisible, because neither side would have it.
 */
function expectedCarriers(): number {
  const binding = plainBinding.parse(VALID_BINDING_FILE);

  const types = Object.keys(binding.data_sources);

  let total = 0;

  for (const type of types) {
    for (const representation of Object.values(binding.fields[type] ?? {})) {
      if (representation.kind === 'native' || representation.kind === 'relation') total += 1;
    }
  }

  // Signals are keyed flat, by a `type.signal` pair, and belong to the type whose name comes before
  // the dot.
  for (const key of Object.keys(binding.signals ?? {})) {
    if (types.includes(key.split('.')[0])) total += 1;
  }

  return total;
}

describe('the binding check against the workspace', () => {
  it('a binding that matches yields no drift', async () => {
    const auditor = await auditorWith(workspaceFromBinding());
    const report = await auditor.audit();

    expect(report.drifts).toEqual([]);
    expect(report.unreachable).toEqual([]);
  });

  /**
   * The scope of the check is as much a claim as the drifts themselves, because an audit that
   * has stopped traversing, say, the signals still reports “no drift”. That sounds the same as
   * “everything is in place”.
   */
  it('every declared carrier is checked, not just some of them', async () => {
    const auditor = await auditorWith(workspaceFromBinding());
    const report = await auditor.audit();

    expect(report.checked).toBe(expectedCarriers());
    // The second half of the claim is that the independent count must not turn out to be zero
    // together with the audit. Otherwise the equality would rest on nothing.
    expect(expectedCarriers()).toBeGreaterThan(40);
  });

  /** This is the case the startup check lets through: the file is complete and the id is dead. */
  it('a vanished property is found', async () => {
    const auditor = await auditorWith(workspaceFromBinding(['task.status']));
    const report = await auditor.audit();

    expect(report.drifts).toEqual([
      { slot: 'task.status', detail: expect.stringContaining('is gone') },
    ]);
  });

  it('a vanished signal is found', async () => {
    const auditor = await auditorWith(workspaceFromBinding(['task.blocked']));
    const report = await auditor.audit();

    expect(report.drifts).toEqual([
      { slot: 'task.blocked', detail: expect.stringContaining('signal property') },
    ]);
  });

  it('a vanished option of a closed set is found', async () => {
    const [entry] = BINDING.optionSet('task.status')?.canonical ?? [];
    const auditor = await auditorWith(workspaceFromBinding([], [entry?.[1] ?? '']));
    const report = await auditor.audit();

    const [drift] = report.drifts;

    expect(report.drifts).toHaveLength(1);
    expect(drift?.detail).toContain('option');
  });

  /**
   * A data source for which Notion says “there is none” is a dead id in the binding, which is
   * what the check must catch. A report “checked in part” would sound the same for a deleted
   * database as for a temporary failure, and nobody would see the drift.
   */
  it('a vanished data source is found as drift, not as unreachability', async () => {
    const auditor = await auditorWith(workspaceFromBinding([], [], ['task']));
    const report = await auditor.audit();

    expect(report.drifts).toEqual([
      {
        slot: 'data_sources.task',
        detail: `data source ${BINDING.dataSource('task')} is gone`,
      },
    ]);
    expect(report.unreachable).toEqual([]);
  });

  /** Unavailability is not drift, because the binding may not have changed. */
  const unavailable: [string, Error][] = [
    ['no access', notionAnswer(APIErrorCode.Unauthorized, 401)],
    ['rate limit', notionAnswer(APIErrorCode.RateLimited, 429)],
    ['server failure', notionAnswer(APIErrorCode.InternalServerError, 500)],
    ['request timeout', new RequestTimeoutError()],
  ];

  it.each(unavailable)('an unreachable data source (%s) is not drift', async (_, error) => {
    const auditor = await auditorWith(notionWithDataSources(() => Promise.reject(error)));

    const report = await auditor.audit();

    expect(report.drifts).toEqual([]);
    expect(report.unreachable).toHaveLength(CANONICAL_TYPES.length);
  });

  /** A partial answer is unavailability too, because the integration lacks access to the schema. */
  it('a data source without schema access is unreachable, not drift', async () => {
    const auditor = await auditorWith(
      notionWithDataSources((id) => Promise.resolve(partialDataSource(id))),
    );

    const report = await auditor.audit();

    expect(report.drifts).toEqual([]);
    expect(report.unreachable).toHaveLength(CANONICAL_TYPES.length);
  });

  /**
   * A defect in the request or the code is not unavailability, because hiding it in the list of
   * unreachable ones would mean staying silent.
   */
  const defects: [string, Error][] = [
    ['a refused request', notionAnswer(APIErrorCode.ValidationError, 400)],
    ['an error that does not come from Notion', new TypeError('defect')],
  ];

  it.each(defects)('%s propagates', async (_, error) => {
    const auditor = await auditorWith(notionWithDataSources(() => Promise.reject(error)));

    await expect(auditor.audit()).rejects.toBe(error);
  });
});
