import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CredentialsModule } from '../credentials/credentials.module';
import { RUN_LAUNCHER_ADAPTER } from '../runs/run.launcher';
import { CLAUDE_QUERY, sdkQuery } from './runner/claude-query';
import { ClaudeRunner } from './runner/claude-runner';
import { PLUGIN_DIGEST, pluginDigest } from './runner/plugin-digest';
import { runnerConfig } from './runner/runner.config';

/**
 * Runner of App-triggered runs.
 *
 * Global because it substitutes itself for the launch port of `runs/`: the dispatcher does not
 * know the runner exists. Available only behind the `RUNNER_ENABLED` switch (ADR 0013).
 */
@Global()
@Module({
  imports: [CredentialsModule, ConfigModule.forFeature(runnerConfig)],
  providers: [
    ClaudeRunner,
    { provide: CLAUDE_QUERY, useValue: sdkQuery },
    { provide: PLUGIN_DIGEST, useValue: pluginDigest },
    { provide: RUN_LAUNCHER_ADAPTER, useExisting: ClaudeRunner },
  ],
  exports: [RUN_LAUNCHER_ADAPTER],
})
export class ClaudeModule {}
