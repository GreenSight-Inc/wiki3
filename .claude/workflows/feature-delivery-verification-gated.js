export const meta = {
  name: 'feature-delivery-verification-gated',
  description:
    'Build an OpenSpec change: implement -> review loop, then the local verification gate on the changed files with bounded fix rounds',
  whenToUse:
    'Deterministic delivery of one OpenSpec change in the wiki3 repository with the local verification gate (backend type check, oxlint for backend and frontend, oxfmt on changed files, frontend build, blocks build, schema migration, locale JSON, secret scan, untracked config, openspec validate, and a throwaway instance test only when tasks.md asks for one). Never touches a running dev instance, its database, a deployed wiki, a container registry, or AWS, and never commits.',
  phases: [
    {
      title: 'Resolve',
      detail: 'resolve OpenSpec change + capture verification baseline (parallel)'
    },
    {
      title: 'Implement',
      detail: 'code-implementer: initial pass, critical fixes, fix-only passes'
    },
    { title: 'Review', detail: 'code-reviewer: bounded critical-issue loop' },
    { title: 'Verify', detail: 'local verification gate on changed files versus the baseline' }
  ]
}

// ---- Parameters (all overridable via args) ----
// args is the bare change id when invoked via a slash command, or an options object.
const CHANGE_HINT =
  (typeof args === 'string' && args.trim() !== '' ? args.trim() : null) ?? args?.change ?? null
const MAX_REVIEW_ROUNDS = args?.maxReviewRounds ?? 5
const MAX_FIX_ROUNDS = args?.maxFixRounds ?? 3
const BASELINE_PATH = 'tmp/verification-baseline.txt'
const BASE_BRANCH = 'origin/scarlett'

// The fixed local check set. Each entry holds the command, the expected result, the target (a missing
// target gives "skipped"), the tool (a missing tool gives "advisory"), and the install step.
// It is the same list that openspec/config.yaml and the agents in .claude/agents/ name.
const CHANGED_FILES =
  "{ git diff --name-only --diff-filter=d HEAD -- '*.ts' '*.js' '*.mjs' '*.vue'; " +
  "git ls-files --others --exclude-standard -- '*.ts' '*.js' '*.mjs' '*.vue'; }"
const CHECKS = [
  {
    id: 'ts-typecheck',
    command: 'cd backend && npm run typecheck',
    expected: 'exit 0 and no error line after the tsc banner',
    target: 'backend/tsconfig.json',
    tool: 'backend/node_modules/.bin/tsc',
    install: 'cd backend && npm ci (the user runs it)'
  },
  {
    id: 'oxlint-backend',
    command: 'cd backend && npx oxlint',
    expected: 'exit 0',
    target: 'backend/.oxlintrc.json',
    tool: 'backend/node_modules/.bin/oxlint',
    install: 'cd backend && npm ci (the user runs it)'
  },
  {
    id: 'oxlint-frontend',
    command: 'cd frontend && npx oxlint',
    expected: 'exit 0',
    target: 'frontend/.oxlintrc.json',
    tool: 'frontend/node_modules/.bin/oxlint',
    install: 'cd frontend && npm ci (the user runs it)'
  },
  {
    id: 'oxfmt-check',
    command: 'backend/node_modules/.bin/oxfmt --check $(' + CHANGED_FILES + ')',
    expected: 'exit 0. A listed file has a format issue and is a fail.',
    target:
      'at least one changed or untracked .ts, .js, .mjs, or .vue file. Run the file-list command first. When it prints nothing, the check has no target. Never pass an untouched file',
    tool: 'backend/node_modules/.bin/oxfmt',
    install: 'cd backend && npm ci (the user runs it)'
  },
  {
    id: 'frontend-build',
    command: 'cd frontend && npm run build',
    expected: 'exit 0. It writes to assets/, which Git ignores.',
    target: 'frontend/vite.config.js',
    tool: 'frontend/node_modules/.bin/vite',
    install: 'cd frontend && npm ci (the user runs it)'
  },
  {
    id: 'blocks-build',
    command: 'cd blocks && npm run build',
    expected: 'exit 0. It writes to blocks/compiled/, which Git ignores.',
    target: 'blocks/rollup.config.mjs',
    tool: 'blocks/node_modules/.bin/rollup',
    install: 'cd blocks && npm ci (the user runs it)'
  },
  {
    id: 'schema-migration',
    command: 'git status --porcelain -- backend/db/migrations/',
    expected:
      'prints at least one new directory, and its name does not end in _scarlett. No new directory is a fail.',
    target:
      'a change to backend/db/schema.ts. Run "git diff --name-only HEAD -- backend/db/schema.ts" first. When it prints nothing, the check has no target',
    tool: 'git',
    install: 'xcode-select --install'
  },
  {
    id: 'locale-json',
    command: 'node -e \'JSON.parse(require("fs").readFileSync("backend/locales/en.json","utf8"))\'',
    expected: 'prints nothing and exits 0',
    target: 'backend/locales/en.json',
    tool: 'node',
    install: 'install Node.js'
  },
  {
    id: 'secret-scan',
    command: "git grep -nE 'AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' -- ':!package-lock.json'",
    expected:
      'prints nothing and exits 1. A printed line is a possible secret and is a fail. Exit 2 or higher is a fail too.',
    target: 'a Git repository at the root (.git/)',
    tool: 'git',
    install: 'xcode-select --install'
  },
  {
    id: 'untracked-config',
    command: 'git ls-files config.yml config.test.yml data-test build.json',
    expected: 'prints nothing. A printed path is a tracked local file and is a fail.',
    target: 'a Git repository at the root (.git/)',
    tool: 'git',
    install: 'xcode-select --install'
  },
  {
    id: 'openspec-validate',
    command: 'openspec validate --all',
    expected: 'exit 0',
    target: 'openspec/',
    tool: 'openspec',
    install: 'npm install -g @fission-ai/openspec (the user runs it)'
  }
]

