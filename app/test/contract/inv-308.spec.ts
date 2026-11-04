import { skillFiles } from './plugin-files';

/**
 * `INV-308` The Skill refers to a capability, not to a tool name. Tool names differ between the
 * Chat path and the App-triggered path, so a behavior tied to a literal tool name is not
 * reproduced on one of the paths.
 *
 * The check is static: no Skill file in either plugin contains the `mcp__` token. The plugin loader
 * names tools `mcp__plugin_<plugin>_<server>__<tool>`, and a programmatic run names them
 * `mcp__<server>__<tool>`.
 */
describe('INV-308', () => {
  it('the Skill has files, so there is something to check', () => {
    expect(skillFiles().length).toBeGreaterThan(0);
  });

  it('no Skill file contains the `mcp__` token', () => {
    const naming = skillFiles()
      .filter((file) => file.text.includes('mcp__'))
      .map((file) => file.path);

    expect(naming).toEqual([]);
  });
});
