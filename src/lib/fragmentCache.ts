export const STREAM_CACHE_BYTES = 1_000_000_000;
export class FragmentCache {
  private entries = new Map<string, { data: ArrayBuffer; expires: number }>();
  private bytes = 0;
  private limit: number;
  private ttl: number;
  constructor(limit = STREAM_CACHE_BYTES, ttl = 60_000) { this.limit = limit; this.ttl = ttl; }
  private drop(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.data.byteLength;
    this.entries.delete(key);
  }
  get(key: string, now = Date.now()) {
    const entry = this.entries.get(key);
    if (!entry || entry.expires <= now) { this.drop(key); return undefined; }
    return entry.data;
  }
  put(key: string, data: ArrayBuffer, now = Date.now()) {
    if (!data.byteLength || data.byteLength > this.limit) return;
    for (const [id, entry] of this.entries) {
      if (entry.expires > now) break;
      this.drop(id);
    }
    this.drop(key);
    while (this.bytes + data.byteLength > this.limit) this.drop(this.entries.keys().next().value!);
    this.entries.set(key, { data: data.slice(0), expires: now + this.ttl });
    this.bytes += data.byteLength;
  }
}
const cache = new FragmentCache();
type Context = { url: string; rangeStart?: number; rangeEnd?: number };
type Response = { url: string; data: string | ArrayBuffer };
type Callbacks = { onSuccess: (response: Response, ...args: unknown[]) => void };
type Loader = { stats: object; load: (ctx: Context, config: unknown, cb: Callbacks) => void };
type LoaderConstructor = new (config: unknown) => Loader;
export function CachedFragmentLoader(config: unknown) {
  const { Hls } = window as unknown as { Hls: { DefaultConfig: { loader: LoaderConstructor } } };
  const loader = new Hls.DefaultConfig.loader(config);
  const load = loader.load.bind(loader);
  loader.load = (ctx, options, callbacks) => {
    const key = JSON.stringify([ctx.url, ctx.rangeStart, ctx.rangeEnd]);
    const cached = cache.get(key);
    if (cached) {
      const now = performance.now();
      Object.assign(loader.stats, { loaded: cached.byteLength, total: cached.byteLength,
        loading: { start: now, first: now + 1, end: now + 2 } });
      callbacks.onSuccess({ url: ctx.url, data: cached.slice(0) }, loader.stats, ctx, null);
      return;
    }
    load(ctx, options, { ...callbacks, onSuccess(response, ...args) {
      if (response.data instanceof ArrayBuffer) cache.put(key, response.data);
      callbacks.onSuccess(response, ...args);
    } });
  };
  return loader;
}
