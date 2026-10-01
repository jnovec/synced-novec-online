import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { NextApiRequest, NextApiResponse } from 'next';
import { assertPublicRemoteUrl } from '@/lib/safeRemoteFetch';
import { buildStreamRecordingPayload, isAllowedStreamRecordingOrigin } from '@/lib/streamRecording';

// Synced and n8n share this host; loopback avoids Cloudflare's POST edge block.
const WEBHOOK_URL = 'http://127.0.0.1:5678/webhook/stream-download-manager';
const TOKEN_FILE = join(homedir(), '.n8n-stream-manager.token');
const MAX_REQUESTS_PER_MINUTE = 6;
const requestWindows = new Map<string, { count: number; expiresAt: number }>();

export const config = {
  api: { bodyParser: { sizeLimit: '2kb' } },
};

const clientAddress = (req: NextApiRequest): string => {
  const cloudflareAddress = req.headers['cf-connecting-ip'];
  if (typeof cloudflareAddress === 'string' && cloudflareAddress.length <= 64) return cloudflareAddress;
  return req.socket.remoteAddress ?? 'unknown';
};

const allowRequest = (address: string): boolean => {
  const now = Date.now();
  const current = requestWindows.get(address);
  if (!current || current.expiresAt <= now) {
    requestWindows.set(address, { count: 1, expiresAt: now + 60_000 });
    return true;
  }
  if (current.count >= MAX_REQUESTS_PER_MINUTE) return false;
  current.count += 1;
  return true;
};

const readWebhookKey = async (): Promise<string> => {
  const metadata = await stat(TOKEN_FILE);
  if ((metadata.mode & 0o077) !== 0) throw new Error('webhook_key_permissions_invalid');
  const key = (await readFile(TOKEN_FILE, 'utf8')).trim();
  if (!key) throw new Error('webhook_key_missing');
  return key;
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Vary', 'Origin');

  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!isAllowedStreamRecordingOrigin(typeof req.headers.origin === 'string' ? req.headers.origin : null)) {
    return res.status(403).json({ error: 'origin_not_allowed' });
  }

  if (!allowRequest(clientAddress(req))) return res.status(429).json({ error: 'rate_limited' });

  try {
    const payload = buildStreamRecordingPayload(req.body?.url);
    await assertPublicRemoteUrl(new URL(payload.url));

    let key: string;
    try {
      key = await readWebhookKey();
    } catch {
      return res.status(503).json({ error: 'stream_manager_not_configured' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    let upstream: Response;
    try {
      upstream = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Stream-Manager-Key': key,
        },
        body: JSON.stringify(payload),
        redirect: 'manual',
        cache: 'no-store',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const responseText = await upstream.text();
    if (responseText.length > 16_384) return res.status(502).json({ error: 'stream_manager_invalid_response' });

    let result: { ok?: boolean; jobId?: unknown; status?: unknown; error?: unknown };
    try {
      result = JSON.parse(responseText);
    } catch {
      return res.status(502).json({ error: 'stream_manager_invalid_response' });
    }

    if (!upstream.ok || result.ok !== true || typeof result.jobId !== 'string') {
      const error = typeof result.error === 'string' && /^[a-z0-9_]{1,64}$/i.test(result.error)
        ? result.error
        : 'stream_manager_rejected';
      return res.status(502).json({ error });
    }

    return res.status(202).json({
      ok: true,
      jobId: result.jobId,
      ...(typeof result.status === 'string' ? { status: result.status } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'recording_request_failed';
    const safeValidationErrors = new Set([
      'invalid_url',
      'missing_url',
      'only_http_urls',
      'url_credentials_not_allowed',
      'nonstandard_port_not_allowed',
      'private_address_not_allowed',
    ]);
    if (safeValidationErrors.has(message)) return res.status(400).json({ error: message });
    return res.status(502).json({ error: 'stream_manager_unreachable' });
  }
}
