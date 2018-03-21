import { relative } from 'path';
import { ChildProcess } from 'child_process';
import { git } from '../core/git';

const upath = require('upath');
const normalizeSafe: (path: string) => string = upath.normalizeSafe;

const successExitCodes = new Set([0, 1]);
const utf8Encoding: (process: ChildProcess) => void = cb => cb.stdout.setEncoding('utf8');
const binaryEncoding: (process: ChildProcess) => void = cb => cb.stdout.setEncoding('binary');

/**
 * Retrieve the text (UTF-8) contents of a file from the repository at a given
 * reference, commit, or tree.
 *
 * Returns a promise that will produce a Buffer instance containing
 * the text (UTF-8) contents of the resource or an error if the file doesn't
 * exists in the given revision.
 *
 * @param repositoryPath - The repository from where to read the file. Or the FS path to the repository.
 * @param commitish  - A commit SHA or some other identifier that ultimately dereferences to a commit/tree. `HEAD` is the `HEAD`. If empty string, shows the index state.
 * @param path       - The absolute FS path which is contained in the repository.
 */
export async function getTextContents(repositoryPath: string, commitish: string, path: string, exitCodes: Set<number> = successExitCodes): Promise<Buffer | undefined> {
    const args = ['show', `${commitish}:${normalizeSafe(relative(repositoryPath, path))}`];
    const opts = {
        successExitCodes: exitCodes,
        processCallback: utf8Encoding,
    };
    const result = await git(args, repositoryPath, 'getTextContents', opts);
    const { exitCode, stdout } = result;
    if (!successExitCodes.has(exitCode) && exitCodes.has(exitCode)) {
        return undefined;
    }
    return Buffer.from(stdout, 'utf8');
}

/**
 * Retrieve the binary contents of a blob from the repository at a given
 * reference, commit, or tree.
 *
 * Returns a promise that will produce a Buffer instance containing
 * the binary contents of the blob or an error if the file doesn't
 * exists in the given revision.
 *
 * @param repositoryPath - The repository from where to read the blob. Or the FS path to the repository.
 * @param commitish  - A commit SHA or some other identifier that ultimately dereferences to a commit/tree. `HEAD` is the `HEAD`. If empty string, shows the index state.
 * @param path       - The absolute FS path which is contained in the repository.
 */
export async function getBlobContents(repositoryPath: string, commitish: string, path: string, exitCodes: Set<number> = successExitCodes): Promise<Buffer | undefined> {
    const args = ['show', `${commitish}:${path}`];
    const opts = {
        successExitCodes: exitCodes,
        processCallback: binaryEncoding,
    };
    const result = await git(args, repositoryPath, 'getBlobContents', opts);
    const { exitCode, stdout } = result;
    if (!successExitCodes.has(exitCode) && exitCodes.has(exitCode)) {
        return undefined;
    }
    return Buffer.from(stdout, 'binary');
}