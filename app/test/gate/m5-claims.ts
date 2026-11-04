import type { Reading } from '../../src/notion/semantics/reading';
import {
  citedBy,
  cites,
  Claim,
  claimOf,
  deliveries,
  detectionsOf,
  detectionTypes,
  engaged,
  Evidence,
  expectation,
  followUpsRespectLead,
  FORBIDDEN_GBRAIN_WRITES,
  holds,
  MEMORY_RECORD_TOOL,
  mentionsAny,
  newComments,
  Observation,
  observed,
  pageIdOf,
  PageSnapshot,
  ProposedEffect,
  proposedOn,
  sameId,
  statusBefore,
  statusesUnchanged,
  statusOf,
  untouched,
} from './gate-claims';

/**
 * S2: the Project has an alternative path, so the dependency stays `Waiting For` and there is no
 * Project-level risk: no comment on the Project and no notification.
 */
export function alternativePathClaim(evidence: Evidence): Claim {
  return claimOf(
    ...engaged(evidence),
    ...statusesUnchanged(evidence, ['waiting', 'alternative']),
    observed('no proposal rewrites anything', [], evidence.proposals),
    observed('nothing is said on the Project', [], newComments(evidence, 'project')),
    observed('no notification', 0, deliveries(evidence)),
    holds(
      'no Project-level attention label',
      !detectionTypes(evidence).includes('project_integrity'),
    ),
  );
}

/**
 * What the workspace says through the `Blocked` signal (`contracts/canonical.yaml`, key
 * `signals`): the formula returns nothing exactly when there are no unclosed dependencies, so an
 * empty reading means “free” and any value means “blocked” (a boolean `false` is “free” too). An
 * unbound signal is not a degradation and says nothing about agreement; a bound but unreadable one
 * says there is nothing to compare with.
 */
type BlockedFigure =
  | { readonly kind: 'blocked' | 'free' | 'not_bound' }
  | { readonly kind: 'unreadable'; readonly because: string };

export function blockedFigureOf(signal: Reading | undefined): BlockedFigure {
  if (signal === undefined) return { kind: 'not_bound' };

  switch (signal.state) {
    case 'empty':
      return { kind: 'free' };

    case 'value':
      return { kind: signal.value.type === 'flag' && !signal.value.flag ? 'free' : 'blocked' };

    case 'unread':
    case 'absent':
    case 'gap':
    case 'non_canonical':
      return { kind: 'unreadable', because: signal.state };
  }
}

/**
 * S3: a paused Project. The statuses of its Tasks are not rewritten, nothing is proposed, and a
 * time that the pause does not hide is a question to the person on the Project. Only `committed`
 * (a deadline) has a time that the pause does not hide; `checking` is a check date, which the pause
 * legitimately suppresses.
 */
export function pausedProjectClaim(
  evidence: Evidence,
  expected: { readonly commitments: readonly string[] },
): Claim {
  const said = newComments(evidence, 'project');

  return claimOf(
    ...engaged(evidence),
    ...statusesUnchanged(evidence, ['plain', 'checking', 'committed']),
    observed('no proposal rewrites anything', [], evidence.proposals),
    holds(
      'the pause itself is not a dependency or a deadline risk',
      detectionTypes(evidence).every((type) => type !== 'dependency' && type !== 'deadline_risk'),
    ),
    holds(
      'the dated Tasks are put to the person on the Project',
      said.length > 0 && mentionsAny(said, expected.commitments),
    ),
    holds('at most one notification', deliveries(evidence) <= 1),
  );
}

/**
 * S4, first step: a closed Project with unfinished Tasks. One comment on the Project names each of
 * them; no statuses are written and there are no proposals.
 *
 * `obligationNames` are the names of the Tasks the comment must name, and `taskKeys` are the keys
 * of the Tasks whose status must not change: both lists come from the scenario description, not
 * from the world the claim checks.
 */
