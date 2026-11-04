import { existsSync } from 'node:fs';
import { bindingWorkspaceOf } from '../../../src/notion/workspace/workspace-binding';

/**
 * Checks that the gate integration is not from the main workspace. The workspace is read from the
 * `workspace` key of the main binding, so the main integration's token is not needed. With no
 * binding, or a binding that names no workspace, there is nothing to check against: a fresh
 * installation may not have one, and preparation only logs this.
 */
export function assertNotWorking(
  workingBindingFile: string | undefined,
  gateWorkspace: string,
  log: (line: string) => void,
): void {
  if (workingBindingFile === undefined || !existsSync(workingBindingFile)) {
    log('there is no working binding to compare with: the check of the gate workspace is skipped');

    return;
  }

  const working = bindingWorkspaceOf(workingBindingFile);

  if (working === undefined) {
    log('the working binding names no workspace: the check of the gate workspace is skipped');

    return;
  }

  if (working === gateWorkspace) {
    throw new Error("the gate integration belongs to the working workspace, not to the gate's");
  }
}
