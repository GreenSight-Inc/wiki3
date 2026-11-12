# Tasks

Facts and assumptions (see design.md, D4 and Open Questions): the fork is `GreenSight-Inc/wiki3` (settled on 2026-11-11), and its remote is `origin`. The remote `upstream` is `requarks/wiki` with push disabled. Assumption: the release branch is `feat/greensight-visual`. Change 01 supplies the Dockerfile build args. It is archived, and its code is committed as `44169960`.

## 1. Preconditions

- [x] 1.1 Run `grep -nE '^ARG BUILD_(BRANCH|COMMIT|COMMIT_DATE)=""$|build\.json' dev/build/Dockerfile`. Expected: the three lines `ARG BUILD_BRANCH=""`, `ARG BUILD_COMMIT=""`, and `ARG BUILD_COMMIT_DATE=""`, and at least one line of the `build.json` step. Without them, stop, because the committed code of change 01 is missing.
- [x] 1.2 Run `git describe --tags --abbrev=0`. Expected: `3.3.1`. Write the result into design.md, Context, if it differs.

## 2. Tag script

- [x] 2.1 Create `dev/ci/fork-version.mjs` (design D1 to D3). It takes the tag as its only argument and uses Node.js built-ins only. For a valid tag it prints `version=`, `image_tag=`, and `base=` lines and exits 0. For any other input it writes one error line to stderr and exits 1.
- [x] 2.2 Run `node dev/ci/fork-version.mjs 'v3.3.1+jp.1'`. Expected: the three lines `version=3.3.1+jp.1`, `image_tag=3.3.1_jp.1`, and `base=3.3.1`, and exit 0.
- [x] 2.3 Run `for t in 3.3.1 v3.3.1 'v3.3.1+jp.01' 'v3.3.1+jp.0' 'v03.3.1+jp.1' 'v3.3.1-jp.1' 'v2.5.315_jp3' 'v3.3.1+jp.1 x'; do node dev/ci/fork-version.mjs "$t"; echo "exit $?"; done`. Expected: one error line and `exit 1` for each tag.
- [x] 2.4 Run `backend/node_modules/.bin/oxfmt --check dev/ci/fork-version.mjs` from the root. Expected: exit 0.

## 3. Release workflow

- [x] 3.1 Resolve each action commit (design D7). Run `git ls-remote --tags https://github.com/actions/checkout 'v7*'` and the same for `actions/setup-node`, `docker/setup-qemu-action`, `docker/setup-buildx-action`, `docker/login-action`, and `docker/build-push-action`. Expected: one line per tag. Take the newest exact version of each major. For an annotated tag, take the `^{}` line.
- [x] 3.2 Create `.github/workflows/release-fork.yml` from the outline in design.md. Each `uses:` names the 40-character hash with `# vX.Y.Z` after it. Each `run:` step reads the tag from `env:`. One step writes the lowercase image name `ghcr.io/${GITHUB_REPOSITORY,,}` to its output (design D4).
- [x] 3.3 Run `grep -nE 'uses: [^ ]+@' .github/workflows/release-fork.yml | grep -vE '@[0-9a-f]{40} # v[0-9]+\.[0-9]+\.[0-9]+$'`. Expected: no output and exit 1.
- [x] 3.4 Run `grep -nE ':latest|ubuntu-latest|secrets\.' .github/workflows/release-fork.yml`. Expected: one hit, the line `password: ${{ secrets.GITHUB_TOKEN }}`.
- [x] 3.5 Run `grep -n 'github.ref_name\|github.event' .github/workflows/release-fork.yml`. Expected: hits only inside `env:` blocks, none inside a `run:` script.
- [x] 3.6 Run `node -e 'require("./backend/node_modules/js-yaml").load(require("fs").readFileSync(".github/workflows/release-fork.yml","utf8"))'`. Expected: exit 0 and no output.
- [ ] 3.7 `actionlint`: did not run. The tool is not installed on the laptop, so the step is advisory and is not counted as passed. Before the first tag push, run `brew install actionlint`, then `actionlint .github/workflows/release-fork.yml .github/workflows/build.yml`. Expected: exit 0.

## 4. Upstream guard

- [x] 4.1 Add `if: github.repository == 'requarks/wiki'` to job `build` in `.github/workflows/build.yml`, directly under `name: Build`. Change no other line.
- [x] 4.2 Run `git diff --stat .github/workflows/build.yml`. Expected: `1 insertion(+)` and no deletion.
- [x] 4.3 Run `node -e 'require("./backend/node_modules/js-yaml").load(require("fs").readFileSync(".github/workflows/build.yml","utf8"))'`. Expected: exit 0 and no output.

