import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { canDeliver, telegramConfig, type TelegramConfig } from '../telegram/telegram.config';
import { TelegramModule } from '../telegram/telegram.module';
import { TelegramChannel } from './channels/telegram/telegram.channel';
import { DeliveryService } from './delivery.service';
import { outboxConfig } from './outbox/outbox.config';
import { OutboxRepository } from './outbox/outbox.repository';
import { OutboxWorker } from './outbox/outbox.worker';
import { QuietHours } from './outbox/quiet-hours';
import { quietHoursConfig } from './outbox/quiet-hours.config';
import { NOTIFICATION_CHANNELS } from './port/channel.port';
import { ChannelRegistry } from './port/channel.registry';

/**
 * Delivery from the system to the person: the queue, the channel port and its adapter.
 *
 * The inbound side of the channel — the person's button presses and messages — lives in intake
 * (`intake/channel/`), because delivery and commands are different flows with different owners.
 *
 * Channels are gathered into the registry as a list, not by name in the queue. A queue row keeps
 * the channel name as a string, so a second adapter changes neither the schema nor the stored
 * rows.
 */
@Module({
  imports: [
    ConfigModule.forFeature(outboxConfig),
    ConfigModule.forFeature(telegramConfig),
    ConfigModule.forFeature(quietHoursConfig),
    TelegramModule,
  ],
  providers: [
    DeliveryService,
    OutboxRepository,
    OutboxWorker,
    QuietHours,
    ChannelRegistry,
    TelegramChannel,
    {
      // A channel is in the registry only when it is configured. An empty registry is a
      // legitimate state of an installation, and a queue row addressed to a missing channel moves
      // to `failed` with a named reason instead of endless retries.
      provide: NOTIFICATION_CHANNELS,
      useFactory: (telegram: TelegramConfig, channel: TelegramChannel) => {
        if (!canDeliver(telegram)) {
          new Logger(DeliveryModule.name).warn(
            'no delivery channel configured — notifications will queue and fail with a named reason',
          );

          return [];
        }

        return [channel];
      },
      inject: [telegramConfig.KEY, TelegramChannel],
    },
  ],
  exports: [DeliveryService],
})
export class DeliveryModule {}
