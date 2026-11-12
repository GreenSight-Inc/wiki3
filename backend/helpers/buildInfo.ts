import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Which build of the code is running: the git branch and commit it was made from, and when that
 * commit was made. The version in `package.json` says which release; this says which build of it,
 * which is what tells two images of the same version apart.
 */
export interface BuildInfo {
  branch: string | null
  commit: string | null
  commitDate: string | null
  /** Where the answer came from: `env`, `file`, `git`, or `none` when nothing is known. */
  source: 'env' | 'file' | 'git' | 'none'
}

const EMPTY: BuildInfo = { branch: null, commit: null, commitDate: null, source: 'none' }

/**
 * Resolve the build info once, at boot.
 *
 * Three sources, first hit wins, each covering one deployment shape:
 *
 * 1. The environment: `BUILD_BRANCH`, `BUILD_COMMIT` and `BUILD_COMMIT_DATE`, which is what an
 *    operator sets on a container by hand.
 * 2. A `build.json` at the app root, which the production Dockerfile writes from its build args.
 *    The image has no `.git` folder, so this is the only way a built image knows its commit.
 * 3. A live read of `.git` through the `git` binary, for a source checkout and for development.
 *    A detached checkout has no branch: git answers `HEAD` for it, which is reported as unknown.
 *
 * Never throws: a build that cannot be identified is reported as unknown, and the admin area hides
 * the row.
 */
export async function readBuildInfo(rootPath: string): Promise<BuildInfo> {
  const fromEnv = {
    branch: process.env.BUILD_BRANCH?.trim() || null,
    commit: process.env.BUILD_COMMIT?.trim() || null,
    commitDate: process.env.BUILD_COMMIT_DATE?.trim() || null
  }
  if (fromEnv.branch || fromEnv.commit) {
    return { ...fromEnv, source: 'env' }
  }

  try {
    const raw = await fs.readFile(path.join(rootPath, 'build.json'), 'utf8')
    const data = JSON.parse(raw) as Partial<BuildInfo>
    const fromFile = {
      branch: typeof data.branch === 'string' && data.branch.length > 0 ? data.branch : null,
      commit: typeof data.commit === 'string' && data.commit.length > 0 ? data.commit : null,
      commitDate:
        typeof data.commitDate === 'string' && data.commitDate.length > 0 ? data.commitDate : null
    }
    if (fromFile.branch || fromFile.commit) {
      return { ...fromFile, source: 'file' }
    }
  } catch {
    // -> No build.json, which is the normal case outside the production image
  }

  try {
    await fs.access(path.join(rootPath, '.git'))
    const git = async (args: string[]): Promise<string> => {
      const { stdout } = await execFileAsync('git', args, { cwd: rootPath, timeout: 5000 })
      return stdout.trim()
    }
    const [branch, commit, commitDate] = await Promise.all([
      git(['rev-parse', '--abbrev-ref', 'HEAD']),
      git(['rev-parse', 'HEAD']),
      git(['show', '-s', '--format=%cI', 'HEAD'])
    ])
    return {
      // -> `--abbrev-ref` prints `HEAD` on a detached checkout, which names no branch
      branch: branch && branch !== 'HEAD' ? branch : null,
      commit: commit || null,
      commitDate: commitDate || null,
      source: 'git'
    }
  } catch {
    // -> Not a checkout, or no git binary: nothing more to try
  }

  return { ...EMPTY }
}
