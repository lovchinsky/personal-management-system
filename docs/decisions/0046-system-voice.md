# ADR 0046 — The system's voice: how Personal Management System speaks to the person

| | |
|---|---|
| **Status** | Accepted |
| **Decision key** | `D46` |
| **Related** | ADR 0022 · ADR 0027 · ADR 0042 · ADR 0043 · ADR 0049 · `INV-037` · `INV-106` |

## Context

Two authors write to the person: the model (comments in Notion, notification packets and replies in conversation), following the Skill's rules, and the App (system messages, proposal trails and channel replies), from the catalog of the installation's language (ADR 0042). The person skips a text that reads like a report rather than a conversation.

Such a text would come from the rules, not from the model:

- a rule for tool values — ISO dates, names of fields and statuses as the workspace shows them — would, without a stated boundary, carry over into prose, and English field names would land in the middle of a Ukrainian sentence;
- a packet-filling rule that requires explaining how to decide would produce boilerplate under buttons the person sees anyway;
- with only prohibitions and no sample of the voice, the model would choose the tone, and it would be a formal one;
- an App catalog that addressed the owner formally (“ви”) and wrote about them in the third person would read like an official record.

## Decision

**The system speaks to the owner the way someone who knows the owner's system would: briefly, in plain words, in the informal second person (“ти”).**

- **The form of address is “ти”.** It is the product's voice, not a setting: the system belongs to the installation owner.
- **Grammatical gender is an installation setting, set separately for the owner and for the assistant.** `APP_OWNER_GENDER` is the grammatical gender the system uses when it addresses the owner; `APP_ASSISTANT_GENDER` is the grammatical gender the assistant uses when it speaks of itself in the first person (ADR 0049). The values are `masculine`, `feminine` or `neutral`. The default is `neutral`, which means sentences without gender forms (as opposed to “ти схвалив” / “ти схвалила”, ‘you approved’, masculine / feminine), because gender is not guessed. The App uses the owner's gender to choose forms in its catalog; where the catalog speaks in the assistant's first person, it uses no gender forms. The model takes both values from `runtime_read` (`person_gender`, `assistant_gender`). The Skill names them in its sentence about `runtime_read`, not in a separate rule.
- **Dates in words.** In notifications and conversation, dates close to today are relative (“tomorrow”, “on Friday”); in Notion they are absolute but written in ordinary words (“31 October”): a comment is still read a week later. ISO appears only in values that go to tools. The App words the dates it writes to the person with the language's format (`Intl`).
- **Name a status by what it means; name the workspace value when it is the subject of a decision.** The text says “you planned it for Friday” and “still not done”, but “Set it to Waiting For?” and, in a proposal line, “status → Next Action”. A value that is named is always the workspace's label: the rule draws the line not at “is it being decided or not” but at “does the text name the value or describe the state”. A rule that offered meaning and value as alternatives would put the model's own translation in a proposal line in place of the value (“status ‘waiting’ → Done”). A field is called by its plain name in the person's language (“status”, “deadline”); `Date` is called by the meaning its status gives it; a type is called as in the workspace and the methodology (Inbox, Project, Area of Focus).
- **Say what a methodology term means when the workspace does not show it.** The set of Tasks one can start with right away is called **Available Now** in the methodology, the policy, the contracts and the code; the person sees “what you can take on now”.
- **Call a page by its title, in the person's words.** The system calls a page by its title. The title is the person's own words, which is how the person recognizes and looks for the page. The title may be shortened, but a proper name in it may not. A status or `Mode` value is given only as the workspace shows it: the model's own translation is not passed off as the value. The title needs its own rule: “as in the workspace” covers types, fields and statuses, and without a separate rule “say what it means” would paraphrase the title: “the goal with the online course” instead of the Objective's title.
- **The system's mechanics are mentioned only when they change what the person should do, and then in one sentence.**
- **A notification packet reads as one short message** while keeping to the App's three-part packet contract and the channel render. When the only thing to do is decide on proposals, `ask` is the question the buttons answer.
- **The decision trail in a thread is written to the owner directly**, not about the owner in the third person, under the comment's kind label (ADR 0043).
- **Where the rule lives.** The rule is one paragraph in the entry of each surface (run and conversation): every situation reads it. The parts of the Skill say what to show the person; only the entry says how to write it.

**Rejected:**

- **A “naturalness” check in the gate.** A date format can be checked, tone cannot; a mechanical check of part of the voice would give an assurance it does not warrant. The owner judges the voice against samples.
- **Formal address (“ви”) or grammatical gender as part of the choice of language.** Address is the product's character, whereas gender depends on the owner and on the gender the owner wants the assistant to use for itself: gender is a setting, address is not.
- **Gender inferred from a name or pages** — the owner's or the assistant's. A guess goes wrong silently; without the setting, the sentences are neutral.
- **A separate style file for all situations.** It would have to be added to what every mode reads first, next to the entry that everyone reads anyway.
- **Changing the packet contract to “message + question”.** The packet's tone is set by the filling rules, not by the three fields; the render and the packet size check are verified against this contract.

## Consequences

- The entry of each Skill surface carries the voice rule; the first-read limit counts its size (`INV-037`).
- The Ukrainian catalog addresses the owner with “ти” and builds gender forms from the owner's gender. The language's format in `texts/spoken-dates.ts` puts the dates in the App's texts for the person into words. `INV-106` measures the worst-case lengths of the catalog's texts.
- The parts of the Skill say what to show the person (a page, a field, a value, a reason); there is no second voice rule next to the entry.

## Cost

Every new text for the person is written in this voice. No rule checks it; the owner reads it. In the Ukrainian catalog, gender forms are three variants of a text wherever a sentence addresses the owner in the past tense; neutral sentences are a little longer.
