# Mary Code

**AI sounds convincing even when it's wrong.**

Mary is a task harness for developers and non-developers, designed to keep an AI's mistaken judgment from becoming a bottleneck for the entire task.

In work that requires reliable evidence and verification—such as checking legal citations or developing a product—Mary keeps important AI judgments bounded by evidence and verification while preserving autonomy for reversible actions.

Factual claims are checked against evidence you can inspect. Reversible work proceeds autonomously. You are asked to confirm points open to interpretation and decisions that are high-impact or hard to reverse.

Mary's next goal is to prevent an early mistake from hardening through the rest of the work. When a premise breaks, Mary will trace the decisions that depended on it and reopen only what must be reconsidered. *(In development.)*

## How it works

Mary runs each task through six stages, from risk assessment to verification and record-keeping. The AI drafts first; you confirm points open to interpretation and decisions that are high-impact or hard to reverse.

```text
0. Risk check       Identifies hard-to-reverse actions and how results will be verified
1. Goal             Defines the desired outcome and completion conditions
2. Alternatives     Compares distinct approaches and how each one could fail
3. Safe execution   Starts with reversible work and holds irreversible actions
4. Verification     Checks evidence, finds counterexamples, fixes, and re-verifies
5. Learning log     Records failures and raises repeated ones as rule candidates
```

**In development — Decision retrace engine**

When a broken premise is found, Mary traces only the decisions that depended on it and re-examines as much as necessary without erasing the history.

## When to use it

To use Mary reliably, call it directly in Claude Code.

```text
/mary
```

A direct call runs Mary's full procedure regardless of task size.

Mary is also designed to activate automatically for requests such as:

- Actions that are hard to undo, including deleting, overwriting, external sending, and deployment
- Multi-step work where an earlier judgment affects later results
- Work where factual accuracy determines the outcome, including statutes, figures, and product specifications

Automatic activation depends on Claude's judgment and may be missed. If you need Mary with certainty, call `/mary` directly.

Mary is not applied to simple one-shot requests such as questions, explanations, translations, and lookups. Running a heavy procedure on every task would only encourage people to bypass it.

### Task grades

Mary assigns a grade according to the task's risk level.

| Grade | Applies to | Handling |
|---|---|---|
| **Standard** | Reversible, low-impact work | The AI proceeds autonomously and performs the necessary verification |
| **Guarded** | Irreversible actions, legal, employment, tax, high-cost, or hard-to-reverse design decisions | Factual claims must be checked against observable evidence; important judgments and irreversible actions require your confirmation |

Guarded work does not reduce the AI's exploration or the diversity of its options. It strengthens only the evidence and approval required before a decision is finalized.

## Why this order

AI can silently lock an ambiguous request into one interpretation, fixate on its first answer, and report results it never produced as if they were real.

Mary therefore defines the goal and completion conditions first, compares different approaches, and starts with what is reversible. It then verifies the result with actual evidence, searches for counterexamples, fixes confirmed problems, and verifies again.

A counterexample from another LLM provides a separate perspective, not independent verification. Independent evidence must be checkable outside the model's own claims, such as actual execution, tests, measurements, primary sources, or confirmation from an authorized reviewer.

The existence of evidence and whether that evidence actually supports the claim are checked separately.

The stage-by-stage failure types and their detailed mapping are documented in [`LAYERS.md`](./LAYERS.md).

## Installation

Mary requires **Claude Code** and **Node.js** (for the enforcement hook). It ships as a plugin
containing one skill (the workflow) and one hook (the irreversible-action gate).

### macOS / Linux

```bash
git clone https://github.com/a01078794-arch/mary-code.git ~/.claude/skills/mary-code
```

### Windows PowerShell

```powershell
git clone https://github.com/a01078794-arch/mary-code.git "$HOME\.claude\skills\mary-code"
```

Plugins in `~/.claude/skills/` auto-load on the next session as `mary-code@skills-dir`.
Verify with `claude plugin validate ~/.claude/skills/mary-code`.

If you do not use Git, select **Code → Download ZIP** on GitHub and extract it to that path.

## Enforcement boundary — read this before trusting the gate

Mary's gate runs as a `PreToolUse` hook. It classifies irreversible actions (delete, overwrite,
external send, deploy, business-system write) and escalates them to a user permission prompt
instead of letting the agent proceed. It is **fail-closed**: if the hook cannot parse its input
or crashes, it asks rather than allows.

**How strongly that gate is enforced depends entirely on where you install it.**

| Tier | Install location | Can the agent disable it? |
|---|---|---|
| **1 · Default** | `~/.claude/skills/mary-code/` | **Yes.** The agent can reach these files with `Bash` and can set `disableAllHooks` in user or project settings. |
| **2 · Hardened** | Same files, force-enabled from managed settings | **No.** `disableAllHooks` in user/project/local settings cannot disable managed hooks. |

