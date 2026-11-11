export const meta = {
  name: 'verification-repair',
  description: 'Audit the full local check set on the current tree (no OpenSpec change), then drive pre-existing check failures to green through bounded code-implementer and code-reviewer fix rounds',
  whenToUse: 'Standalone repair of local check failures that already exist in the wiki3 repository (backend type check, oxlint for backend and frontend, oxfmt on changed files, frontend build, blocks build, schema migration, locale JSON, secret scan, untracked config, openspec validate). No OpenSpec change. Never touches a running dev instance, a database, a deployed wiki, a container registry, or AWS, and never commits.',
  phases: [
    { title: 'Audit', detail: 'clean-tree check + full local check set, recorded to tmp/verification-audit.txt' },
    { title: 'Implement', detail: 'code-implementer: fix-only passes + critical fixes' },
    { title: 'Review', detail: 'code-reviewer: bounded critical-issue loop per fix round' },
    { title: 'Verify', detail: 're-run the selected checks after each fix round' },
  ],
}

// ---- Parameters (all overridable via args) ----
// args is an optional comma-separated check-id filter when given as a bare string, or an options object.
const RAW_ONLY = typeof args === 'string' ? args : args?.only
const ONLY = typeof RAW_ONLY === 'string' && RAW_ONLY.trim() !== ''
  ? RAW_ONLY.split(',').map(s => s.trim()).filter(Boolean)
  : (Array.isArray(RAW_ONLY) ? RAW_ONLY : null)
const MAX_REVIEW_ROUNDS = args?.maxReviewRounds ?? 3
const MAX_FIX_ROUNDS = args?.maxFixRounds ?? 2
const ALLOW_DIRTY_TREE = args?.allowDirtyTree ?? false
const AUDIT_PATH = 'tmp/verification-audit.txt'

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
    install: 'cd backend && npm ci (the user runs it)',
  },
  {
    id: 'oxlint-backend',
    command: 'cd backend && npx oxlint',
    expected: 'exit 0',
    target: 'backend/.oxlintrc.json',
    tool: 'backend/node_modules/.bin/oxlint',
    install: 'cd backend && npm ci (the user runs it)',
  },
  {
    id: 'oxlint-frontend',
    command: 'cd frontend && npx oxlint',
    expected: 'exit 0',
    target: 'frontend/.oxlintrc.json',
    tool: 'frontend/node_modules/.bin/oxlint',
    install: 'cd frontend && npm ci (the user runs it)',
  },
  {
    id: 'oxfmt-check',
    command: 'backend/node_modules/.bin/oxfmt --check $(' + CHANGED_FILES + ')',
    expected: 'exit 0. A listed file has a format issue and is a fail.',
    target: 'at least one changed or untracked .ts, .js, .mjs, or .vue file. Run the file-list command first. When it prints nothing, the check has no target. Never pass an untouched file',
    tool: 'backend/node_modules/.bin/oxfmt',
    install: 'cd backend && npm ci (the user runs it)',
  },
  {
    id: 'frontend-build',
    command: 'cd frontend && npm run build',
    expected: 'exit 0. It writes to assets/, which Git ignores.',
    target: 'frontend/vite.config.js',
    tool: 'frontend/node_modules/.bin/vite',
    install: 'cd frontend && npm ci (the user runs it)',
  },
  {
    id: 'blocks-build',
    command: 'cd blocks && npm run build',
    expected: 'exit 0. It writes to blocks/compiled/, which Git ignores. In this workflow the check always runs.',
    target: 'blocks/rollup.config.mjs',
    tool: 'blocks/node_modules/.bin/rollup',
    install: 'cd blocks && npm ci (the user runs it)',
  },
  {
    id: 'schema-migration',
    command: 'git status --porcelain -- backend/db/migrations/',
    expected: 'prints at least one new directory, and its name does not end in _scarlett. No new directory is a fail.',
    target: 'a change to backend/db/schema.ts. Run "git diff --name-only HEAD -- backend/db/schema.ts" first. When it prints nothing, the check has no target',
    tool: 'git',
    install: 'xcode-select --install',
  },
  {
    id: 'locale-json',
    command: "node -e 'JSON.parse(require(\"fs\").readFileSync(\"backend/locales/en.json\",\"utf8\"))'",
    expected: 'prints nothing and exits 0',
    target: 'backend/locales/en.json',
    tool: 'node',
    install: 'install Node.js',
  },
  {
    id: 'secret-scan',
    command: "git grep -nE 'AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' -- ':!package-lock.json'",
    expected: 'prints nothing and exits 1. A printed line is a possible secret and is a fail. Exit 2 or higher is a fail too.',
    target: 'a Git repository at the root (.git/)',
    tool: 'git',
    install: 'xcode-select --install',
  },
  {
    id: 'untracked-config',
    command: 'git ls-files config.yml config.test.yml data-test build.json',
    expected: 'prints nothing. A printed path is a tracked local file and is a fail.',
    target: 'a Git repository at the root (.git/)',
    tool: 'git',
    install: 'xcode-select --install',
  },
  {
    id: 'openspec-validate',
    command: 'openspec validate --all',
    expected: 'exit 0',
    target: 'openspec/',
    tool: 'openspec',
    install: 'npm install -g @fission-ai/openspec (the user runs it)',
  },
]

