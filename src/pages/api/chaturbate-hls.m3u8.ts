import { isAllowedHlsUpstream, rewriteHlsPlaylist } from '@/lib/hlsProxy';
import type { NextApiRequest, NextApiResponse } from 'next';

const PROXY_PATH = '/api/chaturbate-hls.m3u8';

export const config = {
  api: {
    responseLimit: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {

  const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
  if (!isAllowedHlsUpstream(rawUrl)) return res.status(400).json({ error: 'invalid_hls_upstream' });

  try {
    const headers: Record<string, string> = {
      accept: '*/*',
      'user-agent': 'Mozilla/5.0',
    };
    if (typeof req.headers.range === 'string') headers.range = req.headers.range;

    const upstream = await fetch(rawUrl, {
      cache: 'no-store',
      headers,
      redirect: 'manual',
    });

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get('location');
      if (!location) return res.status(502).json({ error: 'hls_redirect_missing' });
      const redirected = new URL(location, rawUrl).toString();
      if (!isAllowedHlsUpstream(redirected)) return res.status(502).json({ error: 'hls_redirect_blocked' });
      return res.redirect(307, `${PROXY_PATH}?url=${encodeURIComponent(redirected)}`);
    }

    if (!upstream.ok) return res.status(upstream.status).send(await upstream.text());

    const contentType = upstream.headers.get('content-type') ?? '';
    const buffer = await upstream.arrayBuffer();
    const isPlaylist = contentType.includes('mpegurl') || new URL(rawUrl).pathname.toLowerCase().endsWith('.m3u8');

    res.setHeader('Cache-Control', 'no-store, max-age=0');
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) res.setHeader('Content-Range', contentRange);
    const acceptRanges = upstream.headers.get('accept-ranges');
    if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

    if (isPlaylist) {
      const rewritten = rewriteHlsPlaylist(new TextDecoder().decode(buffer), rawUrl, PROXY_PATH);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.status(upstream.status).send(rewritten);
    }

    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    return res.status(upstream.status).send(Buffer.from(buffer));
  } catch (error) {
    console.error('Chaturbate HLS proxy failed', error);
    return res.status(502).json({ error: 'hls_proxy_failed' });
  }
}
