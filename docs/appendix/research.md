# Appendix: Research, evidence and provenance

In this appendix: twelve sources R1–R12, the limits of evidence and a table of the origin of components. The norm and its rationale live elsewhere: in [`docs/1-methodology.md`](../1-methodology.md) (the domain) and [`contracts/canonical.yaml`](../../contracts/canonical.yaml) (lists of values); the appendix only names the sources and shows which section of the methodology relies on them. Read it when you need to check what a specific claim of the methodology rests on.

## Sources

This methodology is not a clinical protocol and does not claim that each of its architectural decisions is “proven by science”. Part of the system comes directly from research, part is an adaptation of practical methodologies, and part consists of design decisions made for internal logical consistency and real-world use. Below are the sources that specific claims of [`docs/1-methodology.md`](../1-methodology.md) rest on.

### R1 — Getting Things Done

**Source claim.** Getting Things Done officially describes the five steps of the workflow as Capture, Clarify, Organize, Reflect, Engage. GTD also uses Next Actions, Projects, Waiting For, Calendar and Horizons of Focus.

**Source.**

- David Allen, *Getting Things Done: The Art of Stress-Free Productivity*, revised edition.
- Official Getting Things Done materials: “The 5 Steps of GTD”, “Choosing What to Do”.

**In the methodology.** [GTD: the operational foundation](../1-methodology.md#21-gtd-the-operational-foundation), [Why Levels, not Horizons](../1-methodology.md#41-why-levels-not-horizons), [Available Now](../1-methodology.md#119-available-now).

### R2 — OKR

**Source claim.** Classic OKR separates the Objective, as a desired outcome or direction, from the Key Results, as measurable criteria of progress and success.

**Source.**

- John Doerr, *Measure What Matters*.
- What Matters, “What are OKRs?” and materials on writing Objectives and Key Results.

**In the methodology.** [OKR: the language of strategic change](../1-methodology.md#22-okr-the-language-of-strategic-change), [No universal 70% rule](../1-methodology.md#75-no-universal-70-rule).

### R3 — Atomic Habits

**Source claim.** James Clear formulates the Four Laws of Behavior Change as follows: make it obvious, attractive, easy, satisfying; he also stresses identity-based habits and environment design in their own right.

**Source.** James Clear, *Atomic Habits: An Easy & Proven Way to Build Good Habits & Break Bad Ones* (2018).

**In the methodology.** [Atomic Habits: a practical behavioral heuristic](../1-methodology.md#23-atomic-habits-a-practical-behavioral-heuristic), [Level 4 — Identities & Principles](../1-methodology.md#5-level-4--identities--principles), [Four Laws as design heuristics](../1-methodology.md#103-four-laws-as-design-heuristics).

### R4 — CBT for perfectionism

**Source claim.** A systematic review and meta-analysis of cognitive behavior therapy for perfectionism covered 15 randomized controlled trials (N=912) and found medium-to-large effects for several measures of perfectionism, as well as effects on depression/anxiety symptoms. The authors point to limitations, in particular the small number of trials and the lack of active-treatment comparisons.

**Source.** Galloway R., Watson H., Greene D., Shafran R., Egan S. J. (2022). *The efficacy of randomised controlled trials of cognitive behaviour therapy for perfectionism: a systematic review and meta-analysis.* Cognitive Behaviour Therapy, 51(2), 170–184. DOI: 10.1080/16506073.2021.1952302.

**In the methodology.** [CBT and the science of self-regulation](../1-methodology.md#24-cbt-and-the-science-of-self-regulation), [Perfectionism](../1-methodology.md#17-perfectionism).

### R5 — Procrastination interventions

**Source claim.** A meta-analysis of interventions included 24 studies / 44 effects (N=1173); the interventions reduced procrastination, and CBT-oriented approaches had stronger results among the categories compared; the evidence base was relatively small. A systematic review of 27 studies singles out fear of failure, perfectionism and emotion-regulation difficulties among the important factors and describes CBT/motivational strategies as promising; its conclusions concern mainly academic procrastination.

**Source.**

- van Eerde W., Klingsieck K. B. (2018). *Overcoming procrastination? A meta-analysis of intervention studies.* Educational Research Review, 25, 73–85. DOI: 10.1016/j.edurev.2018.09.002.
- Ramadhani E., Setiyosari P., Indreswari H., Setiyowati A. J., Putri R. D. (2026). *Academic procrastination: A systematic review of causal factors and interventions.* Journal of Behavioral and Cognitive Therapy, 36(1), 100552. DOI: 10.1016/j.jbct.2025.100552.

**In the methodology.** [CBT and the science of self-regulation](../1-methodology.md#24-cbt-and-the-science-of-self-regulation), [Procrastination](../1-methodology.md#18-procrastination).

### R6 — Implementation intentions

**Source claim.** A meta-analysis of implementation intentions covered 94 independent tests; the aggregate effect on goal attainment is d≈0.65.

**Source.** Gollwitzer P. M., Sheeran P. (2006). *Implementation Intentions and Goal Achievement: A Meta-analysis of Effects and Processes.* Advances in Experimental Social Psychology, 38, 69–119. DOI: 10.1016/S0065-2601(06)38002-1.

**In the methodology.** [CBT and the science of self-regulation](../1-methodology.md#24-cbt-and-the-science-of-self-regulation), [Implementation intentions](../1-methodology.md#105-implementation-intentions).

### R7 — Goal conflict

**Source claim.** A meta-analysis of 54 independent samples (N=12,470) showed that greater goal conflict is associated with lower positive well-being outcomes and greater distress.

**Source.** Gray J. S., Ozer D. J., Rosenthal R. (2017). *Goal conflict and psychological well-being: A meta-analysis.* Journal of Research in Personality, 66, 27–37. DOI: 10.1016/j.jrp.2016.12.003.

**In the methodology.** [Mode: Advance, Maintain, Minimum](../1-methodology.md#62-mode-advance-maintain-minimum).

### R8 — Goal disengagement / reengagement

**Source claim.** A meta-analytic review of goal adjustment capacities covered 31 samples: goal disengagement, and reengagement in particular, had small positive associations with quality-of-life measures, subject to contextual moderators.

**Source.** Barlow M. A., Wrosch C., McGrath J. J. (2020). *Goal adjustment capacities and quality of life: A meta-analytic review.* Journal of Personality, 88(2), 307–323. DOI: 10.1111/jopy.12492.

**In the methodology.** [Goal adjustment during review](../1-methodology.md#77-goal-adjustment-during-review).

### R9 — Habit formation

**Source claim.** A systematic review and meta-analysis of habit formation covered 20 studies (2601 participants). In the studies that assessed time-to-formation, median estimates were approximately 59–66 days and means 106–154 days, and individual ranges were very wide; most of the included studies had high risk of bias.

**Source.** Singh B., Murphy A., Maher C., Smith A. E. (2024). *Time to Form a Habit: A Systematic Review and Meta-Analysis of Health Behaviour Habit Formation and Its Determinants.* Healthcare, 12(23), 2488. DOI: 10.3390/healthcare12232488.

**In the methodology.** [Behavior Systems, Routines and Habits](../1-methodology.md#10-behavior-systems-routines-and-habits), [Lifecycle and automaticity — different dimensions](../1-methodology.md#101-lifecycle-and-automaticity--different-dimensions).

### R10 — Progress monitoring

**Source claim.** A meta-analysis of the experimental evidence on progress monitoring covered 138 studies (N=19,951). Interventions that increased progress monitoring improved goal attainment; recorded/public monitoring had stronger effects in moderator analyses.

**Source.** Harkin B. et al. (2016). *Does monitoring goal progress promote goal attainment? A meta-analysis of the experimental evidence.* Psychological Bulletin, 142(2), 198–229. DOI: 10.1037/bul0000025.

**In the methodology.** [Tracking](../1-methodology.md#107-tracking), [Behavior System and Tasks](../1-methodology.md#109-behavior-system-and-tasks), [Reflect](../1-methodology.md#125-reflect).

### R11 — Goal adjustment flexibility

**Source claim.** A meta-analytic review of goal adjustment synthesized 235 studies and 1,421 effect sizes. The authors rate the overall accumulated evidence as low-to-moderate because of heterogeneity, cross-sectional designs and publication bias concerns.

**Source.** Riddell H., Sedikides C., Sivaramakrishnan H., et al. (2026; published online 13 November 2025). *A meta-analytic review and conceptual model of the antecedents and outcomes of goal adjustment in response to striving difficulties.* Nature Human Behaviour. DOI: 10.1038/s41562-025-02312-4.

**In the methodology.** [Goal persistence after evidence changes](../1-methodology.md#goal-persistence-after-evidence-changes).

### R12 — Time management

**Source claim.** A meta-analysis showed moderate associations of time management with job performance, academic achievement and wellbeing, and a negative relation with distress. The authors also note that wellbeing effects may be no less important than performance effects.

**Source.** Aeon B., Faber A., Panaccio A. (2021). *Does time management work? A meta-analysis.* PLOS ONE, 16(1), e0245066. DOI: 10.1371/journal.pone.0245066.

**In the methodology.** [Calendar, time and autonomy](../1-methodology.md#15-calendar-time-and-autonomy).

## Limits of evidence

Effects from clinical, student, health or workplace samples do not carry over to just any person without caveats. Meta-analyses aggregate heterogeneous interventions and populations, and the practical effectiveness of a particular personal system depends on context.

So the methodology uses evidence to choose mechanisms but leaves room for personal experimentation and feedback.

## Origin of components

Where each component comes from and what status it has in the system.

| Component | Origin | Status in the system |
|---|---|---|
| Capture | GTD | **Borrowed** — used as a core workflow function |
| Clarify | GTD | **Adapted** — covers classification across Levels |
| Organize | GTD | **Adapted** — works together with the separate Align function |
| Reflect | GTD | **Adapted** — multi-speed reviews |
| Engage | GTD | **Adapted** — Available Now, autonomy, visible-choice management |
| Adapt | feedback/self-regulation + original synthesis | **Original explicit step** |
| Inbox | GTD | **Borrowed** |
| Calendar as hard landscape | GTD | **Borrowed** |
| Waiting For | GTD | **Adapted** — Task status + view |
| Someday/Maybe | GTD | **Adapted** — Task status + view |
| Next Action | GTD | **Adapted** — Task status, progressive elaboration / anti-overclarification |
| Task as Level 0 entity | GTD action logic + original synthesis | **Original architecture** — one execution object with workflow statuses |
| Scheduled Task status | Calendar/tickler logic + original synthesis | **Original formalization** — future-timed Task state, separate from `Deadline` |
| Done / Canceled / Failed Task status | general workflow logic; `Failed` is an original decision with no source | **Integrated** as terminal Task states |
| Project | GTD | **Adapted** — stronger separation from Key Result + Definition of Done + explicit lifecycle statuses + linked Task model |
| Areas of Focus | GTD | **Adapted** — `Mode` is a property of the Area of Focus; the idea of the acceptable state builds up in long-term memory |
| Horizons | GTD | **Not used as architecture** — the system uses Levels |
| Purpose & Principles | GTD | **Adapted** — the same function is implemented through Identities & Principles |
| Vision Level | GTD | **Not used as a separate Level** — its functions are covered by Identities & Principles and Objectives & Key Results |
| Goals | GTD | **Adapted** — the function of strategic change is represented through Objectives & Key Results |
| Objective / Key Result | OKR | **Adapted** — Key Result as evidence, not work |
| 70% stretch-goal convention | some OKR practice | **Rejected as universal rule** |
| Identity-based habits | Atomic Habits | **Adapted** — Identity is broader and less rigid |
| Four Laws | Atomic Habits | **Borrowed as heuristics**, not scientific laws |
| Environment design | Atomic Habits / behavior science | **Integrated** |
| Habit tracking | Atomic Habits + self-monitoring research | **Adapted** — the record is derived from Task instances; manual confirmation only where it changes a decision |
| Universal habit duration | popular habit discourse | **Rejected** |
| Behavior System | original synthesis + habit science | **Original architecture** |
| Routine vs Habit distinction | habit science | **Integrated** — a dimension separate from the Behavior System lifecycle |
| Implementation intentions | self-regulation research | **Integrated selectively** |
| CBT cognitive restructuring | CBT | **Integrated** cross-cutting |
| Behavioral experiments | CBT | **Integrated** |
| Perfectionism protocol elements | CBT | **Integrated selectively** |
| Change Mechanisms Level | original synthesis | **Original** |
| Available Now | GTD Engage + original synthesis | **Original adaptation** |
| Progressive elaboration principle | planning logic + original synthesis | **Core original design rule** |
| Capture broadly / expose selectively | original synthesis | **Core original design rule** |
| Feedback-control architecture | cybernetic/self-regulation logic + original synthesis | **Core architecture** |