const KNOWN_CHECKS = CHECKS.map(c => c.id)
if (ONLY) {
  const unknown = ONLY.filter(id => !KNOWN_CHECKS.includes(id))
  if (unknown.length) {
    return {
      status: 'needs-input',
      reason: 'unknown check id(s): ' + unknown.join(', ') + ' - valid ids: ' + KNOWN_CHECKS.join(', '),
    }
  }
}
const SELECTED = ONLY ?? KNOWN_CHECKS

const CHECK_SET = CHECKS.map(c =>
  '  ' + c.id + ':\n' +
  '    command:  ' + c.command + '\n' +
  '    expected: ' + c.expected + '\n' +
  '    target:   ' + c.target + ' (when it does not exist, report "skipped" and say why)\n' +
  '    tool:     ' + c.tool + ' (when it is missing, report "advisory" and name the install step: ' + c.install + ')\n',
).join('')

const SAFETY_RULES =
  'Never boot the backend. Never touch a running dev instance or its database. Never run npm run db-up. ' +
  'Never run a command against a deployed wiki, a container registry, or an AWS account. ' +
  'Never run git push, git tag, or git commit. Never use the gh CLI. Never archive an OpenSpec change. ' +
  'Prepare such a step as an exact command for the user and do not run it. ' +
  'Never put a password, API key, access token, OAuth client secret, or private key into a tracked file. '

const CHECK_RULES =
  'Rules for every check: run it from the repository root. The cd in a command applies to that command only. ' +
  'Record the exact command, the exit code, and the output. Trim output over 60 lines to the first and last 20 lines. ' +
  'A missing tool is not a repository failure. Do NOT install anything and do NOT run npm install or npm ci. ' +
  'Report the check as "advisory" and name the install step. ' +
  'A missing target is not a failure either. Report that check as "skipped" and say why. ' +
  'For oxfmt-check, run the file-list command first, pass only the files it prints, and record the command you actually ran. ' +
  'Run oxfmt-check from the root, because oxfmt refuses a path with two dots. ' +
  'The two builds write only to assets/ and blocks/compiled/, which Git ignores. Leave both in place. ' +
  'The default admin login admin@example.com with password 12345678 is a public development default, not a secret. ' +
  'Never report a check as "pass" when it did not run. ' +
  SAFETY_RULES +
  'Never print the contents of tmp/, config.yml, or any token. '

// ---- Structured-output schemas ----
const FAILING_ITEM = {
  type: 'object',
  required: ['id', 'command', 'output'],
  properties: {
    id: { type: 'string' },
    command: { type: 'string' },
    output: { type: 'string' },
    file: { type: 'string' },
    reason: { enum: ['pre-existing', 'still-failing', 'new-failure'] },
  },
}

