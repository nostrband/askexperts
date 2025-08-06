/**
 * Relay utilities for NIP-174
 */

import { SimplePool, Event, Filter } from "nostr-tools";
import { debugError } from "./debug.js";

// Define a type for subscription that has a close method
interface Sub {
  close: () => void;
}

/**
 * Publishes an event to multiple relays
 *
 * @param event - The event to publish
 * @param relays - Array of relay URLs
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @returns Promise resolving to array of relay URLs where the event was successfully published
 */
export async function publishToRelays(
  event: Event,
  relays: string[],
  pool: SimplePool,
  timeout: number = 5000
): Promise<string[]> {
  const successfulRelays: string[] = [];

  try {
    // Create an array of promises for publishing to each relay
    const publishPromises = relays.map(async (relayUrl) => {
      try {
        // Set up a promise that will be resolved on successful publish or rejected on timeout
        const publishPromise = new Promise<void>(async (resolve, reject) => {
          try {
            // Connect to the relay
            const relay = await pool.ensureRelay(relayUrl, {
              connectionTimeout: timeout,
            });

            // Publish the event
            await relay.publish(event);

            // If successful, add to the list
            successfulRelays.push(relayUrl);
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        // Set up a timeout promise
        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(
            () =>
              reject(
                new Error(`Publish to ${relayUrl} timed out after ${timeout}ms`)
              ),
            timeout
          );
        });

        // Race the publish against the timeout
        await Promise.race([publishPromise, timeoutPromise]);
      } catch (error) {
        // Log the error but don't fail the entire operation
        debugError(`Failed to publish to ${relayUrl}:`, error);
      }
    });

    // Wait for all publish attempts to complete
    await Promise.all(publishPromises);
  } catch (error) {
    debugError("Error in publishToRelays:", error);
  }

  // Return the list of relays where publication was successful
  return successfulRelays;
}

/**
 * Subscribes to events from multiple relays
 *
 * @param filters - Array of filters
 * @param relays - Array of relay URLs
 * @param options - Subscription options
 * @returns Subscription object
 */
export function subscribeToRelays(
  filters: Filter[],
  relays: string[],
  pool: SimplePool,
  options: {
    onevent?: (event: Event) => void;
    oneose?: () => void;
  } = {}
): Sub {
  return pool.subscribeMany(relays, filters, options);
}

/**
 * Fetches events from multiple relays
 *
 * @param filters - Array of filters
 * @param relays - Array of relay URLs
 * @param timeout - Timeout in milliseconds (default: 5000)
 * @returns Promise resolving to array of events
 */
export async function fetchFromRelays(
  filter: Filter,
  relays: string[],
  pool: SimplePool,
  timeout: number = 5000
): Promise<Event[]> {
  // Fetch and sort properly
  return (await pool.querySync(relays, filter, { maxWait: timeout })).sort(
    (a, b) => b.created_at - a.created_at
  );
}

/**
 * Waits for a specific event matching the filter
 *
 * @param filter - Filter to match events
 * @param relays - Array of relay URLs
 * @param timeout - Timeout in milliseconds (default: 30000)
 * @returns Promise resolving to the matched event or null if timeout
 */
export async function waitForEvent(
  filter: Filter,
  relays: string[],
  pool: SimplePool,
  timeout: number = 30000
): Promise<Event | null> {
  return new Promise((resolve) => {
    let timeoutId: NodeJS.Timeout;
    let resolved = false;

    const sub = pool.subscribeMany(relays, [filter], {
      onevent(event: Event) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          sub.close();
          resolve(event);
        }
      },
    });

    timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        sub.close();
        resolve(null);
      }
    }, timeout);
  });
}

/**
 * Creates an async iterable for events matching the filter
 *
 * @param filter - Filter to match events
 * @param relays - Array of relay URLs
 * @param options - Options for the subscription
 * @returns Async iterable yielding events
 */
export function createEventStream(
  filter: Filter,
  relays: string[],
  pool: SimplePool,
  options: {
    closeOnEose?: boolean;
    timeout?: number;
  } = {}
): AsyncIterable<Event> {
  return {
    [Symbol.asyncIterator]() {
      const queue: Event[] = [];
      let done = false;
      let error: Error | null = null;
      let resolveNext: ((value: IteratorResult<Event, any>) => void) | null =
        null;

      const sub = pool.subscribeMany(relays, [filter], {
        onevent(event: Event) {
          if (done) return;

          if (resolveNext) {
            resolveNext({ value: event, done: false });
            resolveNext = null;
          } else {
            queue.push(event);
          }
        },
        oneose() {
          if (options.closeOnEose && !done) {
            done = true;

            if (resolveNext) {
              resolveNext({ value: undefined, done: true });
              resolveNext = null;
            }
          }
        },
      });

      // Set timeout if specified
      let timeoutId: NodeJS.Timeout | null = null;
      if (options.timeout) {
        timeoutId = setTimeout(() => {
          if (!done) {
            done = true;

            if (resolveNext) {
              resolveNext({ value: undefined, done: true });
              resolveNext = null;
            }
          }
        }, options.timeout);
      }

      return {
        async next(): Promise<IteratorResult<Event, any>> {
          if (error) {
            throw error;
          }

          if (done) {
            return { value: undefined, done: true };
          }

          if (queue.length > 0) {
            return { value: queue.shift()!, done: false };
          }

          return new Promise((resolve) => {
            resolveNext = resolve;
          });
        },

        async return(): Promise<IteratorResult<Event, any>> {
          if (!done) {
            done = true;
            sub.close();

            if (timeoutId) {
              clearTimeout(timeoutId);
            }
          }

          return { value: undefined, done: true };
        },

        async throw(err: any): Promise<IteratorResult<Event, any>> {
          if (!done) {
            done = true;
            error = err instanceof Error ? err : new Error(String(err));
            sub.close();

            if (timeoutId) {
              clearTimeout(timeoutId);
            }
          }

          throw error;
        },
      };
    },
  };
}
