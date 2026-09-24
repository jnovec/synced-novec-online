import { buildBongaListingUrl, isBongaCamsUrl, parseBongaHomepage, parseBongaListing } from '@/lib/bongacams';
import {
  buildChaturbateListingUrl,
  extractChaturbateTags,
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
import { isCam4Url, parseCam4Listing } from '@/lib/cam4';
import { isMyFreeCamsUrl, parseMyFreeCamsListing } from '@/lib/myfreecams';
import { isYoutubeUrl, parseYoutubeVideos } from '@/lib/youtubeSource';
import { extractVideoChannels, isDirectMediaUrl, normalizeSourceUrl, sourceCategoryName } from '@/lib/sourceDiscovery';
import type { DiscoveredChannel } from '@/lib/sourceDiscovery';
import { assertPublicRemoteUrl, fetchPublicText } from '@/lib/safeRemoteFetch';
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });

  const rawUrl = typeof req.body?.url === 'string' ? req.body.url : '';
  const requestedTag = normalizeChaturbateTag(req.body?.tag);
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

    const isChaturbate = isChaturbateUrl(sourceUrl);
    const chaturbateTag = isChaturbate ? requestedTag || '18' : '';
    const discovered = isBongaCamsUrl(sourceUrl)
      ? await discoverBongaCams(sourceUrl)
      : isChaturbate
        ? await discoverChaturbate(sourceUrl, chaturbateTag)
        : isStripchatUrl(sourceUrl)
          ? await discoverStripchat(sourceUrl)
          : isCamSodaUrl(sourceUrl)
            ? await discoverCamSoda(sourceUrl)
            : isCam4Url(sourceUrl)
              ? await discoverCam4(sourceUrl)
              : isMyFreeCamsUrl(sourceUrl)
                ? await discoverMyFreeCams(sourceUrl)
                : isYoutubeUrl(sourceUrl)
                  ? await discoverYoutube(sourceUrl)
                : await discoverGeneric(sourceUrl);
    const { channels, finalUrl, tags } = discovered;
    if (!channels.length) return res.status(422).json({ error: 'no_videos_found' });

    return res.status(200).json({
      category: isChaturbate ? `${sourceCategoryName(finalUrl)} #${chaturbateTag}` : sourceCategoryName(finalUrl),
      sourceUrl: finalUrl.toString(),
      channels,
      ...(isChaturbate ? { tags: tags ?? [] } : {}),
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
  tags?: string[];
}

const discoverGeneric = async (sourceUrl: URL): Promise<DiscoveryResult> => {
  const fetched = await fetchPublicText(sourceUrl);
  return { channels: extractVideoChannels(fetched.text, fetched.finalUrl), finalUrl: fetched.finalUrl };
};

const discoverBongaCams = async (sourceUrl: URL): Promise<DiscoveryResult> => {
  try {
    const landing = await fetchPublicText(sourceUrl, {
      timeoutMs: 20_000,
      maxBytes: 8_000_000,
      headers: {
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
      },
    });

    const homepageChannels = parseBongaHomepage(landing.text, landing.finalUrl);
    if (homepageChannels.length) {
      return { channels: homepageChannels, finalUrl: landing.finalUrl };
    }

    const listingChannels = await tryBongaListing(landing.finalUrl, landing.setCookies);
    if (listingChannels.length) {
      return { channels: listingChannels, finalUrl: landing.finalUrl };
    }

    return {
      channels: extractVideoChannels(landing.text, landing.finalUrl),
      finalUrl: landing.finalUrl,
    };
  } catch (error) {
    console.warn('BongaCams homepage request failed', error instanceof Error ? error.message : error);
    const fallbackChannels = await tryBongaListing(sourceUrl);
    return { channels: fallbackChannels, finalUrl: sourceUrl };
  }
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

const discoverChaturbate = async (sourceUrl: URL, tag: string): Promise<DiscoveryResult> => {
  const directListing = await tryChaturbateListing(sourceUrl, [], tag);
  if (directListing.channels.length) return { ...directListing, finalUrl: sourceUrl };

  const landing = await fetchPublicText(sourceUrl, { timeoutMs: 20_000 });
  const listing = await tryChaturbateListing(landing.finalUrl, landing.setCookies, tag);
  return {
    channels: listing.channels.length ? listing.channels : extractVideoChannels(landing.text, landing.finalUrl),
    finalUrl: landing.finalUrl,
    tags: listing.tags,
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
  const landing = await fetchPublicText(sourceUrl, { timeoutMs: 20_000, maxBytes: 5_000_000 });
  const dedicated = parseCamSodaListing(landing.text, landing.finalUrl);
  const generic = extractVideoChannels(landing.text, landing.finalUrl);
  return {
    channels: dedicated.length ? dedicated : generic,
    finalUrl: landing.finalUrl,
  };
};

const discoverCam4 = async (sourceUrl: URL): Promise<DiscoveryResult> => {
  const landing = await fetchPublicText(sourceUrl, { timeoutMs: 20_000, maxBytes: 5_000_000 });
  const dedicated = parseCam4Listing(landing.text, landing.finalUrl);
  const generic = extractVideoChannels(landing.text, landing.finalUrl);
  return { channels: dedicated.length ? dedicated : generic, finalUrl: landing.finalUrl };
};

const discoverMyFreeCams = async (sourceUrl: URL): Promise<DiscoveryResult> => {
  const landing = await fetchPublicText(sourceUrl, { timeoutMs: 20_000, maxBytes: 5_000_000 });
  const dedicated = parseMyFreeCamsListing(landing.text, landing.finalUrl);
  const generic = extractVideoChannels(landing.text, landing.finalUrl);
  return { channels: dedicated.length ? dedicated : generic, finalUrl: landing.finalUrl };
};

const discoverYoutube = async (sourceUrl: URL): Promise<DiscoveryResult> => {
  const landing = await fetchPublicText(sourceUrl, { timeoutMs: 20_000, maxBytes: 8_000_000 });
  const channels = parseYoutubeVideos(landing.text, landing.finalUrl);
  return { channels: channels.length ? channels : extractVideoChannels(landing.text, landing.finalUrl), finalUrl: landing.finalUrl };
};

const tryChaturbateListing = async (sourceUrl: URL, setCookies: string[] = [], tag = ''): Promise<Pick<DiscoveryResult, 'channels' | 'tags'>> => {
  try {
    const cookie = requestCookieHeader(setCookies);
    const listing = await fetchPublicText(buildChaturbateListingUrl(sourceUrl, tag), {
      maxBytes: 5_000_000,
      timeoutMs: 25_000,
      headers: {
        accept: 'application/json, text/plain, */*',
        referer: `${sourceUrl.origin}/`,
        'x-requested-with': 'XMLHttpRequest',
        ...(cookie ? { cookie } : {}),
      },
    });
    const payload = JSON.parse(listing.text);
    return {
      channels: parseChaturbateListing(payload, sourceUrl),
      tags: extractChaturbateTags(payload),
    };
  } catch (error) {
    console.warn('Chaturbate listing request failed', error instanceof Error ? error.message : error);
    return { channels: [], tags: [] };
  }
};

const normalizeChaturbateTag = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const tag = value.trim().replace(/^#/, '').toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(tag) ? tag : '';
};

const requestCookieHeader = (setCookies: string[]): string =>
  setCookies
    .map((cookie) => cookie.split(';', 1)[0]?.trim())
    .filter(Boolean)
    .join('; ');
