/**
 * Adapters between synchronous internals and the SDK's Promise-returning
 * public API.
 *
 * Several public methods are asynchronous by contract (so they can grow real
 * I/O without a breaking change) while their current implementation is purely
 * synchronous. These helpers keep those signatures intact without declaring an
 * `async` function that never awaits.
 *
 * @internal
 */

/**
 * Run a synchronous operation and surface its outcome as a promise.
 *
 * The value is resolved and any thrown value — `Error` or otherwise — is
 * surfaced as a rejection, matching the semantics of the `async` methods these
 * helpers replace.
 */
export function fromSync<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (error) {
    return Promise.reject(error);
  }
}
