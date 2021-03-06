export * from './checkout'
export * from './clone'
export * from './fetch'
export * from './from-process'
export * from './git'
export * from './pull'
export * from './push'

/**
 * Base interface containing all the properties that progress events
 * need to support.
 */
export interface IProgress {

    /**
     * The overall progress of the operation, represented as a fraction between
     * 0 and 1.
     */
    readonly value: number;

    /**
     * An informative text for user consumption indicating the current operation
     * state. This will be high level such as 'Pushing origin' or
     * 'Fetching upstream' and will typically persist over a number of progress
     * events. For more detailed information about the progress see
     * the description field.
     */
    readonly title: string;

    /**
     * An informative text for user consumption. In the case of git progress this
     * will usually be the last raw line of output from git.
     */
    readonly description?: string;
}

/**
 * An object describing the progression of a branch checkout operation
 */
export interface ICheckoutProgress extends IProgress {

    readonly kind: 'checkout';

    /**
     * The branch that's currently being checked out.
     */
    readonly targetBranch: string;
}

/**
 * An object describing the progression of a fetch operation.
 */
export interface ICloneProgress extends IProgress {

    readonly kind: 'clone';

}

/**
 * An object describing the progression of a fetch operation
 */
export interface IFetchProgress extends IProgress {

    readonly kind: 'fetch';

    /**
     * The remote that's being fetched.
     */
    readonly remote: string;
}

/**
 * An object describing the progression of a pull operation.
 */
export interface IPullProgress extends IProgress {

    readonly kind: 'pull';

    /**
     * The remote that's being pulled from
     */
    readonly remote: string;
}

/**
 * An object describing the progression of a pull operation.
 */
export interface IPushProgress extends IProgress {

    readonly kind: 'push'

    /**
     * The remote that's being pushed to.
     */
    readonly remote: string;

    /**
     * The branch that's being pushed.
     */
    readonly branch: string;
}