export function terminalProjectClaim(
  evidence: Evidence,
  expected: { readonly obligationNames: readonly string[]; readonly taskKeys: readonly string[] },
): Claim {
  const said = newComments(evidence, 'project');
  const obligations = expectation(expected.obligationNames, 'unfinished Tasks to be named');
  const named = obligations.filter((name) => mentionsAny(said, [name]));

  return claimOf(
    ...engaged(evidence),
    ...statusesUnchanged(evidence, expectation(expected.taskKeys, 'Tasks to stay unchanged')),
    observed('no proposal before the person answers', [], evidence.proposals),
    observed('one comment on the Project', 1, said.length),
    observed('the comment names every unfinished Task', obligations, named),
    holds(
      'the closed Project is raised as project_integrity',
      detectionTypes(evidence).includes('project_integrity'),
    ),
    holds('at most one notification', deliveries(evidence) <= 1),
    holds(
      'no Task is declared Failed',
      expected.taskKeys.every((key) => statusOf(evidence, key) !== 'Failed'),
    ),
  );
}

/**
 * S4, second step: the person named what each Task becomes. One proposal per Task, each a single
 * status write on that same Task; the proposals do not touch the Project or the done Task.
 */
export function terminalReplyClaim(
  evidence: Evidence,
  expected: {
    readonly outcomes: Readonly<Record<string, string>>;
    readonly untouched: readonly string[];
  },
): Claim {
  const byPage = new Map<string, ProposedEffect[]>();

  for (const proposal of evidence.proposals) {
    for (const effect of proposal.effects) {
      byPage.set(effect.pageId, [...(byPage.get(effect.pageId) ?? []), effect]);
    }
  }

  const named = expectation(Object.entries(expected.outcomes), 'Tasks named by the person');
  const outcomes = named.map(([key, option]) => {
    const id = pageIdOf(evidence, key);
    const effects = [...byPage]
      .filter(([pageId]) => sameId(pageId, id))
      .flatMap(([, list]) => list);

    return observed(
      `${key} gets exactly the named status as its own proposal`,
      [{ propertyId: evidence.statusProperty, option }],
      effects.map((effect) => ({ propertyId: effect.propertyId, option: effect.option })),
    );
  });

  return claimOf(
    ...engaged(evidence),
    observed(
      'one proposal per named Task',
      Object.keys(expected.outcomes).length,
      evidence.proposals.length,
    ),
    holds(
      'each proposal touches a single page',
      evidence.proposals.every(
        (proposal) => new Set(proposal.effects.map((effect) => effect.pageId)).size === 1,
      ),
    ),
    ...outcomes,
    ...expected.untouched.map((key) =>
      observed(`${key} is not proposed on`, [], proposedOn(evidence, key)),
    ),
    ...statusesUnchanged(evidence, [...Object.keys(expected.outcomes), ...expected.untouched]),
  );
}

/**
 * S5: a `Waiting For` Task whose blocker is already `Done` is a contradiction, named with evidence
 * from both sides. The system does not change the status by itself.
 */
export function contradictionClaim(evidence: Evidence): Claim {
  const raised = detectionsOf(evidence, 'contradiction');
  const dependent = pageIdOf(evidence, 'dependent');

  return claimOf(
    ...engaged(evidence),
    ...statusesUnchanged(evidence, ['dependent', 'blocker']),
    holds('a contradiction is raised', raised.length > 0),
    // The two sides of a contradiction make one conclusion: one label that cites both, not two
    // labels with one side each.
    holds(
      'one contradiction cites both the dependent Task and its blocker',
      raised.some(
        (detection) =>
          citedBy(detection, evidence, 'dependent', 'notion') &&
          citedBy(detection, evidence, 'blocker', 'notion'),
      ),
    ),
    holds('the Task is spoken to', newComments(evidence, 'dependent').length >= 1),
    holds(
      'nothing is proposed outside the dependent Task',
      evidence.proposals.every((proposal) =>
        proposal.effects.every((effect) => sameId(effect.pageId, dependent)),
      ),
    ),
    observed('nothing is remembered', [], evidence.gbrainWrites),
  );
}

