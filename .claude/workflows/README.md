# Workflow scripts

Workflow scripts live in this directory. They run through the Claude Code `Workflow` tool. A script gives deterministic control flow. It uses bounded `for` loops and gates as `if` statements on schema-validated agent output. The project agents in `.claude/agents/` do the work. The script only decides the order.

## Shared rule set

Every script follows these rules. The user runs each step in this list. The agent prepares the exact command and reads the result.

- A script never boots the backend and never touches a running dev instance or its database.
- A script never runs a command against a deployed wiki, a container registry, or an AWS account.
- A script never runs `git push`, `git tag`, or `git commit`.
- A script never uses the `gh` CLI.
- A script never archives an OpenSpec change.
- A script never installs a tool or a dependency.
- A script never puts a secret into a tracked file. A script never prints the contents of `tmp/`, `config.yml`, or a token.

A step on the laptop against the working copy is not a user-run step.

## Local check set

The repair script runs the local check set that `openspec/config.yaml` and the agents name. Each check runs from the repository root. The `cd` in a command applies to that command only.

| id | command | what a pass proves |
|---|---|---|
| `ts-typecheck` | `cd backend && npm run typecheck` | The backend has no type error. |
| `oxlint-backend` | `cd backend && npx oxlint` | The backend has no lint error. |
| `oxlint-frontend` | `cd frontend && npx oxlint` | The frontend has no lint error. |
| `oxfmt-check` | `backend/node_modules/.bin/oxfmt --check <changed files>` | Every changed or untracked source file has the oxfmt format. |
| `frontend-build` | `cd frontend && npm run build` | The frontend builds. Vue templates compile. |
| `blocks-build` | `cd blocks && npm run build` | Every block builds. |
| `schema-migration` | `git status --porcelain -- backend/db/migrations/` | A change to `backend/db/schema.ts` comes with a new, named migration. |
| `locale-json` | `node -e 'JSON.parse(require("fs").readFileSync("backend/locales/en.json","utf8"))'` | The source strings file is valid JSON. |
| `secret-scan` | `git grep -nE 'AKIA[0-9A-Z]{16}\|BEGIN [A-Z ]*PRIVATE KEY' -- ':!package-lock.json'` | No tracked file holds an AWS access key or a private key. A pass prints nothing and exits 1. |
| `untracked-config` | `git ls-files config.yml config.test.yml data-test build.json` | No local configuration file is tracked. A pass prints nothing. |
| `openspec-validate` | `openspec validate --all` | The OpenSpec specs and changes are valid. |

The `\|` in the table stands for a plain `|` in the shell command.

The changed files for `oxfmt-check` are the output of two commands:

```sh
git diff --name-only --diff-filter=d HEAD -- '*.ts' '*.js' '*.mjs' '*.vue'
git ls-files --others --exclude-standard -- '*.ts' '*.js' '*.mjs' '*.vue'
```

### Skipped and advisory checks

- A check is `skipped` when its target does not exist. `oxfmt-check` has no target when no source file changed. `schema-migration` has no target when `backend/db/schema.ts` did not change. The report gives the reason.
- A check is `advisory` when its tool is missing on the machine. A missing tool is never `fail`. The script never installs a tool. It names the install step, for example `npm ci` in the workspace.
- `oxfmt-check` never receives an untouched file. Older files predate oxfmt, and a drive-by reformat is not allowed.
- A check is never reported as passed when it did not run.

## verification-repair.js

This script repairs check failures that already exist in the tree. There is no OpenSpec change. The order is:

1. Audit the full check set and record it to `tmp/verification-audit.txt`.
2. Fix the failing checks with the `code-implementer` agent.
3. Review the fix with the `code-reviewer` agent until no critical issue remains.
4. Re-run the selected checks.

The script repeats steps 2 to 4 in bounded rounds. It stops early when a round removes no failure.

The clean-tree precondition holds when `git status --porcelain` prints nothing. A tree with uncommitted feature work is dirty. Commit or stash that work first, or pass `allowDirtyTree`.

Invoke it with `Workflow({name: "verification-repair", args: {...}})`, or ask the agent to "run the verification-repair workflow". A bare string `args` is a comma-separated list of check ids.

| arg | default | meaning |
|---|---|---|
| `only` (or bare-string `args`) | all checks | Comma-separated check ids to run. An unknown id returns `status: needs-input`, and no agent starts. |
| `maxReviewRounds` | `3` | Cap on the critical-fix loop. When the cap is reached, or a review returns no verdict, the run returns `status: blocked`. |
| `maxFixRounds` | `2` | Cap on the fix loop. When the cap is reached, the run returns `status: done-with-residual-failures`. The value `0` means audit only. The run reports the failing list, makes no edits, and returns `status: audit-only`. |
| `allowDirtyTree` | `false` | Skips the clean-tree precondition. Without it, a dirty tree returns `status: needs-input`. This keeps every fix diff attributable to the run. |

| status | meaning |
|---|---|
| `clean` | The audit found no failing check. |
| `audit-only` | The audit found failures, and `maxFixRounds` is `0`. |
| `done` | The fix rounds removed every failure. |
| `done-with-residual-failures` | Some failures remain after the fix rounds, or a round removed no failure. |
| `blocked` | A review still has a critical issue after `maxReviewRounds`, or a review returned no verdict. |
| `needs-input` | An unknown check id, a dirty tree, or an incomplete audit. |

Some failures need a user decision, for example a new permission, a new dependency, or a migration for a shape whose history is unclear. Such a failure stays failing. The implementer explains why in its report, and the failure lands in `residualFailures`.

## Scripts not carried over

The source of these files is the sibling repository `greensight-wiki`. Its check set covers Docker Compose, Terraform, and shell scripts. This repository holds TypeScript, Vue, and Lit code, so the check set here is different and the script was rewritten around it.

A delivery script for one OpenSpec change can be added later. Until then, the `feature-builder` agent runs the same flow for one change: baseline, implement, review, and the verification gate.
