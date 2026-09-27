// Share short-lived discovery responses between the resolver and HLS master.
//
// A Response body is a one-shot stream. Caching Response instances therefore
// makes a second consumer eventually fail with "Body has already been
// consumed", even when clone() was used by the caller. Keep an immutable
// snapshot instead and create a fresh Response for every consumer.
type EdgeSnapshot = {
  status: number;
  headers: [string, string][];
  body: ArrayBuffer;
};

const pending = new Map<string, Promise<EdgeSnapshot>>();
const cached = new Map<string, { until: number; snapshot: EdgeSnapshot }>();
let retryAt = 0;

function responseFromSnapshot(snapshot: EdgeSnapshot): Response {
  return new Response(snapshot.body.slice(0), {
    status: snapshot.status,
    headers: snapshot.headers,
  });
}

export async function fetchEdge(url: string, init: RequestInit): Promise<Response> {
  const now = Date.now();
  if (now < retryAt) {
    return new Response(null, { status: 429, headers: { 'Retry-After': String(Math.ceil((retryAt - now) / 1000)) } });
  }
  const key = String(init.body);
  for (const [entry, value] of cached) if (value.until <= now) cached.delete(entry);
  const hit = cached.get(key);
  if (hit) return responseFromSnapshot(hit.snapshot);
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
      const snapshot: EdgeSnapshot = {
        status: response.status,
        headers: Array.from(response.headers.entries()),
        body: await response.arrayBuffer(),
      };
      if (response.ok) cached.set(key, { until: Date.now() + 10000, snapshot });
      return snapshot;
    }).finally(() => pending.delete(key));
    pending.set(key, request);
  }
  return responseFromSnapshot(await request);
}