/**
 * S7: a single failure of a Task does not score the Identity: no write to it or to the Area of
 * Focus, no comment on them, no proposal, no memory write.
 */
export function identityClaim(evidence: Evidence): Claim {
  return claimOf(
    ...engaged(evidence),
    untouched(evidence, 'identity'),
    untouched(evidence, 'area_of_focus'),
    observed('nothing is said on the Identity', [], newComments(evidence, 'identity')),
    observed('nothing is said on the Area of Focus', [], newComments(evidence, 'area_of_focus')),
    observed('no proposal', [], evidence.proposals),
    observed('nothing is remembered', [], evidence.gbrainWrites),
    observed('no notification', 0, deliveries(evidence)),
    holds(
      'no self-regulation claim',
      detectionTypes(evidence).every(
        (type) => type !== 'behavior_system_friction' && type !== 'area_of_focus_risk',
      ),
    ),
  );
}

/**
 * T2b: an Area of Focus in a healthy `Maintain` with no Objective: no Objective is proposed for
 * it, nothing changes, and nothing is said on the Area of Focus, because there is nothing to add
 * to a healthy Area of Focus.
 */
export function healthyAreaOfFocusClaim(evidence: Evidence): Claim {
  return claimOf(
    ...engaged(evidence),
    untouched(evidence, 'area_of_focus'),
    observed('nothing is said on the Area of Focus', [], newComments(evidence, 'area_of_focus')),
    observed('no proposal', [], evidence.proposals),
    observed('no notification', 0, deliveries(evidence)),
  );
}

/**
 * T2c: the system does not read Key Result evidence by itself. Based on what the person says, it
 * writes nothing to the Objective or the Key Result and proposes nothing. The person replied from
 * the channel, so the question to them (whether to carry on or to change the Objective) is sent as
 * a notification: at most one.
 */
export function unreadableEvidenceClaim(evidence: Evidence): Claim {
  return claimOf(
    ...engaged(evidence),
    untouched(evidence, 'objective'),
    untouched(evidence, 'result'),
    observed('no proposal', [], evidence.proposals),
    holds('at most one notification', deliveries(evidence) <= 1),
  );
}

/** The steps of flow S1: each is evidence of one run or of one decision by the person. */
export interface DependencySlice {
  /** An event changed the Task to `Waiting For`: the system notices the dependency. */
  readonly detection: Evidence;
  /** The person replied in the thread: the system proposes and does not write. */
  readonly reply: Evidence;
  /** The person approved, the executor wrote. */
  readonly approval: {
    readonly proposalStatus: string;
    readonly task: PageSnapshot;
    readonly bot: string;
  };
  /** The continuation came due: it reads again and wakes no one. */
  readonly recheck: Evidence;
  /** The thread is resolved: the closure; `null` when the step is not done (a person is needed). */
  readonly closure: Evidence | null;
}

/**
 * A flow step that needs the person: the person resolves the thread, and Notion does not let the
 * thread be resolved through the API.
 */
export const UNOBSERVED_CLOSURE = 'closure of the resolved thread';

/**
 * Builds the observations for the first step of the flow: the system noticed the dependency, said
 * so in the thread and set a follow-up.
 */
function raisedObservations(detection: Evidence): Observation[] {
  const dependencies = detectionsOf(detection, 'dependency');

  return [
    ...engaged(detection),
    ...statusesUnchanged(detection, ['waiting']),
    holds('the dependency is raised', dependencies.length > 0),
    // The label rests on the Task the run read; the detector must read the Project but not cite it
    // in the same label.
    holds(
      'the dependency rests on the Task the run read',
      dependencies.some((item) => citedBy(item, detection, 'waiting', 'notion')),
    ),
    holds('the run cites the Project it read', cites(detection, 'project', 'notion')),
    observed('one comment in the Task thread', 1, newComments(detection, 'waiting').length),
    holds(
      'a follow-up is set, no sooner than an hour after the run began',
      detection.continuations.length >= 1 && followUpsRespectLead(detection),
    ),
    holds('at most one notification', deliveries(detection) <= 1),
    observed('nothing proposed before the person speaks', [], detection.proposals),
    holds(
      'the anchor page of the project in GBrain is cited as evidence',
      cites(detection, 'project', 'gbrain'),
    ),
  ];
}

