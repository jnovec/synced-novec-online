import { fetchPublicText } from '../../lib/safeRemoteFetch';
import type { NextApiRequest, NextApiResponse } from 'next';

const MAX_PLAYLIST_BYTES = 2_000_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const playlistUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!playlistUrl) return res.status(400).json({ error: 'missing_url' });

  try {
    const url = new URL(playlistUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('only_http_urls');

    const { text: content } = await fetchPublicText(url, {
      maxBytes: MAX_PLAYLIST_BYTES,
      headers: { accept: 'text/plain, application/vnd.apple.mpegurl, audio/mpegurl, */*' },
    });

    const usernames = extractChaturbateUsernames(content);

    return res.status(200).json({
      rooms: usernames.map((name) => ({
        name,
        location: 'importovaný playlist',
        url: `https://chaturbate.com/${name}/`,
        logo: `https://thumb.live.mmcdn.com/riw/${name}.jpg`,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'playlist_fetch_failed';
    return res.status(400).json({ error: message });
  }
}

function extractChaturbateUsernames(content: string): string[] {
  // Match /chaturbate.com/jmeno/ case-insensitively
  const regex = /(?:https?:\/\/)?(?:www\.)?chaturbate\.com\/([a-zA-Z0-9_-]+)\/?/gi;
  const matches = content.matchAll(regex);
  const unique = new Set<string>();
  for (const m of matches) {
    unique.add(m[1].toLowerCase());
  }
  return Array.from(unique).slice(0, 250);
}
