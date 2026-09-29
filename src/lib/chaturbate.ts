export const extractChaturbateUsername = (roomUrl: string): string | null => {
  const match = roomUrl.match(/chaturbate\.com\/([^/?#]+)\/?/i);
  return match?.[1] ?? null;
};

export const resolveChaturbateStreamUrl = async (roomUrl: string): Promise<string | null> => {
  const username = extractChaturbateUsername(roomUrl);
  if (!username) return null;

  try {
    const response = await fetch(`/api/chaturbate-stream?username=${encodeURIComponent(username)}`, {
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { streamUrl?: string | null };
    if (typeof data.streamUrl !== 'string' || !data.streamUrl) return null;
    const streamUrl = new URL(data.streamUrl, window.location.origin);
    // ReactPlayer only reloads reliably when the source itself changes. The
    // endpoint creates a fresh upstream HLS session on every request, so make
    // that refresh explicit instead of leaving a stalled player on its old URL.
    streamUrl.searchParams.set('_synced', `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    return streamUrl.toString();
  } catch {
    return null;
  }
};
