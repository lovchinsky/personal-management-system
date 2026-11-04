import { Test } from '@nestjs/testing';
import { emptyResidue, type Residue } from './gate-cleanup';
import { GateWorld } from './m4-world';

/**
 * Builds a world without Notion: its cleanup only keeps a log, and what was “in flight” adds a
 * page during the cleanup.
 */
async function worldThat(inFlight?: string): Promise<{
  world: GateWorld;
  cleaned: { readonly pages: readonly string[] }[];
}> {
  const app = await Test.createTestingModule({}).compile();
  const cleaned: { readonly pages: readonly string[] }[] = [];

  class Probe extends GateWorld {
    override clean(residue: Residue): Promise<readonly string[]> {
      cleaned.push({ pages: [...residue.pages] });

      if (inFlight !== undefined && cleaned.length === 1) residue.pages.push(inFlight);

      return Promise.resolve([]);
    }
  }

  return { world: new Probe(app, 'm4'), cleaned };
}

describe('GateWorld: stop by a signal', () => {
  it('new registers are issued before the stop', async () => {
    const { world } = await worldThat();

    expect(world.begin().pages).toEqual([]);
  });

  /** Cleanup is already under way, so a page that appeared after it would stay in the workspace. */
  it('after the stop the world creates and launches nothing new', async () => {
    const { world } = await worldThat();
    const residue = emptyResidue();

    await world.abandon();

    expect(() => world.begin()).toThrow('stopped by a signal');
    await expect(world.putItem('Запис', undefined, residue)).rejects.toThrow('stopped');
    await expect(world.putTask({ name: 'Задача', status: 'Next Action' }, residue)).rejects.toThrow(
      'stopped',
    );
    await expect(world.putSystemMessage('thread', residue)).rejects.toThrow('stopped');
    await expect(world.openThread('page', residue)).rejects.toThrow('stopped');
  });

  /**
   * An operation that was in flight adds its page to the register after the first cleanup
   * snapshot, and the second cleanup of the same register picks it up.
   */
  it('cleans up every open register twice, so the second cleanup sees the late page', async () => {
    const { world, cleaned } = await worldThat('late-page');

    world.begin();
    await world.abandon();

    expect(cleaned.map((call) => call.pages)).toEqual([[], ['late-page']]);
  });

  it('cleans up nothing without open registers', async () => {
    const { world, cleaned } = await worldThat();

    expect(await world.abandon()).toEqual([]);
    expect(cleaned).toEqual([]);
  });
});
