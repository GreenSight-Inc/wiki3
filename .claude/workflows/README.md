# Workflow scripts

Workflow scripts live in this directory. They run through the Claude Code `Workflow` tool. A script gives deterministic control flow. It uses bounded `for` loops and gates as `if` statements on schema-validated agent output. The project agents in `.claude/agents/` do the work. The script only decides the order.

## Shared rule set

Every script follows these rules. The user runs each step in this list. The agent prepares the exact command and reads the result.

- A script never touches a running dev instance or its database. The repair script never boots the backend at all. The delivery script boots a throwaway instance on its own database, and only when `tasks.md` of the change asks for one.
- A script never runs a command against a deployed wiki, a container registry, or an AWS account.
- A script never runs `git push`, `git tag`, or `git commit`.
- A script never uses the `gh` CLI.
- A script never archives an OpenSpec change.
- A script never installs a tool or a dependency.
- A script never puts a secret into a tracked file. A script never prints the contents of `tmp/`, `config.yml`, or a token.

A step on the laptop against the working copy is not a user-run step.

## Local check set

Both scripts run the local check set that `openspec/config.yaml` and the agents name. Each check runs from the repository root. The `cd` in a command applies to that command only.

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

## feature-delivery-verification-gated.js

This script builds one OpenSpec change. It is the deterministic twin of the `feature-builder` agent. Both follow the same graph with the same caps. Keep them in sync. The order is:

1. Resolve the change and capture the baseline to `tmp/verification-baseline.txt`, in parallel.
2. Implement the unticked tasks with the `code-implementer` agent.
3. Review with the `code-reviewer` agent until no critical issue remains.
4. Run the verification gate on the changed files.
5. Fix the gating failures in bounded rounds. Each round repeats steps 3 and 4.

Without a change name, the script picks the active change with the lowest number prefix that still has an unticked task. When the first task of that change is an unticked `user-run:` gate, the script stops with `status: needs-input` and returns the gate text. A conditional change does not start before its gate records a go.

The working tree can be dirty. The uncommitted code of several changes can share one file. The implementer builds on the lines of its own change and leaves the lines of another change alone. The baseline records `git status --short`, so the report can tell old edits from new ones.

The gate compares each check with the baseline. The changed-file scope is the diff from the merge base with `origin/scarlett`, plus staged, unstaged, and untracked files. A check gates in these cases:

- It passed at baseline and fails now.
- It failed at baseline and now fails differently because of the change.
- It was skipped at baseline, has a target now, and fails.
- It is `oxfmt-check` and it names a file the change touched, even when the format defect is older than the change.

Any other failure that is identical to its baseline never gates the change. The gate runs `blocks-build` only when the scope holds a file under `blocks/`. For a scope of documentation only (`*.md`, `openspec/**`, `.claude/**`), the gate runs `secret-scan`, `untracked-config`, and `openspec-validate` only. The gate adds a throwaway instance test only when `tasks.md` asks for one, and it follows the `throwaway-instance` skill. On a machine without Node.js 26 and without the dev container, that test is advisory.

Invoke it with `Workflow({name: "feature-delivery-verification-gated", args: {...}})`, or ask the agent to "run the feature-delivery-verification-gated workflow". A bare string `args` is the change name.

| arg | default | meaning |
|---|---|---|
| `change` (or bare-string `args`) | `null` (auto-detect) | OpenSpec change name. An unknown name returns `status: needs-input` with the candidates. |
| `maxReviewRounds` | `5` | Cap on the critical-fix loop. When the cap is reached, or a review returns no verdict, the run returns `status: blocked`. |
| `maxFixRounds` | `3` | Cap on the gate-fix loop. When the cap is reached, the run returns `status: done-with-residual-failures`. |

| status | meaning |
|---|---|
| `done` | No critical issue remains and the gate passed against a captured baseline. |
| `done-unverified` | No critical issue remains, but the baseline was not captured or the gate returned no verdict. Nothing is proven. |
| `done-with-residual-failures` | Some gating failures remain after the fix rounds. |
| `blocked` | A review still has a critical issue after `maxReviewRounds`, or a review returned no verdict. |
| `needs-input` | No unambiguous change, an unticked `user-run:` gate as the first task, or a change with every task ticked. |

The script never ticks or runs a `user-run:` task, never commits, and never archives. Commit the change on its own with `git add -p`. The `spec-finalizer` agent archives it.

## verification-repair.js

This script repairs check failures that already exist in the tree. There is no OpenSpec change. It is the sibling of the delivery script. That script gates failures a change adds. This one targets failures the tree already has, and its `blocks-build` check always runs. The order is:

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

## Source of the scripts

The repair script comes from the sibling repository `greensight-wiki`. The delivery script comes from the repository `greensight_agent`. Their check sets cover Docker Compose, Terraform, and shell scripts. This repository holds TypeScript, Vue, and Lit code, so the check set here is different and both scripts were rewritten around it.