const CHECK_RESULT = {
  type: 'object',
  required: ['id', 'status'],
  properties: {
    id: { type: 'string' },
    status: { enum: ['pass', 'fail', 'advisory', 'skipped'] },
    command: { type: 'string' },
    exitCode: { type: ['integer', 'null'] },
    note: { type: 'string' },
  },
}

const AUDIT_SCHEMA = {
  type: 'object',
  required: ['cleanTree', 'captured', 'checks', 'failing'],
  properties: {
    cleanTree: { type: 'boolean' },
    captured: { type: 'boolean' },
    path: { type: 'string' },
    checks: { type: 'array', items: CHECK_RESULT },
    failing: { type: 'array', items: FAILING_ITEM },
    notes: { type: 'string' },
  },
}

const RECHECK_SCHEMA = {
  type: 'object',
  required: ['verdict', 'checks', 'failing'],
  properties: {
    verdict: { enum: ['pass', 'fail'] },
    checks: { type: 'array', items: CHECK_RESULT },
    failing: { type: 'array', items: FAILING_ITEM },
    notes: { type: 'string' },
  },
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
          priority: { type: 'integer' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
}

// ---- Phase: Audit ----
const audit = await agent(
  'AUDIT mode for the verification-repair workflow in the wiki3 repository. Procedure:\n' +
  '(1) Compute cleanTree. Run "git status --porcelain". ' +
  'cleanTree is true when it prints nothing, and false when it prints anything. ' +
  'When the root is not a Git repository at all, cleanTree is false. Say so in notes. ' +
  'cleanTree is report-only. Compute it and report it, but run the audit anyway. ' +
  'The orchestrator enforces the clean-tree policy. It runs with allowDirtyTree: ' + (ALLOW_DIRTY_TREE === true) + '.\n' +
  '(2) Run ONLY these checks from the set below, in this order: ' + SELECTED.join(', ') + '. ' +
  'Mark every other check in the set "skipped".\n' + CHECK_SET + CHECK_RULES + '\n' +
  '(3) Write the combined record to ' + AUDIT_PATH + '. Write one block per check with the id, command, exit code, and output. ' +
  'Create tmp/ when it does not exist. Git ignores it. ' +
  'Set captured to true only when you wrote the file and every selected check ran, or was advisory for a missing tool, or was skipped for a missing target.\n' +
  '(4) Set failing to every selected check with status "fail". Give each one reason "pre-existing", the exact command, its output, and the file it points at. ' +
  'Return the structured result.',
  { label: 'audit', phase: 'Audit', schema: AUDIT_SCHEMA, effort: 'low' },
)

if (!audit) {
  return {
    status: 'needs-input',
    reason: 'audit agent produced no verdict (agent error) - re-run',
  }
}
if (!audit.cleanTree && !ALLOW_DIRTY_TREE) {
  return {
    status: 'needs-input',
    reason: 'working tree is not clean - commit or stash first so fix diffs and reviews stay attributable to this run, or re-run with args.allowDirtyTree: true.',
    notes: audit.notes ?? '',
  }
}
if (audit.captured !== true) {
  // An empty failing list from a run where nothing ran must NOT read as "clean".
  return {
    status: 'needs-input',
    reason: 'audit did not run to completion; nothing is proven clean',
    notes: audit.notes ?? '',
  }
}

const initialFailing = audit.failing ?? []
log('audit: ' + SELECTED.length + ' check(s) selected, ' + initialFailing.length + ' failing, ' +
  (audit.checks ?? []).filter(c => c.status === 'advisory').length + ' advisory, ' +
  (audit.checks ?? []).filter(c => c.status === 'skipped').length + ' skipped')

const gateSummary = (verdict, roundsUsed, checks, notes) => ({
  verdict,
  fixRoundsUsed: roundsUsed,
  selected: SELECTED,
  checks: checks ?? [],
  notes: notes ?? '',
})

if (initialFailing.length === 0) {
  return {
    status: 'clean',
    audit: { captured: true, path: AUDIT_PATH },
    gate: gateSummary('pass', 0, audit.checks, audit.notes),
    residualFailures: [],
  }
}

if (MAX_FIX_ROUNDS < 1) {
  return {
    status: 'audit-only',
    audit: { captured: true, path: AUDIT_PATH },
    gate: gateSummary('fail', 0, audit.checks, audit.notes),
    residualFailures: initialFailing,
  }
}

const REPO_RULES =
  'the repository rules in CLAUDE.md, the workspace CLAUDE.md files, and openspec/config.yaml: ' +
  '(a) a committed stored shape changes only through a named migration, and no existing migration is edited, ' +
  '(b) no invented permission name and no new global permission, ' +
  '(c) a page rule permission is checked in the handler, never in config.permissions, ' +
  '(d) a sensitive module prop is masked at the API boundary, ' +
  '(e) backend imports carry the .ts extension, type-only imports say import type, and only erasable syntax is used, ' +
  '(f) no es-toolkit/compat, no ESLint or Prettier, no backend build step, no :host-context() in a block, ' +
  '(g) no reformat of an untouched file and no change to dev/helm/'

// ---- Shared helper: bounded review -> fix loop. Returns {ok, review}.
// A null review (agent error / schema failure) is a BLOCKER, never a clean pass. ----
const reviewUntilClean = async (tag) => {
  let review = null
  for (let i = 1; i <= MAX_REVIEW_ROUNDS; i++) {
    review = await agent(
      'Review ALL uncommitted changes in this working tree. Use "git status", "git diff", and the untracked files. ' +
      'Ignore everything under tmp/, assets/, and blocks/compiled/. A FIX-ONLY verification-repair pass produced these changes. ' +
      (audit.cleanTree === true
        ? 'The tree was clean before the run, so every change belongs to this run. '
        : 'NOTE: this run started on a dirty tree (allowDirtyTree). Some edits are older than the run. Attribute to this run only the edits that touch the failing checks. Record the ambiguity in warnings. ') +
      'Review priorities, highest first. Secret safety. Then ' + REPO_RULES + '. ' +
      'Then behavior preservation: a fix pass changes nothing in the backend, the frontend, or the blocks beyond the fix. ' +
      'Then NO weakened check: no new secret-scan exclusion, no removed or relaxed check command, no oxlint rule switched off, no prettier-ignore marker without a reason, no cast to any that hides a type error. ' +
      'Apply your standard severity rubric and return the structured verdict. criticalIssues contains ONLY findings you rate Critical.',
      { agentType: 'code-reviewer', label: 'review:' + tag + ':' + i, phase: 'Review', schema: REVIEW_SCHEMA },
    )
    if (!review) return { ok: false, review: null }
    const criticals = review.criticalIssues ?? []
    if (criticals.length === 0) return { ok: true, review }
    if (i === MAX_REVIEW_ROUNDS) break
    log(criticals.length + ' critical issue(s) on ' + tag + ' round ' + i + ' - delegating fixes')
    await agent(
      'Fix ONLY these critical review findings from the verification-repair pass. Keep diffs minimal and keep behavior the same:\n' +
      JSON.stringify(criticals, null, 2) + '\n' +
      SAFETY_RULES +
      'Report the files you touched and the checks you ran with their real output.',
      { agentType: 'code-implementer', label: 'fix:' + tag + ':' + i, phase: 'Implement' },
    )
  }
  return { ok: false, review }
}

// ---- Phases: Implement / Review / Verify (bounded fix loop) ----
let residual = null
let lastGate = null
let lastCleanReview = null
let fixRoundsUsed = 0
let currentFailing = initialFailing

for (let r = 1; r <= MAX_FIX_ROUNDS; r++) {
  fixRoundsUsed = r
  log('fix round ' + r + ': ' + currentFailing.length + ' check(s) failing')
  await agent(
    'FIX-ONLY verification-repair pass. Make exactly these failing local checks pass. ' +
    'Do not expand scope, add capability, or change behavior beyond the fix:\n' +
    JSON.stringify(currentFailing, null, 2) + '\n' +
    'PROHIBITED: adding a secret-scan exclusion, weakening or removing a check command, switching off an oxlint rule, ' +
    'adding a prettier-ignore marker without a written reason, casting to any to hide a type error, editing an existing migration, ' +
    'reformatting a file that the failing check does not name, adding a dependency, or changing a tsconfig or oxlint configuration file. ' +
    'For an oxfmt-check failure, run backend/node_modules/.bin/oxfmt on exactly the files the check listed, from the repository root. ' +
    'For a schema-migration failure, run "npm run db-generate -- --name=<kebab-name>" in backend/ with a name that says what the migration does, and read the generated SQL. ' +
    'When a secret-scan hit is a real secret, move the value to a file that .gitignore lists and leave a placeholder. Never print the value. ' +
    SAFETY_RULES +
    'Re-run each failing command yourself and report its real output. ' +
    'Some failures need a user decision, for example a new permission, a new dependency, or a migration for a shape whose history is unclear. ' +
    'Do not guess. Leave such a failure in place and explain why in your report.',
    { agentType: 'code-implementer', label: 'fix-checks:' + r, phase: 'Implement' },
  )
  const reviewed = await reviewUntilClean('fix-' + r)
  if (!reviewed.ok) {
    return {
      status: 'blocked',
      reason: 'fix round ' + r + ' has critical issues (or no review verdict) after ' + MAX_REVIEW_ROUNDS + ' review rounds',
      lastReview: reviewed.review,
      initialFailing,
    }
  }
  lastCleanReview = reviewed.review
  lastGate = await agent(
    'RE-CHECK mode (round ' + r + ') for the verification-repair workflow in the wiki3 repository. ' +
    'Run ONLY these checks from the set below: ' + SELECTED.join(', ') + '. Mark every other check "skipped".\n' +
    CHECK_SET + CHECK_RULES + '\n' +
    'Compare with the audit at ' + AUDIT_PATH + '. This round set out to fix:\n' +
    JSON.stringify(currentFailing, null, 2) + '\n' +
    'The verdict is pass when NO selected check has status "fail". Otherwise the verdict is fail. ' +
    'Give each failing check a reason. Use "still-failing" when it failed in the audit. Use "new-failure" when it passed in the audit and fails now. ' +
    'For each failing check include the exact command, its output, and the file it points at. Return the structured verdict.',
    { label: 'recheck:' + r, phase: 'Verify', schema: RECHECK_SCHEMA },
  )
  if (!lastGate) {
    residual = currentFailing
    log('re-check ' + r + ' produced no verdict - accepting last known failing list as residual')
    break
  }
  if (lastGate.verdict === 'pass' || (lastGate.failing ?? []).length === 0) break
  const improved = lastGate.failing.length < currentFailing.length
  currentFailing = lastGate.failing
  if (!improved) {
    residual = lastGate.failing
    log('round ' + r + ' produced no measurable improvement (still ' + lastGate.failing.length +
      ' failing) - stopping early with residual failures')
    break
  }
  if (r === MAX_FIX_ROUNDS) {
    residual = lastGate.failing
    log('checks still failing after ' + MAX_FIX_ROUNDS + ' fix round(s) - accepting with residual failures')
  }
}

// ---- Final report (assembled deterministically in-script) ----
return {
  status: residual ? 'done-with-residual-failures' : 'done',
  audit: { captured: true, path: AUDIT_PATH },
  initialFailing,
  gate: gateSummary(lastGate?.verdict ?? 'skipped', fixRoundsUsed, lastGate?.checks ?? audit.checks, lastGate?.notes ?? audit.notes),
  residualFailures: residual ?? [],
  warnings: lastCleanReview?.warnings ?? [],
  suggestions: lastCleanReview?.suggestions ?? [],
  reminder: 'This workflow never boots the backend, never touches a running dev instance, a database, a deployed wiki, a container registry, or AWS, never runs git push, git tag, or git commit, and never archives an OpenSpec change. The caller owns committing the repair result.',
}
