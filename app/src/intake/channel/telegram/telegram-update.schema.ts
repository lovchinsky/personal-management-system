import { z } from 'zod';

/**
 * The part of a Telegram update that decides something.
 *
 * The provider sends many more fields; declaring them all would commit us to a shape we do not
 * control.
 */
const chat = z.object({ id: z.union([z.number(), z.string()]) });

export const telegramUpdateSchema = z.object({
  update_id: z.number(),
  message: z
    .object({
      message_id: z.number(),
      chat,
      text: z.string().optional(),
      /** When the person wrote it, in Unix seconds. */
      date: z.number().optional(),
      /** The message the person replied to: the thread is found by its id. */
      reply_to_message: z.object({ message_id: z.number() }).optional(),
    })
    .optional(),
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().optional(),
      message: z.object({ message_id: z.number(), chat }).optional(),
    })
    .optional(),
});

export type TelegramUpdate = z.infer<typeof telegramUpdateSchema>;

/** Returns the chat the update came from. The second authentication check needs it. */
export function chatIdOf(update: TelegramUpdate): string | undefined {
  const id = update.message?.chat.id ?? update.callback_query?.message?.chat.id;

  return id === undefined ? undefined : String(id);
}
