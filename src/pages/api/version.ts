import type { NextApiRequest, NextApiResponse } from 'next';

export default function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sha = process.env.NOVEC_BUILD_SHA || '';

  if (!/^[a-f0-9]{40}$/.test(sha)) {
    return res.status(503).json({
      status: 'unavailable',
      error: 'Build identity missing',
    });
  }

  return res.status(200).json({
    status: 'ok',
    commit: sha,
  });
}
