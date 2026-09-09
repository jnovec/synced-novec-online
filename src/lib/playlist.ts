interface PlaylistEntry {
  name: string;
  streamUrl: string;
}

export const buildM3uPlaylist = (entries: PlaylistEntry[]): string => {
  const lines = ['#EXTM3U'];

  for (const entry of entries) {
    const url = new URL(entry.streamUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !url.pathname.toLowerCase().endsWith('.m3u8')) {
      throw new Error(`Položka ${entry.name} nemá přímou M3U8 adresu.`);
    }

    const safeName = entry.name.replace(/[\r\n]+/g, ' ').trim() || 'Stream';
    lines.push(`#EXTINF:-1,${safeName}`, entry.streamUrl);
  }

  return `${lines.join('\n')}\n`;
};
