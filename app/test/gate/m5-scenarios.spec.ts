import { S1_WORLD, S6_DECISION, s6World, type World } from './m5-scenarios';

/** Returns what the world Project's anchor remembers; empty if the Project declares no anchor. */
function anchorOf(world: World): readonly string[] {
  const project = world.find((page) => page.type === 'project');

  return project?.type === 'project' ? (project.anchor ?? []) : [];
}

describe('M5 world anchors', () => {
  it('every world that plants an anchor states for itself what the anchor remembers', () => {
    expect(anchorOf(S1_WORLD)).not.toEqual([]);
    expect(anchorOf(s6World('1'))).not.toEqual([]);
  });

  /**
   * A run that sees the decision already stored does not write it a second time, so an anchor that
   * already holds the S6 decision would turn correct behavior into a scenario failure.
   */
  it('the S6 anchor does not hold the decision the scenario expects to be written', () => {
    const anchor = anchorOf(s6World('1')).join(' ').toLowerCase();

    expect(S6_DECISION.toLowerCase()).toContain('ескалац');
    expect(anchor).not.toContain('ескалац');
    expect(anchor).not.toContain('робочих дн');
  });
});