## 5. Rule file

- [x] 5.1 Create `.claude/rules/fork-release.md` with `paths:` for `.github/workflows/release-fork.yml`, `.github/workflows/build.yml`, `dev/ci/fork-version.mjs`, and `dev/build/Dockerfile`. It states the version scheme, the git tag form, the image tag mapping, the guard line, and that `git tag` and `git push` are user-run.
- [x] 5.2 Run `head -8 .claude/rules/fork-release.md`. Expected: a front matter block with the four paths.

## 6. Local image build

- [x] 6.1 Run `cd frontend && npm run build` and `cd blocks && npm run build`. Expected: exit 0 for each.
- [x] 6.2 Run `docker build -f dev/build/Dockerfile --build-arg BUILD_BRANCH=feat/greensight-visual --build-arg BUILD_COMMIT=$(git rev-parse HEAD) --build-arg BUILD_COMMIT_DATE=$(git show -s --format=%cI HEAD) -t wiki-fork-test:local .`. Expected: exit 0 and a `Puppeteer drives` line. The step is advisory when Docker is missing.
- [x] 6.3 Run `docker run --rm --entrypoint cat wiki-fork-test:local /wiki/build.json`. Expected: one JSON line with the branch, the commit of 6.2, and its date.
- [x] 6.4 Run `docker image rm wiki-fork-test:local`. Expected: an `Untagged:` line.

## 7. Local check set

- [x] 7.1 ts-typecheck: run `cd backend && npm run typecheck`. Expected: exit 0 and no error line after the tsc banner.
- [x] 7.2 oxlint-backend: run `cd backend && npx oxlint`. Expected: exit 0.
- [x] 7.3 oxlint-frontend: run `cd frontend && npx oxlint`. Expected: exit 0.
- [x] 7.4 oxfmt-check: from the root, run `backend/node_modules/.bin/oxfmt --check $(git diff --name-only --diff-filter=d HEAD -- '*.ts' '*.js' '*.mjs' '*.vue') $(git ls-files --others --exclude-standard -- '*.ts' '*.js' '*.mjs' '*.vue')`. Expected: exit 0. When both file lists are empty, the check is skipped.
- [x] 7.5 frontend-build: run `cd frontend && npm run build`. Expected: exit 0.
- [x] 7.6 blocks-build: skipped, because the change does not touch `blocks/`. Not counted as passed.
- [x] 7.7 schema-migration: run `git diff --name-only HEAD -- backend/db/schema.ts`. Expected: no output, so the check is skipped.
- [x] 7.8 locale-json: run `node -e 'JSON.parse(require("fs").readFileSync("backend/locales/en.json","utf8"))'`. Expected: exit 0 and no output.
- [x] 7.9 secret-scan: run `git grep -nE 'AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' -- ':!package-lock.json'`. Expected: no output and exit 1.
- [x] 7.10 untracked-config: run `git ls-files config.yml config.test.yml data-test build.json`. Expected: no output.
- [x] 7.11 openspec-validate: run `openspec validate --all`. Expected: exit 0.

## 8. Hand-off (user-run, none of it ran)

Nothing below ran during the finalization, and none of it is marked done. The agent prepares the commands. The user runs them, in this order, from the repository root.

- The commit and the push `git push origin feat/greensight-visual` run in the session that finalizes the change, on the explicit request of the user. Expected: the push reports the branch as new or updated.
- user-run: `git push origin 3.3.1`. Expected: the push reports the tag as new, or `Everything up-to-date`.
- user-run: `git tag -a 'v3.3.1+jp.1' -m 'GreenSight 3.3.1+jp.1' && git push origin 'v3.3.1+jp.1'`. Expected: a "Release (Fork)" run starts in the Actions tab of the fork.
- user-run: open the run page. Expected: every step is green, and the summary shows `3.3.1+jp.1`, `ghcr.io/greensight-inc/wiki3:3.3.1_jp.1`, a `sha256:` digest, `feat/greensight-visual`, and the tagged commit.
- user-run: `docker buildx imagetools inspect ghcr.io/greensight-inc/wiki3:3.3.1_jp.1`. Expected: a `Digest:` line and the platforms `linux/amd64` and `linux/arm64`.
- user-run: on the next push to `scarlett` in the fork, open the "Build + Publish" run. Expected: job `Build` shows as skipped.
- user-run, in the deployment change: after a wiki starts from `3.3.1_jp.1`, open Admin, System. Expected: the current version `3.3.1+jp.1` and the Build row with the branch, commit, and date of the run. While upstream latest is `3.3.1`, the dashboard version card shows up to date.
