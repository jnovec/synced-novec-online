import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchPublicText } from './safeRemoteFetch.ts';

const PUBLIC_URL = 'https://1.1.1.1/';

const withFetch = async (stub, action) => {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await action();
  } finally {
    globalThis.fetch = original;
  }
};

const unreadBody = (onCancel) => new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode('unused response bytes'));
  },
  cancel() {
    onCancel();
  },
});

const withObservedTimerCleanup = async (action) => {
  const originalSet = globalThis.setTimeout;
  const originalClear = globalThis.clearTimeout;
  const allocated = new Set();
  const cleared = new Set();
  globalThis.setTimeout = (callback, milliseconds, ...args) => {
    const handle = originalSet(callback, milliseconds, ...args);
    if (milliseconds === 123456) allocated.add(handle);
    return handle;
  };
  globalThis.clearTimeout = (handle) => {
    if (allocated.has(handle)) cleared.add(handle);
    return originalClear(handle);
  };
  try {
    await action();
    assert.equal(allocated.size, 1, 'a request timeout was registered');
    assert.equal(cleared.size, 1, 'that request timeout was cleared');
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
};

test('cancels an unused redirect response before following its location', async () => {
  let cancellations = 0;
  const requested = [];
  await withFetch(async (url) => {
    requested.push(String(url));
    if (requested.length === 1) {
      return new Response(unreadBody(() => { cancellations += 1; }), {
        status: 302,
        headers: { location: '/next' },
      });
    }
    return new Response('ready', { status: 200, headers: { 'content-type': 'text/plain' } });
  }, async () => {
    const result = await fetchPublicText(PUBLIC_URL);
    assert.equal(result.text, 'ready');
    assert.equal(result.finalUrl.href, 'https://1.1.1.1/next');
  });
  assert.deepEqual(requested, [PUBLIC_URL, 'https://1.1.1.1/next']);
  assert.equal(cancellations, 1);
});

test('cancels HTTP error responses and preserves the HTTP error', async () => {
  let cancellations = 0;
  await withFetch(async () => new Response(unreadBody(() => { cancellations += 1; }), { status: 503 }), async () => {
    await assert.rejects(fetchPublicText(PUBLIC_URL), /source_http_503/);
  });
  assert.equal(cancellations, 1);
});

test('cancels responses rejected for declared size', async () => {
  let cancellations = 0;
  await withFetch(async () => new Response(unreadBody(() => { cancellations += 1; }), {
    status: 200,
    headers: { 'content-length': '10' },
  }), async () => {
    await assert.rejects(fetchPublicText(PUBLIC_URL, { maxBytes: 3 }), /source_too_large/);
  });
  assert.equal(cancellations, 1);
});

test('cancels the stream reader when the received bytes exceed the limit', async () => {
  let cancellations = 0;
  await withFetch(async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('excessive data'));
    },
    cancel() {
      cancellations += 1;
    },
  }), { status: 200 }), async () => {
    await assert.rejects(fetchPublicText(PUBLIC_URL, { maxBytes: 3 }), /source_too_large/);
  });
  assert.equal(cancellations, 1);
});

test('clears the timeout if the network request rejects', async () => {
  await withObservedTimerCleanup(async () => {
    await withFetch(async () => { throw new Error('network_down'); }, async () => {
      await assert.rejects(fetchPublicText(PUBLIC_URL, { timeoutMs: 123456 }), /network_down/);
    });
  });
});

test('clears the timeout if the response stream fails during reading', async () => {
  await withObservedTimerCleanup(async () => {
    await withFetch(async () => new Response(new ReadableStream({
      pull(controller) {
        controller.error(new Error('stream_interrupted'));
      },
    }), { status: 200 }), async () => {
      await assert.rejects(fetchPublicText(PUBLIC_URL, { timeoutMs: 123456 }), /stream_interrupted/);
    });
  });
});

test('aborts a stalled request when its timeout elapses', async () => {
  let aborted = false;
  await withFetch((_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      aborted = true;
      reject(new Error('synthetic_abort'));
    }, { once: true });
  }), async () => {
    await assert.rejects(fetchPublicText(PUBLIC_URL, { timeoutMs: 15 }), /synthetic_abort/);
  });
  assert.equal(aborted, true);
});

test('rejects a redirect to localhost before requesting it', async () => {
  const requested = [];
  await withFetch(async (url, init) => {
    requested.push(String(url));
    assert.equal(init.redirect, 'manual');
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } });
  }, async () => {
    await assert.rejects(fetchPublicText(PUBLIC_URL), /private_address_not_allowed/);
  });
  assert.deepEqual(requested, [PUBLIC_URL]);
});

test('rejects an initial private address without fetching', async () => {
  let called = false;
  await withFetch(async () => { called = true; throw new Error('unexpected_fetch'); }, async () => {
    await assert.rejects(fetchPublicText('http://127.0.0.1/playlist'), /private_address_not_allowed/);
  });
  assert.equal(called, false);
});

test('accepts a public playlist within the byte limit', async () => {
  await withFetch(async () => new Response('#EXTM3U\\nhttps://chaturbate.com/example/'), async () => {
    const result = await fetchPublicText(PUBLIC_URL, { maxBytes: 200 });
    assert.match(result.text, /chaturbate\\.com\\/example/);
  });
});
