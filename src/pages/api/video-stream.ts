import {
  buildBongaRoomDataUrl,
  extractBongaUsername,
  isBongaCamsUrl,
  parseBongaRoomStream,
} from '@/lib/bongacams';
import {
  buildStripchatRoomUrl,
  extractStripchatUsername,
  isStripchatUrl,
  parseStripchatRoomStream,
} from '@/lib/stripchat';
import { extractEmbeddedMediaUrls, isDirectMediaUrl, normalizeSourceUrl } from '@/lib/sourceDiscovery';
import { assertPublicRemoteUrl, fetchPublicText } from '@/lib/safeRemoteFetch';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const pageUrl = normalizeSourceUrl(rawUrl);
    await assertPublicRemoteUrl(pageUrl);
    if (isDirectMediaUrl(pageUrl.toString())) return res.status(200).json({ streamUrl: pageUrl.toString() });

    if (isBongaCamsUrl(pageUrl)) {
      const username = extractBongaUsername(pageUrl);
      if (username) {
        try {
          const roomData = await fetchPublicText(buildBongaRoomDataUrl(pageUrl, username), {
            maxBytes: 2_000_000,
            timeoutMs: 20_000,
            headers: {
              accept: 'application/json, text/javascript, */*;q=0.1',
              referer: pageUrl.toString(),
              'x-requested-with': 'XMLHttpRequest',
            },
          });
          const streamUrl = parseBongaRoomStream(JSON.parse(roomData.text), username);
          if (streamUrl) return res.status(200).json({ streamUrl });
        } catch (error) {
          console.warn('BongaCams stream lookup failed', error instanceof Error ? error.message : error);
        }
      }
    }

    if (isStripchatUrl(pageUrl)) {
      const username = extractStripchatUsername(pageUrl);
      if (username) {
        try {
          const room = await fetchPublicText(buildStripchatRoomUrl(pageUrl, username), {
            maxBytes: 2_000_000,
            timeoutMs: 20_000,
            headers: {
              accept: 'application/json',
              referer: pageUrl.toString(),
              'x-requested-with': 'XMLHttpRequest',
            },
          });
          const streamUrl = parseStripchatRoomStream(JSON.parse(room.text));
          if (streamUrl) return res.status(200).json({ streamUrl });
        } catch (error) {
          console.warn('Stripchat stream lookup failed', error instanceof Error ? error.message : error);
        }
      }
    }

    const fetched = await fetchPublicText(pageUrl, { maxBytes: 2_000_000 });
    const mediaUrls = extractEmbeddedMediaUrls(fetched.text, fetched.finalUrl);
    const streamUrl =
      mediaUrls.find((url) => /\.m3u8(?:$|[?#])/i.test(url)) ??
      mediaUrls.find((url) => /\.(?:mp4|webm|m4v|mov)(?:$|[?#])/i.test(url)) ??
      mediaUrls[0] ??
      null;

    return res.status(200).json({ streamUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'stream_resolve_failed';
    return res.status(400).json({ error: message, streamUrl: null });
  }
}
