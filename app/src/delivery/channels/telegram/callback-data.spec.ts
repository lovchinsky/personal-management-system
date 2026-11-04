import { ACTION_KINDS, ChannelAction } from '../../port/channel.port';
import { actionOf, callbackDataOf } from './callback-data';

const ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('button on the wire', () => {
  /** Both directions use one format, so what is read back is what was rendered. */
  it.each([...ACTION_KINDS])('%s survives the render → intake round trip', (kind) => {
    const action: ChannelAction = { kind, pendingActionId: ID };

    expect(actionOf(callbackDataOf(action))).toEqual(action);
  });

  it.each([
    ['no separator', `approve${ID}`],
    ['unknown kind', `archive:${ID}`],
    ['id is not a uuid', 'approve:pa-1'],
    ['empty id', 'approve:'],
  ])('%s: not a button', (_case, data) => {
    expect(actionOf(data)).toBeNull();
  });

  /**
   * Telegram limits `callback_data` to 64 bytes. A proposal id is a uuid, 36 characters; the
   * longest kind (`dismiss`) and the colon make 44 bytes. The margin is checked numerically: the
   * test reports when the id grows longer or a longer intent name appears. The code has no “does
   * not fit” branch, because it would be unreachable.
   */
  it.each([...ACTION_KINDS])('%s button with a real id fits in 64 bytes with a margin', (kind) => {
    const size = Buffer.byteLength(callbackDataOf({ kind, pendingActionId: ID }), 'utf8');

    expect(size).toBeLessThanOrEqual(48);
  });

  it('an id that is not a uuid is not a button, even when shorter than the limit', () => {
    expect(actionOf('approve:x'.padEnd(20, 'x'))).toBeNull();
  });
});
