import { buildBongaListingUrl, isBongaCamsUrl, parseBongaListing } from '@/lib/bongacams';
import {
  buildChaturbateListingUrl,
  isChaturbateUrl,
  parseChaturbateListing,
} from '@/lib/chaturbateSource';
import {
  buildStripchatLegacyListingUrl,
  buildStripchatListingBody,
  buildStripchatListingUrl,
  isStripchatUrl,
  parseStripchatListing,
} from '@/lib/stripchat';
import { isCamSodaUrl, parseCamSodaListing } from '@/lib/camsoda';
import { extractVideoChannels, isDirectMediaUrl, normalizeSourceUrl, sourceCategoryName } from '@/lib/sourceDiscovery';
import type { DiscoveredChannel } from '@/lib/sourceDiscovery';
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

    const discovered = isBongaCamsUrl(sourceUrl)
      ? await discoverBongaCams(sourceUrl)
      : isChaturbateUrl(sourceUrl)
        ? await discoverChaturbate(sourceUrl)
        : isStripchatUrl(sourceUrl)
          ? await discoverStripchat(sourceUrl)
          : isCamSodaUrl(sourceUrl)
            ? await discoverCamSoda(sourceUrl)
        : await discoverGeneric(sourceUrl);
    const { channels, finalUrl } = discovered;
    if (!channels.length) return res.status(422).json({ error: 'no_videos_found' });

    return res.status(200).json({
      category: sourceCategoryName(finalUrl),
      sourceUrl: finalUrl.toString(),
      channels,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'source_fetch_failed';
    const status = message.startsWith('source_http_') ? 502 : 400;
    console.error('Video source discovery failed', { error: message });
    return res.status(status).json({ error: message });
  }
}

interface DiscoveryResult {
  channels: DiscoveredChannel[];
  finalUrl: URL;
}

const discoverGeneric = async (sourceUrl: URL): Promise<DiscoveryResult> => {
  const fetched = await fetchPublicText(sourceUrl);
  return { channels: extractVideoChannels(fetched.text, fetched.finalUrl), finalUrl: fetched.finalUrl };
};

const discoverBongaCams = async (sourceUrl: URL): Promise<DiscoveryResult> => {
  sourceUrl = providerWebUrl(sourceUrl);
  const directChannels = await tryBongaListing(sourceUrl);
  if (directChannels.length) return { channels: directChannels, finalUrl: sourceUrl };

  const landing = await fetchPublicText(sourceUrl, { timeoutMs: 20_000 });
  const channels = await tryBongaListing(landing.finalUrl, landing.setCookies);
  return {
    channels: channels.length ? channels : extractVideoChannels(landing.text, landing.finalUrl),
    finalUrl: landing.finalUrl,
  };
};

const tryBongaListing = async (sourceUrl: URL, setCookies: string[] = []): Promise<DiscoveredChannel[]> => {
  const preferredTab = sourceUrl.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  const tabs = ['all', 'female', 'male', 'couples', 'transsexual'];
  if (tabs.includes(preferredTab)) tabs.unshift(tabs.splice(tabs.indexOf(preferredTab), 1)[0]);
  const cookie = requestCookieHeader(setCookies);

  for (const tab of tabs) {
    try {
      const listing = await fetchPublicText(buildBongaListingUrl(sourceUrl, tab), {
        maxBytes: 5_000_000,
        timeoutMs: 25_000,
        headers: {
          accept: 'application/json, text/javascript, */*;q=0.1',
          referer: `${sourceUrl.origin}/`,
          'x-requested-with': 'XMLHttpRequest',
          ...(cookie ? { cookie } : {}),
        },
      });
      const channels = parseBongaListing(JSON.parse(listing.text), sourceUrl);
      if (channels.length) return channels;
    } catch (error) {
      console.warn(`BongaCams ${tab} listing request failed`, error instanceof Error ? error.message : error);
    }
  }

  return [];
};

