import { subcommandOf } from './workspace-command';

describe('the notion command arguments', () => {
  it('accept exactly one subcommand: build, check or template', () => {
    expect(subcommandOf(['build'])).toBe('build');
    expect(subcommandOf(['check'])).toBe('check');
    expect(subcommandOf(['template'])).toBe('template');
  });

  it('are refused with a usage hint when there is no subcommand', () => {
    expect(() => subcommandOf([])).toThrow(/no subcommand\nusage: notion build/);
  });

  it('are refused with a usage hint on an unknown subcommand or an extra argument', () => {
    expect(() => subcommandOf(['init'])).toThrow(/unknown arguments: init\nusage:/);
    expect(() => subcommandOf(['check', '--parent'])).toThrow(/unknown arguments: check --parent/);
  });
});