Tier 1 is **not a trust boundary.** It is a speed bump that makes bypass visible rather than
silent — the gate also fires when something tries to edit the gate's own configuration. That is
useful, and it is not the same as enforcement. Do not describe a Tier 1 install as "enforced".

To reach Tier 2, add to managed settings — `C:\Program Files\ClaudeCode\managed-settings.json`
on Windows, `/etc/claude-code/managed-settings.json` on Linux,
`/Library/Application Support/ClaudeCode/managed-settings.json` on macOS:

```json
{
  "enabledPlugins": ["mary-code@skills-dir"],
  "allowManagedHooksOnly": true
}
```

Writing to those paths requires administrator privileges, which is exactly what puts them
outside the agent's reach. `allowManagedHooksOnly` additionally blocks every user, project, and
other-plugin hook, so enable it only if you want Mary's gate to be the only hook running.

**Even at Tier 2, Mary is a harness only within its declared observation scope**: registered
tool calls. Whether a task is multi-step, or whether a factual judgment drives the outcome,
remains a semantic decision that no external dispatcher can fully make.

### Running

In Claude Code, type:

```text
/mary
```

On the first run, Mary automatically creates `RULES.md`, `FAILLOG.md`, and `_work.md` in `~/.claude/mary/`. There is nothing to write or configure in advance.

## Design principles

- **Think freely, commit strictly.** Exploration remains open, but important conclusions require evidence.
- **Keep reversible work autonomous.** Only ambiguous, high-impact, or hard-to-reverse decisions are brought to you.
- **Separate facts from judgment.** Facts are checked against evidence; judgments state their premises and what would overturn them.
- **A counterexample from another LLM is not evidence.** It provides a separate perspective; verification comes from execution, tests, measurements, and primary sources.
- **Sessions are disposable; files are assets.** Failures persist across sessions, and only repeated problems become rules with your approval. Incorrect rules can be revised or removed.

### Current limitations

Mary has the AI draft first to reduce your burden. This is convenient, but it can anchor you to the frame created by the AI.

The mechanism for confirming your key conditions before the AI makes a recommendation in Guarded work has not yet been implemented.

## Files

The plugin has five parts. They must be installed together.

| File | Role |
|---|---|
| `skills/mary/SKILL.md` | Mary's task procedure |
| `skills/mary/LAYERS.md` | AI failure types and their canonical keys |
| `hooks/hooks.json` | Registers the `PreToolUse` gate |
| `scripts/hooks/mary-irreversible-gate.js` | The gate itself — classifies irreversible actions, fail-closed |
| `.claude-plugin/plugin.json` | Plugin manifest |

On the first run, Mary creates three record files in `~/.claude/mary/`.

| File | Role |
|---|---|
| `RULES.md` | Rules you approved and facts previously confirmed |
| `FAILLOG.md` | Observed failures, rejected counterexamples, and repeat counts |
| `_work.md` | The single task currently in progress |

These record files remain on your computer and are not pushed to the GitHub repository. You do not need to create or configure them yourself.

## How it learns from failures

Mary does not discard failures when a task ends.

1. It records the failure and checkable evidence in `FAILLOG.md`.
2. When the same failure occurs in two different tasks, it becomes a new rule candidate.
3. Mary shows you the proposed one-line rule and the two supporting cases.
4. Only a rule you approve is added to `RULES.md`.
5. An incorrect rule can later be revised or removed.

Rejected counterexamples remain in the record but do not count toward rule promotion. Records are compressed rather than deleted so the history remains auditable.

> `FAILLOG.md` shows only failures discovered in tasks where Mary ran. It is not a complete statistic of every failure the AI actually caused.

## Development status

**Current version: rv.1.5 · Experimental**

Working now:

- Six-stage task procedure
- Standard and Guarded risk grades
- Evidence verification → counterexample → fix → re-verification
- Failure logging and rule promotion
- Automatic matching to the user's language
- **Irreversible-action gate as an enforced `PreToolUse` hook** — classifies delete/overwrite/send/deploy/business-system-write, escalates to a user prompt, fail-closed
- **Approval ledger** (`~/.claude/mary/approvals.jsonl`) — binds each approval to its execution result; unresolved approvals are reported at the next session start as `unknown` (never auto-retried)

In development:

- **Decision retrace engine** *(specification complete · implementation in progress)*  
  When a premise is invalidated, Mary traces only the decisions that depended on it and re-examines as much as necessary.

Before a stable release:

- Validate Mary on 5–10 real product, legal, and research tasks
- Confirm that a fresh session seeing Mary for the first time follows the same procedure
- Verify installation and execution on macOS
- Measure how often automatic activation is missed or applied unnecessarily
- Test the Decision retrace engine against its defined counterexample scenarios

Later:

- Installation methods for Codex and ChatGPT
- A read-only critique agent
- Criteria for ending and restarting long sessions
- Image and PDF verification procedures

## Support Mary

If Mary helps you with real work, please consider giving this repository a ⭐ **Star**.

Stars are optional and do not affect installation, use, or available features.
