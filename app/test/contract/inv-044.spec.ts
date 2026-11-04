import { pluginEntries, pluginFiles } from './plugin-files';

/** Allowed extensions: behavior is markup, manifest and configuration, not code or data. */
const ALLOWED = /\.(?:md|json)$/;

/** Persistence calls in the Skill text: the plugin writes neither files nor a database. */
const PERSISTENCE =
  /\b(?:writeFile|appendFile|localStorage|sessionStorage|INSERT\s+INTO|CREATE\s+TABLE)\b/i;

/**
 * `INV-044` Plugin stateless.
 *
 * The check is static: the plugin holds only markup and configuration — no state files, scripts or
 * databases — and the Skill text has no persistence calls. State lives in Notion, GBrain and
 * `app_db`, not in the plugin.
 */
describe('INV-044', () => {
  it('the plugin holds only markup and configuration', () => {
    const foreign = pluginEntries().filter(
      (entry) => /\.[a-z0-9]+$/i.test(entry) && !ALLOWED.test(entry),
    );

    expect(foreign).toEqual([]);
  });

  it('the plugin text makes no persistence calls', () => {
    const persisting = pluginFiles()
      .filter((file) => PERSISTENCE.test(file.text))
      .map((file) => file.path);

    expect(persisting).toEqual([]);
  });
});
