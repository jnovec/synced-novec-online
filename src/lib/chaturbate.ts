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
    return new URL(data.streamUrl, window.location.origin).toString();
  } catch {
    return null;
  }
};
