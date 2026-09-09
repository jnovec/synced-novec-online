import { parseEdgeStreamResponse } from '@/lib/chaturbateEdge';
import { rewriteHlsPlaylist } from '@/lib/hlsProxy';
import type { NextApiRequest, NextApiResponse } from 'next';

const EDGE_API_URL = 'https://chaturbate.com/get_edge_hls_url_ajax/';
const PROXY_PATH = '/api/chaturbate-hls.m3u8';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const username = typeof req.query.username === 'string' ? req.query.username.trim() : '';
  if (!/^[a-z0-9_]{1,64}$/i.test(username)) return res.status(400).json({ error: 'invalid_username' });

  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const edgeResponse = await fetch(EDGE_API_URL, {
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
    if (!edgeResponse.ok) return res.status(edgeResponse.status).json({ error: 'edge_api_failed' });

    const parsed = parseEdgeStreamResponse(await edgeResponse.json());
    if (!parsed.streamUrl) return res.status(404).json({ error: 'stream_unavailable', room_status: parsed.roomStatus });

    const masterResponse = await fetch(parsed.streamUrl, {
      cache: 'no-store',
      headers: { accept: 'application/vnd.apple.mpegurl,*/*', 'user-agent': 'Mozilla/5.0' },
    });
    if (!masterResponse.ok) return res.status(masterResponse.status).send(await masterResponse.text());

    const master = await masterResponse.text();
    if (!master.startsWith('#EXTM3U')) return res.status(502).json({ error: 'invalid_master_playlist' });

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    return res.status(200).send(rewriteHlsPlaylist(master, parsed.streamUrl, PROXY_PATH));
  } catch (error) {
    console.error('Chaturbate live master resolve failed', error);
    return res.status(502).json({ error: 'live_master_failed' });
  }
}
