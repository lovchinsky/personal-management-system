import { ChannelAction, strictChannelActionSchema } from '../../port/channel.port';

/**
 * Encodes a button for the wire as `kind:id`.
 *
 * Both directions use one format: delivery renders a button with it and intake reads it back. Two
 * descriptions of the same string would diverge where it costs the most, when the person presses
 * the button. Telegram limits `callback_data` to 64 bytes; a uuid id keeps the button within it by
 * construction (`callback-data.spec`).
 */
export function callbackDataOf(action: ChannelAction): string {
  return `${action.kind}:${action.pendingActionId}`;
}

/**
 * Reads a button back as a kind and a proposal id. Intake records a string that is not a button
 * as an update with no intent.
 */
export function actionOf(data: string): ChannelAction | null {
  const separator = data.indexOf(':');
  if (separator <= 0) {
    return null;
  }

  const pressed = strictChannelActionSchema.safeParse({
    kind: data.slice(0, separator),
    pendingActionId: data.slice(separator + 1),
  });

  return pressed.success ? pressed.data : null;
}
