import { parseEdgeStreamResponse } from '@/lib/chaturbateEdge';
import type { NextApiRequest, NextApiResponse } from 'next';

const EDGE_API_URL = 'https://chaturbate.com/get_edge_hls_url_ajax/';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';
  if (!username) return res.status(400).json({ error: 'missing_username' });

  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const response = await fetch(EDGE_API_URL, {
      method: 'POST',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'user-agent': 'Mozilla/5.0',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: new URLSearchParams({ room_slug: username }),
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'edge_api_failed' });
    }

    const parsed = parseEdgeStreamResponse(await response.json());
    const streamUrl = parsed.streamUrl
      ? `/api/chaturbate-live.m3u8?username=${encodeURIComponent(username)}`
      : null;
    return res.status(200).json({
      username,
      room_status: parsed.roomStatus,
      streamUrl,
    });
  } catch (error) {
    console.error('Chaturbate stream resolve failed', error);
    return res.status(500).json({ error: 'stream_resolve_failed' });
  }
}
