// Share short-lived discovery responses between the resolver and HLS master.
const pending = new Map<string, Promise<Response>>();
const cached = new Map<string, { until: number; response: Response }>();
let retryAt = 0;

export async function fetchEdge(url: string, init: RequestInit): Promise<Response> {
  const now = Date.now();
  if (now < retryAt) {
    return new Response(null, { status: 429, headers: { 'Retry-After': String(Math.ceil((retryAt - now) / 1000)) } });
  }
  const key = String(init.body);
  for (const [entry, value] of cached) if (value.until <= now) cached.delete(entry);
  const hit = cached.get(key);
  if (hit) return hit.response.clone();
  let request = pending.get(key);
  if (!request) {
    request = fetch(url, { ...init, signal: AbortSignal.timeout(15000) }).then(async (response) => {
      if (response.status === 429) {
        const header = response.headers.get('retry-after');
        const seconds = header ? Number(header) : NaN;
        const date = header ? Date.parse(header) : NaN;
        const delay = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(date) ? date - Date.now() : 30000;
        retryAt = Date.now() + Math.max(1000, delay);
      }
      const buffered = new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
      if (response.ok) cached.set(key, { until: Date.now() + 10000, response: buffered });
      return buffered;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
  }
  return (await request).clone();
}
