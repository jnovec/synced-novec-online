import { buildChaturbateListingUrl, extractChaturbateTags, isChaturbateUrl } from '@/lib/chaturbateSource';
import { normalizeSourceUrl } from '@/lib/sourceDiscovery';
import { assertPublicRemoteUrl, fetchPublicText } from '@/lib/safeRemoteFetch';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const sourceUrl = normalizeSourceUrl(rawUrl);
    if (!isChaturbateUrl(sourceUrl)) return res.status(400).json({ error: 'not_chaturbate' });
    await assertPublicRemoteUrl(sourceUrl);

    const listing = await fetchPublicText(buildChaturbateListingUrl(sourceUrl), {
      timeoutMs: 15_000,
      maxBytes: 4_000_000,
      headers: {
        accept: 'application/json, text/plain, */*',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      },
    });

    let payload: unknown;
    try {
      payload = JSON.parse(listing.text);
    } catch {
      return res.status(502).json({ error: 'invalid_chaturbate_response' });
    }

    return res.status(200).json({ tags: extractChaturbateTags(payload) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'tag_fetch_failed';
    console.error('Chaturbate tag list fetch failed', { error: message });
    return res.status(502).json({ error: message });
  }
}