const CHECK_SET = CHECKS.map(
  (c) =>
    '  ' +
    c.id +
    ':\n' +
    '    command:  ' +
    c.command +
    '\n' +
    '    expected: ' +
    c.expected +
    '\n' +
    '    target:   ' +
    c.target +
    ' (when it does not exist, report "skipped" and say why)\n' +
    '    tool:     ' +
    c.tool +
    ' (when it is missing, report "advisory" and name the install step: ' +
    c.install +
    ')\n'
).join('')

const SAFETY_RULES =
  'Never touch a running dev instance or its database. Never run npm run db-up. ' +
  'Never run a command against a deployed wiki, a container registry, or an AWS account. ' +
  'Never run git push, git tag, or git commit. Never use the gh CLI. Never archive an OpenSpec change. ' +
  'Prepare such a step as an exact command for the user and do not run it. ' +
  'Never put a password, API key, access token, OAuth client secret, or private key into a tracked file. '

const CHECK_RULES =
  'Rules for every check: run it from the repository root. The cd in a command applies to that command only. ' +
  'Record the exact command, the exit code, and the output. Trim output over 60 lines to the first and last 20 lines. ' +
  'A missing tool is not a failure of the change. Do NOT install anything and do NOT run npm install or npm ci. ' +
  'Report the check as "advisory" and name the install step. ' +
  'A missing target is not a failure either. Report that check as "skipped" and say why. ' +
  'For oxfmt-check, run the file-list command first, pass only the files it prints, and record the command you actually ran. ' +
  'Run oxfmt-check from the root, because oxfmt refuses a path with two dots. ' +
  'The two builds write only to assets/ and blocks/compiled/, which Git ignores. Leave both in place. ' +
  'The default admin login admin@example.com with password 12345678 is a public development default, not a secret. ' +
  'Never report a check as "pass" when it did not run. ' +
  SAFETY_RULES +
  'Never print the contents of tmp/, config.yml, or any token. '

const REPO_RULES =
  'the repository rules in CLAUDE.md, the workspace CLAUDE.md files, the matching rule files in .claude/rules/, and openspec/config.yaml: ' +
  '(a) a committed stored shape changes only through a named migration, a never-committed shape gets no shim, and no existing migration is edited, ' +
  '(b) no invented permission name and no new global permission, ' +
  '(c) a page rule permission is checked in the handler, never in config.permissions, ' +
  '(d) a sensitive module prop is masked at the API boundary, ' +
  '(e) backend imports carry the .ts extension, type-only imports say import type, and only erasable syntax is used, ' +
  '(f) no es-toolkit/compat, no ESLint or Prettier, no backend build step, no :host-context() in a block, ' +
  '(g) no reformat of an untouched file and no change to dev/helm/, ' +
  '(h) nothing from the Do not add list in openspec/config.yaml'

// The working tree can hold uncommitted code of several changes in the same files (see CLAUDE.md, section GreenSight fork).
const SHARED_TREE_NOTE =
  'The working tree can hold uncommitted code of more than one OpenSpec change, and some files carry lines of several changes. ' +
  'Work out which lines belong to this change from its proposal, design, and tasks under openspec/changes/. ' +
  'Leave the lines of another change alone. '

