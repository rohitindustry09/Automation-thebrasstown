export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler");
    const { startKeepAlive } = await import("./lib/keepalive");
    startScheduler();
    startKeepAlive();
  }
}
