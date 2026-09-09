import { lookup } from 'node:dns/promises';
import type { NextApiRequest, NextApiResponse } from 'next';

const MAX_PLAYLIST_BYTES = 2_000_000;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const playlistUrl = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
  if (!playlistUrl) return res.status(400).json({ error: 'missing_url' });

  try {
    const url = new URL(playlistUrl);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('only_http_urls');

    // Follow redirects manually - no automatic redirect-follow to prevent SSRF
    let currentUrl = url;
    let content = '';
    for (let redirectNum = 0; redirectNum < 10; redirectNum += 1) {
      const response = await fetch(currentUrl.href, {
        headers: { accept: 'text/plain, application/vnd.apple.mpegurl, audio/mpegurl, */*' },
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`playlist_http_${response.status}`);
      const newLocation = response.headers.get('location');
      if (newLocation) {
        const redirectUrl = new URL(newLocation, currentUrl.href);
        // Verify the redirect stays on approved hosts only to prevent SSRF
        const allowed = ['chaturbate.com', 'mmcdn.com', '.live.mmcdn.com'];
        const hostOk = allowed.some(h => currentUrl.hostname === h || currentUrl.hostname.endsWith('.' + h));
        if (!hostOk) throw new Error('playlist_redirect_ssrf_blocked');
        currentUrl = redirectUrl;
        continue;
      }
      content = (await response.text()).slice(0, MAX_PLAYLIST_BYTES);
      break;
    }

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
