import { normalizeAppSession, parsePastesId } from '@/lib/session';
import type { NextApiRequest, NextApiResponse } from 'next';

const PASTES_API_URL = 'https://pastes.io/api';
const MAX_SESSION_BYTES = 500_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  try {
    if (req.body?.action === 'save') return await saveSession(req, res);
    if (req.body?.action === 'load') return await loadSession(req, res);
    return res.status(400).json({ error: 'unknown_action' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'pastes_request_failed';
    return res.status(400).json({ error: message });
  }
}

const normalizeApiKey = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const apiHeaders = (apiKeyValue: unknown) => {
  const apiKey = normalizeApiKey(apiKeyValue);
  return {
    accept: 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  };
};

async function saveSession(req: NextApiRequest, res: NextApiResponse) {
  const apiKey = normalizeApiKey(req.body?.apiKey);
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(apiKey)) throw new Error('Zadej platný Pastes.io API klíč.');
  const session = normalizeAppSession(req.body?.session);
  const content = JSON.stringify(session, null, 2);
  if (Buffer.byteLength(content, 'utf8') > MAX_SESSION_BYTES) throw new Error('Session je příliš velká.');

  const response = await fetch(`${PASTES_API_URL}/paste`, {
    method: 'POST',
    headers: { ...apiHeaders(apiKey), 'content-type': 'application/json' },
    body: JSON.stringify({
      title: `MultiScreen session - ${session.name}`,
      content,
      syntax: 'json',
      expire: '1M',
    }),
  });
  const result = await response.json().catch(() => null) as {
    success?: { slug?: string; paste_url?: string };
    error?: string | { message?: string };
    message?: string;
  } | null;
  if (!response.ok || !result?.success?.slug) {
    const apiError = typeof result?.error === 'string' ? result.error : result?.error?.message;
    throw new Error(apiError ?? result?.message ?? `Pastes.io HTTP ${response.status}`);
  }
  return res.status(200).json({
    id: result.success.slug,
    url: result.success.paste_url ?? `https://pastes.io/${result.success.slug}`,
  });
}

async function loadSession(req: NextApiRequest, res: NextApiResponse) {
  const supplied = typeof req.body?.paste === 'string' ? req.body.paste : '';
  const slug = parsePastesId(supplied);
  if (!slug) throw new Error('Zadej platný Pastes.io odkaz nebo ID.');

  const response = await fetch(`${PASTES_API_URL}/pastes/${encodeURIComponent(slug)}`, {
    headers: apiHeaders(req.body?.apiKey),
  });
  const result = await response.json().catch(() => null) as {
    success?: { content?: string };
    error?: string | { message?: string };
    message?: string;
  } | null;
  if (!response.ok || typeof result?.success?.content !== 'string') {
    const apiError = typeof result?.error === 'string' ? result.error : result?.error?.message;
    throw new Error(apiError ?? result?.message ?? `Pastes.io HTTP ${response.status}`);
  }
  if (Buffer.byteLength(result.success.content, 'utf8') > MAX_SESSION_BYTES) throw new Error('Pastes.io session je příliš velká.');
  return res.status(200).json({ session: normalizeAppSession(JSON.parse(result.success.content)) });
}
