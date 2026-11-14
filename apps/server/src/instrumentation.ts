/** Runs once per server start (Next instrumentation). Starts the continuous learning run (D-25); LOTSE_LEARN_INTERVAL_MIN=0 turns it off. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.NEXT_PHASE === "phase-production-build") return;
  if (process.env.LOTSE_LEARN_INTERVAL_MIN === "0") return;
  const { startLearnScheduler } = await import("./lib/lotse/learn");
  startLearnScheduler();
}