// ---- Structured-output schemas ----
const RESOLVE_SCHEMA = {
  type: 'object',
  required: ['change'],
  properties: {
    change: { type: ['string', 'null'] },
    candidates: { type: 'array', items: { type: 'string' } },
    untickedTasks: { type: 'integer' },
    userRunGate: { type: ['string', 'null'] },
    note: { type: 'string' }
  }
}

const CHECK_RESULT = {
  type: 'object',
  required: ['id', 'status'],
  properties: {
    id: { type: 'string' },
    status: { enum: ['pass', 'fail', 'advisory', 'skipped'] },
    command: { type: 'string' },
    exitCode: { type: ['integer', 'null'] },
    note: { type: 'string' }
  }
}

const BASELINE_SCHEMA = {
  type: 'object',
  required: ['captured', 'checks'],
  properties: {
    captured: { type: 'boolean' },
    path: { type: 'string' },
    checks: { type: 'array', items: CHECK_RESULT },
    note: { type: 'string' }
  }
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['summary', 'criticalIssues', 'warnings', 'suggestions'],
  properties: {
    summary: { type: 'string' },
    criticalIssues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'detail'],
        properties: {
          title: { type: 'string' },
          detail: { type: 'string' },
          file: { type: 'string' },
          line: { type: 'integer' },
          priority: { type: 'integer' }
        }
      }
    },
    warnings: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } }
  }
}

const GATE_SCHEMA = {
  type: 'object',
  required: ['verdict', 'scope', 'checks', 'failing'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    scope: { type: 'array', items: { type: 'string' } },
    documentationOnly: { type: 'boolean' },
    instanceTestRan: { type: 'boolean' },
    checks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'status', 'baselineStatus', 'gating'],
        properties: {
          id: { type: 'string' },
          status: { enum: ['pass', 'fail', 'advisory', 'skipped'] },
          baselineStatus: { enum: ['pass', 'fail', 'advisory', 'skipped', 'unknown'] },
          gating: { type: 'boolean' },
          command: { type: 'string' },
          exitCode: { type: ['integer', 'null'] },
          note: { type: 'string' }
        }
      }
    },
    failing: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'command', 'output', 'reason'],
        properties: {
          id: { type: 'string' },
          command: { type: 'string' },
          output: { type: 'string' },
          file: { type: 'string' },
          reason: {
            enum: [
              'new-failure',
              'changed-failure',
              'new-target-failure',
              'touched-file-format',
              'instance-failure'
            ]
          }
        }
      }
    },
    notes: { type: 'string' }
  }
}

// ---- Phase: Resolve - change resolution and baseline capture are
// independent DAG nodes, so they run in parallel (a genuine barrier:
// implementation needs BOTH results). ----
const [resolved, baseline] = await parallel([
  () =>
    agent(
      'Resolve the target OpenSpec change for implementation in the wiki3 repository. ' +
        'The changes under openspec/changes/ carry a number prefix, and the prefix is the apply order. ' +
        (CHANGE_HINT
          ? 'The caller asked for change "' +
            CHANGE_HINT +
            '". Verify that it exists with "openspec list --json" and use it. ' +
            'If no active change has that exact name, do NOT substitute another. Return change: null and list the candidates. '
          : 'Run "openspec list --json". If exactly one active change exists, pick it. ' +
            'If several exist, pick the one with the lowest number prefix that still has an unticked task in its tasks.md. ' +
            'If no active change has an unticked task, return change: null and list the candidates. ') +
        'Then read openspec/changes/<change>/tasks.md. Set untickedTasks to the number of "- [ ]" lines. ' +
        'If the FIRST task in the file is unticked and starts with the marker "user-run:", it is a go or no-go gate that only the user can run. ' +
        'Set userRunGate to the full text of that task. Otherwise set userRunGate to null. ' +
        'Do not edit any file. Return the structured result only.',
      { label: 'resolve-change', phase: 'Resolve', schema: RESOLVE_SCHEMA, effort: 'low' }
    ),
  () =>
    agent(
      'Capture the pre-implementation verification baseline for the wiki3 repository. ' +
        'First record the output of "git status --short", so a later report can tell old edits from new ones. ' +
        'The tree can hold uncommitted work. That is expected. Do not stash it and do not change it. ' +
        'Then run every check in this set, in this order:\n' +
        CHECK_SET +
        CHECK_RULES +
        '\n' +
        'Write the combined record to ' +
        BASELINE_PATH +
        '. Start with the git status output. Then write one block per check with the id, command, exit code, and output. ' +
        'Create tmp/ when it does not exist. Git ignores it. ' +
        'Report captured: true only when you wrote the file and every check ran, or was advisory for a missing tool, or was skipped for a missing target. ' +
        'Report the per-check status list. A check that fails here is a PRE-EXISTING failure. Report it plainly. ' +
        'It gates this change only under the oxfmt-check rule for touched files.',
      { label: 'baseline', phase: 'Resolve', schema: BASELINE_SCHEMA, effort: 'low' }
    )
])

