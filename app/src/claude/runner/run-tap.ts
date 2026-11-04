/**
 * What the runner knows about one attempt of a run that the run trace does not keep: which plugin
 * files the run opened, the text of the CLI's rejections of its result, what it asked GBrain for,
 * and the whole stream of the attempt. Tool calls in the run trace are metadata only (`GAP-07`),
 * and this data is needed to see how the agent works through the Skill and why it reached its
 * conclusion.
 */
export interface AttemptView {
  /**
   * `Read` calls in order: the path relative to the plugin directory (outside the directory, as
   * the model wrote it), a rejected call with the suffix ` [failed]`.
   */
  readonly skillReads: readonly string[];
  /** The texts of schema rejections: redacted and truncated the same way as in the log. */
  readonly rejections: readonly string[];
  /**
   * GBrain tool calls in order, those that ended with a response: the name, whether it succeeded
   * and the arguments as the model passed them. The arguments are the same input the run trace does
   * not keep (`GAP-07`): they show what the run searched for and what it wrote.
   */
  readonly gbrainCalls: readonly GbrainCall[];
  /**
   * The whole stream of the attempt, as SDK messages in order of arrival: the model's text, tool
   * calls with arguments and the responses to them, without the run's secrets. It includes the
   * content of pages read, so the runner collects it only for the subscriber and passes it nowhere
   * else (`GAP-07`).
   */
  readonly transcript: readonly unknown[];
}

/** A GBrain tool call in a run. */
export interface GbrainCall {
  readonly tool: string;
  readonly ok: boolean;
  readonly input: Readonly<Record<string, unknown>>;
}

/**
 * A subscriber to run attempts. In normal operation the App does not attach one: the runner's
 * behavior and log are the same without it, and without one the runner does not collect the
 * attempt's stream. The gate subscribes; the data does not go into the database.
 */
export interface RunTap {
  /**
   * Notifies the subscriber that the attempt has ended. On a retry after `init` drift, the next
   * call with the same `runId` replaces the earlier one.
   */
  attempted(runId: string, view: AttemptView): void;
}

export const RUN_TAP = Symbol('RunTap');