const discoverChaturbate = async (sourceUrl: URL): Promise<DiscoveryResult> => {
  const directChannels = await tryChaturbateListing(sourceUrl);
  if (directChannels.length) return { channels: directChannels, finalUrl: sourceUrl };

  const landing = await fetchPublicText(sourceUrl, { timeoutMs: 20_000 });
  const channels = await tryChaturbateListing(landing.finalUrl, landing.setCookies);
  return {
    channels: channels.length ? channels : extractVideoChannels(landing.text, landing.finalUrl),
    finalUrl: landing.finalUrl,
  };
};

const discoverStripchat = async (sourceUrl: URL): Promise<DiscoveryResult> => {
  try {
    const listing = await fetchPublicText(buildStripchatListingUrl(sourceUrl), {
      method: 'POST',
      body: buildStripchatListingBody(),
      maxBytes: 5_000_000,
      timeoutMs: 25_000,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        origin: sourceUrl.origin,
        referer: `${sourceUrl.origin}/`,
        'x-requested-with': 'XMLHttpRequest',
      },
    });
    const channels = parseStripchatListing(JSON.parse(listing.text), sourceUrl);
    if (channels.length) return { channels, finalUrl: sourceUrl };
  } catch (error) {
    console.warn('Stripchat listing request failed', error instanceof Error ? error.message : error);
  }

  try {
    const listing = await fetchPublicText(buildStripchatLegacyListingUrl(sourceUrl), {
      maxBytes: 5_000_000,
      timeoutMs: 25_000,
      headers: { accept: 'application/json', referer: `${sourceUrl.origin}/`, 'x-requested-with': 'XMLHttpRequest' },
    });
    return { channels: parseStripchatListing(JSON.parse(listing.text), sourceUrl), finalUrl: sourceUrl };
  } catch (error) {
    console.warn('Stripchat legacy listing request failed', error instanceof Error ? error.message : error);
    const landing = await fetchPublicText(sourceUrl, { timeoutMs: 20_000 });
    return { channels: extractVideoChannels(landing.text, landing.finalUrl), finalUrl: landing.finalUrl };
  }
};

const discoverCamSoda = async (sourceUrl: URL): Promise<DiscoveryResult> => {
  sourceUrl = providerWebUrl(sourceUrl);
  const landing = await fetchPublicText(sourceUrl, { timeoutMs: 20_000, maxBytes: 5_000_000 });
  const dedicated = parseCamSodaListing(landing.text, landing.finalUrl);
  const generic = extractVideoChannels(landing.text, landing.finalUrl);
  return {
    channels: dedicated.length ? dedicated : generic,
    finalUrl: landing.finalUrl,
  };
};

const providerWebUrl = (sourceUrl: URL): URL => {
  const canonical = new URL(sourceUrl);
  if (canonical.hostname === 'bongacams.com' || canonical.hostname === 'camsoda.com') {
    canonical.hostname = `www.${canonical.hostname}`;
  }
  return canonical;
};

const tryChaturbateListing = async (sourceUrl: URL, setCookies: string[] = []): Promise<DiscoveredChannel[]> => {
  try {
    const cookie = requestCookieHeader(setCookies);
    const listing = await fetchPublicText(buildChaturbateListingUrl(sourceUrl), {
      maxBytes: 5_000_000,
      timeoutMs: 25_000,
      headers: {
        accept: 'application/json, text/plain, */*',
        referer: `${sourceUrl.origin}/`,
        'x-requested-with': 'XMLHttpRequest',
        ...(cookie ? { cookie } : {}),
      },
    });
    return parseChaturbateListing(JSON.parse(listing.text), sourceUrl);
  } catch (error) {
    console.warn('Chaturbate listing request failed', error instanceof Error ? error.message : error);
    return [];
  }
};

const requestCookieHeader = (setCookies: string[]): string =>
  setCookies
    .map((cookie) => cookie.split(';', 1)[0]?.trim())
    .filter(Boolean)
    .join('; ');
