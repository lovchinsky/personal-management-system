import { readFile } from 'node:fs/promises';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Binding } from './binding';
import { bindingConfig, type BindingConfig } from './binding.config';
import { loadBinding } from './load-binding';

/**
 * The binding is built by the provider factory, not by `onModuleInit`, so whoever injects it
 * receives a model that has already been read, and the order of hooks across modules does not
 * matter.
 */
@Module({
  imports: [ConfigModule.forFeature(bindingConfig)],
  providers: [
    {
      provide: Binding,
      inject: [bindingConfig.KEY],
      useFactory: async ({ file }: BindingConfig): Promise<Binding> =>
        loadBinding(await readFile(file, 'utf8'), file),
    },
  ],
  exports: [Binding],
})
export class NotionBindingModule {}