if (!resolved || !resolved.change) {
  return {
    status: 'needs-input',
    reason: 'no unambiguous OpenSpec change to build',
    candidates: resolved?.candidates ?? [],
    notes: resolved?.note ?? ''
  }
}
const change = resolved.change
if (resolved.userRunGate) {
  // A conditional change does not start before its gate records a go.
  return {
    status: 'needs-input',
    change,
    reason:
      'the first task of this change is a user-run gate that is not ticked - the user runs it and records go or no-go first',
    userRunGate: resolved.userRunGate
  }
}
if (resolved.untickedTasks === 0) {
  return {
    status: 'needs-input',
    change,
    reason:
      'every task of this change is ticked - nothing to build. Use the spec-finalizer agent to verify, sync, and archive it.'
  }
}
const baselineCaptured = baseline?.captured === true
const baselineFailing = (baseline?.checks ?? []).filter((c) => c.status === 'fail').map((c) => c.id)
log(
  'Using change: ' +
    change +
    '; baseline ' +
    (baselineCaptured
      ? 'captured (' +
        (baseline.checks ?? []).length +
        ' checks, pre-existing failures: ' +
        (baselineFailing.length ? baselineFailing.join(', ') : 'none') +
        ')'
      : 'UNAVAILABLE - gate degrades to advisory')
)

const SCOPE =
  'the union of "git diff --name-only $(git merge-base ' +
  BASE_BRANCH +
  ' HEAD)..HEAD", staged, unstaged, and untracked files, ' +
  'excluding anything under tmp/, assets/, and blocks/compiled/'

// ---- Shared helper: bounded review -> fix loop (used after the initial
// implementation AND after every fix-only pass). Returns {ok, review}. ----
const reviewUntilClean = async (tag) => {
  let review = null
  for (let i = 1; i <= MAX_REVIEW_ROUNDS; i++) {
    review = await agent(
      'Review ALL changes made for OpenSpec change "' +
        change +
        '" in this working tree. ' +
        'Inspect "git status", "git diff $(git merge-base ' +
        BASE_BRANCH +
        ' HEAD)..HEAD", staged, unstaged, and untracked files. ' +
        'Ignore everything under tmp/, assets/, and blocks/compiled/. ' +
        'The scope is the work of this run plus the uncommitted work that the change builds on. ' +
        SHARED_TREE_NOTE +
        'A line of another change is out of scope, unless it breaks this change. Record such a case in warnings. ' +
        'Read the proposal, the delta spec, the design, and the tasks under openspec/changes/' +
        change +
        '/ and check the code against them. ' +
        'Review priorities, highest first. Secret safety. Then ' +
        REPO_RULES +
        '. ' +
        'Then API schema correctness, locale strings, and documentation accuracy. ' +
        'Apply your standard severity rubric and return the structured verdict. criticalIssues contains ONLY findings you rate Critical.',
      {
        agentType: 'code-reviewer',
        label: 'review:' + tag + ':' + i,
        phase: 'Review',
        schema: REVIEW_SCHEMA
      }
    )
    // A missing verdict (agent error / schema-validation failure) is a blocker,
    // never a clean pass - this loop is the run's main correctness guard.
    if (!review) return { ok: false, review: null }
    const criticals = review.criticalIssues ?? []
    if (criticals.length === 0) return { ok: true, review }
    if (i === MAX_REVIEW_ROUNDS) break
    log(criticals.length + ' critical issue(s) on ' + tag + ' round ' + i + ' - delegating fixes')
    await agent(
      'Fix ONLY these critical review findings for OpenSpec change "' +
        change +
        '". Keep diffs minimal and follow ' +
        REPO_RULES +
        ':\n' +
        JSON.stringify(criticals, null, 2) +
        '\n' +
        SHARED_TREE_NOTE +
        'A finding can need a user decision, for example a new global permission or a new dependency. Do not guess. Leave it in place and explain why in your report. ' +
        SAFETY_RULES +
        'Report the files you touched and the checks you ran with their real output.',
      { agentType: 'code-implementer', label: 'fix:' + tag + ':' + i, phase: 'Implement' }
    )
  }
  return { ok: false, review }
}

