import { extractVideoChannels, isDirectMediaUrl, normalizeSourceUrl, sourceCategoryName } from '@/lib/sourceDiscovery';
import { assertPublicRemoteUrl, fetchPublicText } from '@/lib/safeRemoteFetch';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  try {
    const sourceUrl = normalizeSourceUrl(rawUrl);
    await assertPublicRemoteUrl(sourceUrl);

    if (isDirectMediaUrl(sourceUrl.toString())) {
      return res.status(200).json({
        category: sourceCategoryName(sourceUrl),
        sourceUrl: sourceUrl.toString(),
        channels: [
          {
            name: decodeURIComponent(sourceUrl.pathname.split('/').filter(Boolean).at(-1) ?? 'video'),
            location: sourceUrl.hostname,
            url: sourceUrl.toString(),
            logo: '',
            playbackUrl: sourceUrl.toString(),
          },
        ],
      });
    }

    const fetched = await fetchPublicText(sourceUrl);
    const channels = extractVideoChannels(fetched.text, fetched.finalUrl);
    if (!channels.length) return res.status(422).json({ error: 'no_videos_found' });

    return res.status(200).json({
      category: sourceCategoryName(fetched.finalUrl),
      sourceUrl: fetched.finalUrl.toString(),
      channels,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'source_fetch_failed';
    const status = message.startsWith('source_http_') ? 502 : 400;
    console.error('Video source discovery failed', { error: message });
    return res.status(status).json({ error: message });
  }
}
