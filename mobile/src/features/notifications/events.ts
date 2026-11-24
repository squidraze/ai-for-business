/**
 * Tiny in-app event bus so other features can react to pushes without the
 * notifications feature knowing about them.
 */
export type PushData = Record<string, unknown>;

type Listener<T> = (payload: T) => void;

function createEmitter<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    emit: (payload: T) => listeners.forEach((listener) => listener(payload)),
    subscribe: (listener: Listener<T>) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A push arrived while the app is open, or the user tapped one. */
export const pushReceived = createEmitter<PushData>();

/** The notification permission may have changed (asked in-app, back from settings). */
export const permissionChanged = createEmitter<void>();
