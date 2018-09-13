import * as fs from 'fs';
import * as path from 'path';
import findGit from 'find-git-exec';
import {
    GitProcess,
    IGitResult as DugiteResult,
    GitError as DugiteError,
    IGitExecutionOptions as DugiteExecutionOptions,
    RepositoryDoesNotExistErrorCode,
    GitNotFoundErrorCode
} from 'dugite';

// tslint:disable:max-line-length
const __GIT_PATH__: { gitDir: string | undefined, gitExecPath: string | undefined, searched: boolean } = { gitDir: undefined, gitExecPath: undefined, searched: false };

/**
 * An extension of the execution options in dugite that
 * allows us to piggy-back our own configuration options in the
 * same object.
 */
export interface IGitExecutionOptions extends DugiteExecutionOptions {
    /**
     * The exit codes which indicate success to the
     * caller. Unexpected exit codes will be logged and an
     * error thrown. Defaults to 0 if undefined.
     */
    readonly successExitCodes?: ReadonlySet<number>

    /**
     * The git errors which are expected by the caller. Unexpected errors will
     * be logged and an error thrown.
     */
    readonly expectedErrors?: ReadonlySet<DugiteError>

    /**
     * `path` is equivalent to `cwd`.
     * If the `exec` function is set:
     *   - then this will be called instead of the `child_process.execFile`. Clients will **not** have access to the `stdin`.
     *   - then the `USE_LOCAL_GIT` must be set to `"true"`. Otherwise, an error will be thrown.
     *   - the all other properties defined by this option will be ignored except the `env` property.
     */
    readonly exec?: IGitExecutionOptions.ExecFunc;
}

export namespace IGitExecutionOptions {
    export type ExecFunc = (args: string[], options: { cwd: string, env?: Object }, callback: (error: Error | null, stdout: string, stderr: string) => void) => void;
}

/**
 * The result of using `git`. This wraps dugite's results to provide
 * the parsed error if one occurs.
 */
export interface IGitResult extends DugiteResult {
    /**
     * The parsed git error. This will be undefined when the exit code is include in
     * the `successExitCodes`, or when dugite was unable to parse the
     * error.
     */
    readonly gitError: DugiteError | undefined

    /** The human-readable error description, based on `gitError`. */
    readonly gitErrorDescription: string | undefined
}

function getResultMessage(result: IGitResult) {
    const description = result.gitErrorDescription
    if (description) {
        return description
    }

    if (result.stderr.length) {
        return result.stderr
    } else if (result.stdout.length) {
        return result.stdout
    } else {
        return 'Unknown error'
    }
}

export class GitError extends Error {
    /** The result from the failed command. */
    public readonly result: IGitResult

    /** The args for the failed command. */
    public readonly args: ReadonlyArray<string>

    public constructor(result: IGitResult, args: ReadonlyArray<string>) {
        super(getResultMessage(result))

        this.name = 'GitError'
        this.result = result
        this.args = args
    }
}

function pathExists(path: string): Boolean {
    try {
        fs.accessSync(path, (fs as any).F_OK)
        return true
    } catch {
        return false
    }
}

function gitExternal(args: string[], path: string, options: IGitExecutionOptions): Promise<DugiteResult> {
    if (options.exec === undefined) {
        throw new Error(`options.exec must be defined.`);
    }
    // XXX: this is just to keep the original code from here https://github.com/desktop/dugite/blob/master/lib/git-process.ts#L172-L227
    const maxBuffer = options.maxBuffer ? options.maxBuffer : 10 * 1024 * 1024;
    const { exec } = options;
    return new Promise<DugiteResult>((resolve, reject) => {
        exec(args, { cwd: path, env: options.env }, (err: Error | null, stdout: string, stderr: string) => {
            if (!err) {
                resolve({ stdout, stderr, exitCode: 0 })
                return
            }

            const errWithCode = err as (Error & { code: number | string | undefined })

            let code = errWithCode.code

            // If the error's code is a string then it means the code isn't the
            // process's exit code but rather an error coming from Node's bowels,
            // e.g., ENOENT.
            if (typeof code === 'string') {
                if (code === 'ENOENT') {
                    let message = err.message
                    if (pathExists(path) === false) {
                        message = 'Unable to find path to repository on disk.'
                        code = RepositoryDoesNotExistErrorCode
                    } else {
                        message = `Git could not be found at the expected path: '${
                            process.env.LOCAL_GIT_DIRECTORY
                            }'. This might be a problem with how the application is packaged, so confirm this folder hasn't been removed when packaging.`
                        code = GitNotFoundErrorCode
                    }

                    const error = new Error(message) as (Error & { code: number | string | undefined })
                    error.name = err.name
                    error.code = code
                    reject(error)
                } else {
                    reject(err)
                }

                return
            }

            if (typeof code === 'number') {
                resolve({ stdout, stderr, exitCode: code })
                return
            }

            // Git has returned an output that couldn't fit in the specified buffer
            // as we don't know how many bytes it requires, rethrow the error with
            // details about what it was previously set to...
            if (err.message === 'stdout maxBuffer exceeded') {
                reject(
                    new Error(
                        `The output from the command could not fit into the allocated stdout buffer. Set options.maxBuffer to a larger value than ${
                        maxBuffer
                        } bytes`
                    )
                )
            } else {
                reject(err)
            }
        });
    });
}

