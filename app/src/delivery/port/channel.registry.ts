import { Inject, Injectable } from '@nestjs/common';
import { NOTIFICATION_CHANNELS, type NotificationChannel } from './channel.port';

/**
 * Channels by name.
 *
 * The queue keeps the channel name as a string, not as a reference to an implementation: a string
 * survives a restart, and adding a second channel changes neither the schema nor the stored rows.
 * A provider is not an authority on state and can be replaced.
 */
@Injectable()
export class ChannelRegistry {
  private readonly byId: ReadonlyMap<string, NotificationChannel>;

  constructor(@Inject(NOTIFICATION_CHANNELS) channels: readonly NotificationChannel[]) {
    this.byId = new Map(channels.map((channel) => [channel.id, channel]));
  }

  /**
   * `undefined` means the queue row addresses a channel this installation does not have. That is a
   * state of the configuration, and the row must go to `failed` with a reason rather than
   * silently disappear.
   */
  find(id: string): NotificationChannel | undefined {
    return this.byId.get(id);
  }

  /**
   * Checks whether the installation has any channel configured: without one, there is no way to
   * speak to the person.
   */
  any(): boolean {
    return this.byId.size > 0;
  }
}