/**
 * S1, first step: the dependency the deadline depends on must be named. This is a separate claim
 * for a flow that breaks off here, because without the thread and the follow-up there is nothing
 * to continue with.
 */
export function dependencyRaisedClaim(detection: Evidence): Claim {
  return claimOf(...raisedObservations(detection));
}

/**
 * S1: the end-to-end dependency flow, in this order: detection, discussion, follow-through, the
 * person's reply, approval, recheck and closure.
 */
export function dependencySliceClaim(slice: DependencySlice): Claim {
  const { detection, reply, approval, recheck, closure } = slice;
  const claim = claimOf(
    ...raisedObservations(detection),

    // 2. The person's reply.
    ...engaged(reply),
    observed('the reply run proposes exactly one change', 1, reply.proposals.length),
    observed(
      'it is a single status write of the waiting Task: Done',
      [{ propertyId: reply.statusProperty, option: 'Done' }],
      reply.proposals.flatMap((proposal) =>
        proposal.effects
          .filter((effect) => sameId(effect.pageId, pageIdOf(reply, 'waiting')))
          .map((effect) => ({ propertyId: effect.propertyId, option: effect.option })),
      ),
    ),
    observed(
      'the proposal touches one page only',
      1,
      new Set(
        reply.proposals.flatMap((proposal) => proposal.effects.map((effect) => effect.pageId)),
      ).size,
    ),
    observed(
      'the status is not written before approval',
      statusBefore(reply, 'waiting'),
      statusOf(reply, 'waiting'),
    ),

    // 3. Approval and the executor.
    observed('the proposal was executed', 'executed', approval.proposalStatus),
    observed('the Task reads Done', 'Done', approval.task.status),

    // 4. The recheck.
    ...engaged(recheck),
    observed('the recheck does not notify', 0, deliveries(recheck)),
    observed('the recheck sets no further follow-up', [], recheck.continuations),
    observed('the Task is still Done after the recheck', 'Done', statusOf(recheck, 'waiting')),

    // 5. Closure, only when the person has resolved the thread.
    ...(closure === null
      ? []
      : [
          ...engaged(closure),
          observed('no comment in the closed thread', [], newComments(closure, 'waiting')),
          observed('nothing proposed', [], closure.proposals),
          observed(
            'no direct write to GBrain',
            [],
            closure.gbrainWrites.filter((tool) => FORBIDDEN_GBRAIN_WRITES.includes(tool)),
          ),
          observed('the status does not move', 'Done', statusOf(closure, 'waiting')),
        ]),
  );

  // The person closes the resolved thread: without the person the step is unobserved, not empty.
  return closure === null ? { ...claim, unobserved: [UNOBSERVED_CLOSURE] } : claim;
}

/**
 * S6: closure of a thread in which the person made a decision that must influence what follows.
 * The closure is a memory write by an App intent, with no direct writes to GBrain, no comment and
 * no changes in Notion. The trace does not say that the decision itself was recorded, so what is
 * proven is the applied write.
 */
export function closureDecisionClaim(evidence: Evidence): Claim {
  const remembered = evidence.gbrainWrites.filter((tool) => tool === MEMORY_RECORD_TOOL);

  return claimOf(
    ...engaged(evidence),
    // The trace does not keep the content of the write (`GAP-07`), so what is proven is the applied
    // write, not that the decision itself was recorded.
    holds('a memory entry was recorded', remembered.length >= 1),
    observed(
      'no direct write to GBrain',
      [],
      evidence.gbrainWrites.filter((tool) => FORBIDDEN_GBRAIN_WRITES.includes(tool)),
    ),
    observed('no comment in the closed thread', [], newComments(evidence, 'task')),
    observed('no proposal', [], evidence.proposals),
    observed('no notification', 0, deliveries(evidence)),
    ...statusesUnchanged(evidence, ['task']),
  );
}