/**
 * Shell out to git with the given arguments, at the given path.
 *
 * @param {args}             The arguments to pass to `git`.
 *
 * @param {path}             The working directory path for the execution of the
 *                           command.
 *
 * @param {name}             The name for the command based on its caller's
 *                           context. This will be used for performance
 *                           measurements and debugging.
 *
 * @param {options}          Configuration options for the execution of git,
 *                           see IGitExecutionOptions for more information.
 *
 * Returns the result. If the command exits with a code not in
 * `successExitCodes` or an error not in `expectedErrors`, a `GitError` will be
 * thrown.
 */
export async function git(args: string[], path: string, name: string, options?: IGitExecutionOptions): Promise<IGitResult> {

    if (
        options
        && options.exec
        && (typeof process.env.LOCAL_GIT_DIRECTORY === 'undefined' || typeof process.env.GIT_EXEC_PATH === 'undefined')) {
        throw new Error('LOCAL_GIT_DIRECTORY and GIT_EXEC_PATH must be specified when using an exec function.');
    }

    const defaultOptions: IGitExecutionOptions = {
        successExitCodes: new Set([0]),
        expectedErrors: new Set(),
    }

    const opts = { ...defaultOptions, ...options }
    let result: DugiteResult;
    if (options && options.exec) {
        result = await gitExternal(args, path, options);
    } else {
        await initGitEnv();
        await configureGitEnv();
        result = await GitProcess.exec(args, path, options);
    }

    const exitCode = result.exitCode

    let gitError: DugiteError | undefined = undefined
    const acceptableExitCode = opts.successExitCodes ? opts.successExitCodes.has(exitCode) : false
    if (!acceptableExitCode) {
        gitError = GitProcess.parseError(result.stderr) || undefined
        if (!gitError) {
            gitError = GitProcess.parseError(result.stdout) || undefined
        }
    }

    const gitErrorDescription = gitError ? getDescriptionForError(gitError) : undefined
    const gitResult = { ...result, gitError, gitErrorDescription }

    let acceptableError = true
    if (gitError && opts.expectedErrors) {
        acceptableError = opts.expectedErrors.has(gitError)
    }

    if ((gitError && acceptableError) || acceptableExitCode) {
        return gitResult
    }

    console.error(`The command \`git ${args.join(' ')}\` exited with an unexpected code: ${exitCode}. The caller should either handle this error, or expect that exit code.`)
    if (result.stdout.length) {
        console.error(result.stdout)
    }

    if (result.stderr.length) {
        console.error(result.stderr)
    }

    if (gitError) {
        console.error(`(The error was parsed as ${gitError}: ${gitErrorDescription})`)
    }

    throw new GitError(gitResult, args)
}

export async function gitVersion(options?: IGitExecutionOptions): Promise<string> {
    await initGitEnv();
    await configureGitEnv();
    const { stdout } = await GitProcess.exec(['--version'], '', options) || '';
    return stdout.trim();
}

async function initGitEnv() {
    if (process.env.USE_LOCAL_GIT === 'true' && !process.env.LOCAL_GIT_DIRECTORY && !process.env.GIT_EXEC_PATH && !__GIT_PATH__.searched) {
        console.log(`'USE_LOCAL_GIT' is set to true. Trying to use local Git for 'dugite' execution.`);
        try {
            const git = await findGit();
            if (git && git.path && git.execPath) {
                // We need to traverse up two levels to get the expected Git directory.
                // `dugite` expects the directory path instead of the executable path.
                // https://github.com/desktop/dugite/issues/111
                const gitDir = path.dirname(path.dirname(git.path));
                if (fs.existsSync(gitDir) && fs.existsSync(git.execPath)) {
                    __GIT_PATH__.gitDir = gitDir;
                    __GIT_PATH__.gitExecPath = git.execPath;
                    console.log(`Using external Git executable. Git path: ${git.path}. Git exec-path: ${git.execPath}. [Version: ${git.version}]`);
                } else {
                    throw new Error(`Cannot find local Git executable: ${git}.`);
                }
            }
        } catch (error) {
            console.error(`Cannot find local Git executable.`, error);
            __GIT_PATH__.gitDir = undefined;
            __GIT_PATH__.gitExecPath = undefined;
        } finally {
            __GIT_PATH__.searched = true;
        }
    }
}