// ---- Phase: Implement (initial pass) ----
await agent(
  'Implement all remaining unticked tasks for OpenSpec change "' +
    change +
    '" in the wiki3 repository. Leave ticked tasks alone. ' +
    'Read "git status --short" and "git diff" first, and build on the implementation that the working tree already holds. ' +
    SHARED_TREE_NOTE +
    'Read the workspace CLAUDE.md and the matching rule file under .claude/rules/ for every file you edit, before the first edit. ' +
    'Keep diffs minimal and follow ' +
    REPO_RULES +
    '. ' +
    'For a stored shape change, edit backend/db/schema.ts, run "npm run db-generate -- --name=<kebab-name>" in backend/, and read the generated SQL. ' +
    'If a route needs a global permission that does not exist, stop that task and put the question for the maintainer in your report. ' +
    'A task that starts with the marker "user-run:" belongs to the user. Do not run it and do not tick it. Put its exact command in your report. ' +
    'A throwaway instance is allowed only when tasks.md asks for one. Follow .claude/skills/throwaway-instance/SKILL.md, use its own database, and tear it down. ' +
    'It needs Node.js 26. When "node --version" is older and no dev container is available, leave that task unticked and say so. ' +
    'Tick a task only after its check passes with real output. ' +
    SAFETY_RULES +
    'Report the files you touched, the checks you ran by id with their real output, the user-run commands, and the residual risks.',
  { agentType: 'code-implementer', label: 'implement', phase: 'Implement' }
)

// ---- Phase: Review (critical-issue loop, cap MAX_REVIEW_ROUNDS) ----
let lastCleanReview = null
const firstReview = await reviewUntilClean('initial')
if (!firstReview.ok) {
  return {
    status: 'blocked',
    change,
    reason:
      'critical issues remain (or a review returned no verdict) after ' +
      MAX_REVIEW_ROUNDS +
      ' review rounds',
    lastReview: firstReview.review
  }
}
lastCleanReview = firstReview.review

// ---- Phase: Verify (gate + bounded fix loop, cap MAX_FIX_ROUNDS) ----
const gatePrompt = (round) =>
  'Run the local verification gate for OpenSpec change "' +
  change +
  '" in the wiki3 repository (gate run ' +
  round +
  '). Procedure:\n' +
  '(1) Compute the changed-file scope as ' +
  SCOPE +
  '.\n' +
  '(2) If the scope holds only documentation (*.md, openspec/**, .claude/**), run secret-scan, untracked-config, and openspec-validate only. ' +
  'Set documentationOnly: true and mark every other check "skipped".\n' +
  '(3) Otherwise run every check in this set. Run blocks-build only when the scope holds a file under blocks/. Otherwise mark it "skipped".\n' +
  CHECK_SET +
  CHECK_RULES +
  '\n' +
  '(4) Compare each result with the baseline at ' +
  BASELINE_PATH +
  '. The orchestrator reports it captured: ' +
  baselineCaptured +
  '. Pre-existing failures: ' +
  (baselineFailing.length ? baselineFailing.join(', ') : 'none') +
  '. ' +
  'A check gates when it passed at baseline and fails now (reason "new-failure"). ' +
  'A check gates when it failed at baseline and now fails differently because of this change (reason "changed-failure"). ' +
  'A check gates when it was skipped at baseline, has a target now, and fails, because the change created the target (reason "new-target-failure"). ' +
  'oxfmt-check gates on every file the change touched, even when the format defect is older than the change (reason "touched-file-format"). ' +
  'Any other check that fails identically to its baseline does NOT gate. An advisory check never gates.\n' +
  '(5) Add a throwaway instance test only when openspec/changes/' +
  change +
  '/tasks.md asks for one. ' +
  'Follow .claude/skills/throwaway-instance/SKILL.md: its own database, config.test.yml, port 3010, and the teardown. ' +
  'Always run the teardown, even after a failure. Never use the dev instance or its database. Treat a failure as gating (reason "instance-failure"). ' +
  'The instance needs Node.js 26. When "node --version" is older and no dev container is available, ' +
  'report the test as "advisory" under the id "throwaway-instance", say why, and put the steps for the user in notes. ' +
  'When tasks.md asks for no instance test, do not boot the backend at all.\n' +
  '(6) If the baseline was not captured, treat every finding as advisory: verdict pass, findings in notes.\n' +
  'The verdict is fail when at least one check gates. Otherwise the verdict is pass. ' +
  'For each gating failure include the exact command, its output, and the file it points at. ' +
  'Return the structured verdict. Never report a check as passed when it did not run.'

