// Turns a fork release tag into the version, the image tag and the upstream base release. Run by the
// "Parse tag" step of .github/workflows/release-fork.yml, which appends the output to $GITHUB_OUTPUT,
// and runnable on a laptop to check a tag before it is pushed.
//
//   node dev/ci/fork-version.mjs 'v3.3.1+jp.1'
//   version=3.3.1+jp.1
//   image_tag=3.3.1_jp.1
//   base=3.3.1
//
// The tag is `v<major>.<minor>.<patch>+jp.<N>`, with no leading zero in any number and N from 1. The
// version is semver build metadata, so it compares equal to its base. A Docker tag allows no `+`, so
// the image tag replaces it with `_`. See .claude/rules/fork-release.md.

import process from 'node:process'

const TAG_FORMAT = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\+jp\.([1-9]\d*)$/

const args = process.argv.slice(2)
const tag = args[0] ?? ''
const match = args.length === 1 ? TAG_FORMAT.exec(tag) : null

if (!match) {
  process.stderr.write(
    `Invalid fork release tag "${tag}": expected v<major>.<minor>.<patch>+jp.<N>, such as v3.3.1+jp.1, with no leading zero and N from 1.\n`
  )
  process.exit(1)
}

const [, base, n] = match
const version = `${base}+jp.${n}`

process.stdout.write(`version=${version}\nimage_tag=${base}_jp.${n}\nbase=${base}\n`)
