export function log(
  req: Request,
  status: number,
  ms: number,
  err?: unknown,
): void {
  const url = new URL(req.url);
  const tag = err ? " ERR" : "";
  const line = `${new Date().toISOString()} ${req.method} ${url.pathname} ${status} ${ms}ms${tag}`;
  if (err) {
    console.error(line, err);
  } else {
    console.error(line);
  }
}
