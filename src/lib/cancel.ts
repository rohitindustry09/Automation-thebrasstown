const g = globalThis as unknown as { __cancelRun?: boolean };

export class CancelledError extends Error {
  constructor() {
    super("Stopped by user");
  }
}

export const requestCancel = () => {
  g.__cancelRun = true;
};
export const clearCancel = () => {
  g.__cancelRun = false;
};
/** Called between units of work; a stop request ends the run at the next checkpoint. */
export function throwIfCancelled() {
  if (g.__cancelRun) throw new CancelledError();
}
