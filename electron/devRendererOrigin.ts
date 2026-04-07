/**
 * Dev-only Vite URLs: allow any loopback port so `strictPort: false` can move
 * off 5173 when that port is already taken.
 */
export function isDevPackagedHttpLoopbackOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}
