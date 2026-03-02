export function log(level: "info" | "warn" | "error", message: string, data?: unknown): void {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(data !== undefined ? { data } : {}),
  };
  process.stderr.write(JSON.stringify(entry) + "\n");
}
