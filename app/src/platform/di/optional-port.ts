import { FactoryProvider, InjectionToken } from '@nestjs/common';

/**
 * Provides a port that takes the adapter if the adapter has substituted itself under its own
 * token, and a fallback otherwise.
 *
 * The dependency runs from the adapter to the port: the port's module does not import the
 * adapter, and a second instance of the module is not needed for it.
 */
export function optionalPort<T>(
  port: InjectionToken,
  adapter: InjectionToken,
  fallback: () => T,
): FactoryProvider<T> {
  return {
    provide: port,
    inject: [{ token: adapter, optional: true }],
    useFactory: (found?: T): T => found ?? fallback(),
  };
}
