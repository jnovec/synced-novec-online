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
