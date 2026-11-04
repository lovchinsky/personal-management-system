/**
 * Escapes Telegram markup.
 *
 * The quote is in the list because this same escaper is applied to the value of the `href`
 * attribute, not only to the text of an element. Without it, a link whose path contains a `"`
 * closes the attribute and appends a neighboring attribute to the `<a>`. The markup becomes
 * unparseable, and `parse_mode: HTML` rejects the whole message.
 *
 * The `link` schema does not catch this and does not have to: a quote is a legal character of a
 * URL path (`telegram.renderer.spec`), so the schema screens the protocol there and the markup is
 * kept safe here.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
