import { AppError } from './app-error';

class ProbeError extends AppError {}

class RefinedProbeError extends ProbeError {}

describe('AppError', () => {
  it("the error's name is the name of its class, including for a subclass", () => {
    expect(new ProbeError('probe').name).toBe('ProbeError');
    expect(new RefinedProbeError('probe').name).toBe('RefinedProbeError');
  });

  it('the cause stays attached to the error', () => {
    const cause: Error = new Error('underlying');

    expect(new ProbeError('probe', { cause }).cause).toBe(cause);
  });
});
