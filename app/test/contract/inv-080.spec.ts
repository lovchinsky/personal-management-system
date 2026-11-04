import { MODULE_METADATA } from '@nestjs/common/constants';
import { ApprovalsModule } from '../../src/approvals/approvals.module';
import { AttentionModule } from '../../src/attention/attention.module';
import { CaptureModule } from '../../src/capture/capture.module';
import { ContinuationsModule } from '../../src/continuations/continuations.module';
import { DeliveryModule } from '../../src/delivery/delivery.module';

/** Returns the names of what a module exports. */
function exportedBy(module: object): string[] {
  const exported: unknown = Reflect.getMetadata(MODULE_METADATA.EXPORTS, module);
  const providers: readonly unknown[] = Array.isArray(exported) ? exported : [];

  return providers.map((provider) =>
    typeof provider === 'function' ? provider.name : String(provider),
  );
}

/**
 * `INV-080` Capability modules — continuation, delivery, approval, attention, conversion — export a
 * service and at most one run source: the queue and the store stay inside, so every entry into a
 * capability passes its checks.
 *
 * A run source is not an entry: it does not enqueue rows but takes the due rows into a run.
 */
describe('INV-080', () => {
  it.each([
    ['continuations', ContinuationsModule],
    ['delivery', DeliveryModule],
    ['approvals', ApprovalsModule],
    ['attention', AttentionModule],
    ['capture', CaptureModule],
  ])('%s exports a service and at most a run source', (_name, module) => {
    const exported = exportedBy(module);
    const sources = exported.filter((name) => name.endsWith('RunSource'));
    const services = exported.filter((name) => name.endsWith('Service'));

    expect(exported.filter((name) => !services.includes(name) && !sources.includes(name))).toEqual(
      [],
    );
    expect(services).not.toHaveLength(0);
    expect(sources.length).toBeLessThanOrEqual(1);
  });

  /** Without this, the rule about the source would pass silently even with no sources anywhere. */
  it('continuations export their run source', () => {
    expect(exportedBy(ContinuationsModule)).toContain('ScheduledCheckRunSource');
  });
});