let residual = null
let lastGate = null
let fixRoundsUsed = 0
for (let r = 0; r <= MAX_FIX_ROUNDS; r++) {
  lastGate = await agent(gatePrompt(r + 1), {
    label: 'gate:' + (r + 1),
    phase: 'Verify',
    schema: GATE_SCHEMA
  })
  if (!lastGate || lastGate.verdict === 'pass') break
  const failing = lastGate.failing ?? []
  if (r === MAX_FIX_ROUNDS) {
    residual = failing
    log(
      'verification gate still failing after ' +
        MAX_FIX_ROUNDS +
        ' fix round(s) - accepting with residual failures'
    )
    break
  }
  fixRoundsUsed = r + 1
  log('verification gate FAIL (' + failing.length + ' check(s)) - fix round ' + (r + 1))
  await agent(
    'FIX-ONLY pass for OpenSpec change "' +
      change +
      '". Make exactly these failing local checks pass. ' +
      'Do not expand scope, add capability, or change behavior beyond the fix:\n' +
      JSON.stringify(failing, null, 2) +
      '\n' +
      'PROHIBITED as a way to clear the gate: adding a secret-scan exclusion, weakening or removing a check command, switching off an oxlint rule, ' +
      'adding a prettier-ignore marker without a written reason, casting to any to hide a type error, editing an existing migration, ' +
      'reformatting a file that the change did not touch, adding a dependency, or changing a tsconfig or oxlint configuration file. ' +
      'For an oxfmt-check failure, run backend/node_modules/.bin/oxfmt on exactly the files the check listed, from the repository root. ' +
      'For a schema-migration failure, run "npm run db-generate -- --name=<kebab-name>" in backend/ with a name that says what the migration does, and read the generated SQL. ' +
      'When a secret-scan hit is a real secret, move the value to a file that .gitignore lists and leave a placeholder. Never print the value. ' +
      SHARED_TREE_NOTE +
      SAFETY_RULES +
      'Re-run each failing command yourself and report its real output. ' +
      'Some failures need a user decision, for example a new permission, a new dependency, or a migration for a shape whose history is unclear. ' +
      'Do not guess. Leave such a failure in place and explain why in your report.',
    { agentType: 'code-implementer', label: 'fix-gate:' + (r + 1), phase: 'Implement' }
  )
  const fixReview = await reviewUntilClean('fix-gate-' + (r + 1))
  if (!fixReview.ok) {
    return {
      status: 'blocked',
      change,
      reason:
        'fix round ' +
        (r + 1) +
        ' has critical issues (or no review verdict) after ' +
        MAX_REVIEW_ROUNDS +
        ' review rounds',
      lastReview: fixReview.review
    }
  }
  lastCleanReview = fixReview.review
}

// ---- Final report (assembled deterministically in-script - no extra agent) ----
// A gate with no verdict, or one that ran without a baseline, proves nothing. It must NOT read as "done".
const unverified = !lastGate || !baselineCaptured
return {
  status: residual ? 'done-with-residual-failures' : unverified ? 'done-unverified' : 'done',
  change,
  baseline: {
    captured: baselineCaptured,
    path: BASELINE_PATH,
    preExistingFailures: baselineFailing
  },
  gate: {
    verdict: lastGate?.verdict ?? 'skipped',
    scope: lastGate?.scope ?? [],
    documentationOnly: lastGate?.documentationOnly ?? false,
    instanceTestRan: lastGate?.instanceTestRan ?? false,
    fixRoundsUsed,
    checks: lastGate?.checks ?? [],
    notes: lastGate?.notes ?? ''
  },
  residualFailures: residual ?? [],
  warnings: lastCleanReview?.warnings ?? [],
  suggestions: lastCleanReview?.suggestions ?? [],
  reminder:
    'This workflow never touches a running dev instance, its database, a deployed wiki, a container registry, or AWS, never runs git push, git tag, or git commit, and never archives an OpenSpec change. The user runs every task marked user-run:. Commit the change on its own, with only its own lines (git add -p). Use the spec-finalizer agent to verify, sync, and archive it.'
}