async function configureGitEnv() {
    if (process.env.USE_LOCAL_GIT === 'true'
        && !process.env.LOCAL_GIT_DIRECTORY
        && !process.env.GIT_EXEC_PATH
        && __GIT_PATH__.searched
        && __GIT_PATH__.gitDir
        && __GIT_PATH__.gitExecPath) {

        process.env.LOCAL_GIT_DIRECTORY = __GIT_PATH__.gitDir;
        process.env.GIT_EXEC_PATH = __GIT_PATH__.gitExecPath;
    }
}

function getDescriptionForError(error: DugiteError): string {
    switch (error) {
        case DugiteError.SSHKeyAuditUnverified: return 'The SSH key is unverified.'
        case DugiteError.SSHAuthenticationFailed:
        case DugiteError.SSHPermissionDenied:

        case DugiteError.HTTPSAuthenticationFailed: return `Authentication failed. You may not have permission to access the repository.`
        case DugiteError.RemoteDisconnection: return 'The remote disconnected. Check your Internet connection and try again.'
        case DugiteError.HostDown: return 'The host is down. Check your Internet connection and try again.'
        case DugiteError.RebaseConflicts: return 'We found some conflicts while trying to rebase. Please resolve the conflicts before continuing.'
        case DugiteError.MergeConflicts: return 'We found some conflicts while trying to merge. Please resolve the conflicts and commit the changes.'
        case DugiteError.HTTPSRepositoryNotFound:
        case DugiteError.SSHRepositoryNotFound: return 'The repository does not seem to exist anymore. You may not have access, or it may have been deleted or renamed.'
        case DugiteError.PushNotFastForward: return 'The repository has been updated since you last pulled. Try pulling before pushing.'
        case DugiteError.BranchDeletionFailed: return 'Could not delete the branch. It was probably already deleted.'
        case DugiteError.DefaultBranchDeletionFailed: return `The branch is the repository's default branch and cannot be deleted.`
        case DugiteError.RevertConflicts: return 'To finish reverting, please merge and commit the changes.'
        case DugiteError.EmptyRebasePatch: return 'There aren’t any changes left to apply.'
        case DugiteError.NoMatchingRemoteBranch: return 'There aren’t any remote branches that match the current branch.'
        case DugiteError.NothingToCommit: return 'There are no changes to commit.'
        case DugiteError.NoSubmoduleMapping: return 'A submodule was removed from .gitmodules, but the folder still exists in the repository. Delete the folder, commit the change, then try again.'
        case DugiteError.SubmoduleRepositoryDoesNotExist: return 'A submodule points to a location which does not exist.'
        case DugiteError.InvalidSubmoduleSHA: return 'A submodule points to a commit which does not exist.'
        case DugiteError.LocalPermissionDenied: return 'Permission denied.'
        case DugiteError.InvalidMerge: return 'This is not something we can merge.'
        case DugiteError.InvalidRebase: return 'This is not something we can rebase.'
        case DugiteError.NonFastForwardMergeIntoEmptyHead: return 'The merge you attempted is not a fast-forward, so it cannot be performed on an empty branch.'
        case DugiteError.PatchDoesNotApply: return 'The requested changes conflict with one or more files in the repository.'
        case DugiteError.BranchAlreadyExists: return 'A branch with that name already exists.'
        case DugiteError.BadRevision: return 'Bad revision.'
        case DugiteError.NotAGitRepository: return 'This is not a git repository.'
        case DugiteError.ProtectedBranchForcePush: return 'This branch is protected from force-push operations.'
        case DugiteError.ProtectedBranchRequiresReview: return 'This branch is protected and any changes requires an approved review. Open a pull request with changes targeting this branch instead.'
        case DugiteError.PushWithFileSizeExceedingLimit: return 'The push operation includes a file which exceeds GitHub\'s file size restriction of 100MB. Please remove the file from history and try again.'
        case DugiteError.HexBranchNameRejected: return 'The branch name cannot be a 40-character string of hexadecimal characters, as this is the format that Git uses for representing objects.'
        case DugiteError.ForcePushRejected: return 'The force push has been rejected for the current branch.'
        case DugiteError.InvalidRefLength: return 'A ref cannot be longer than 255 characters.'
        default: throw new Error(`Unknown error: ${error}.`)
    }
}