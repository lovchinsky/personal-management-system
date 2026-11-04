import { DynamicModule, Type, ValueProvider } from '@nestjs/common';
import { ConfigFactory, ConfigModule } from '@nestjs/config';
import { Binding, bindingOf } from '../../src/notion/binding/binding';
import { BindingFile } from '../../src/notion/binding/binding.schema';
import { VALID_BINDING_FILE } from './notion-mapping.fixture';

/**
 * Configures a test module with the same config namespaces as in the application, each from its
 * owner module, but only from the lane's environment. A test does not read `.env`.
 */
export function testConfig(...namespaces: ConfigFactory[]): Promise<DynamicModule> {
  return ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: namespaces });
}

/** Provides a binding from the file `file`, a real one as the application produces it. */
export function bindingProvider(file: BindingFile = VALID_BINDING_FILE): ValueProvider<Binding> {
  return { provide: Binding, useValue: bindingOf(file, 'fixture') };
}

/**
 * Provides a dependency that the check does not reach. The module is assembled, and the empty
 * value says that none of its methods is needed here.
 */
export function unreached(token: Type<unknown>): ValueProvider<object> {
  return { provide: token, useValue: {} };
}
