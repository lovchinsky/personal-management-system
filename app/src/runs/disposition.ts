/**
 * The result of concluding a run row with the run's conclusion.
 *
 * Three answers, not two. `closed` is a conclusion and `lost` is a lost lease. `superseded` is
 * neither: the work was done and finished, but the row under it changed, so the conclusion is no
 * longer complete. A boolean would conflate `superseded` with `lost` and force a choice between
 * staying silent about a real loss and warning about ordinary operation.
 */
export type Disposition = 'closed' | 'superseded' | 'lost';
