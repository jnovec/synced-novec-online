interface EdgeStreamPayload {
  success?: boolean;
  url?: unknown;
  room_status?: unknown;
}

interface ParsedEdgeStream {
  streamUrl: string | null;
  roomStatus: string | null;
}

export const parseEdgeStreamResponse = (payload: EdgeStreamPayload): ParsedEdgeStream => {
  const roomStatus = typeof payload.room_status === 'string' ? payload.room_status : null;
  if (!payload.success || typeof payload.url !== 'string') return { streamUrl: null, roomStatus };

  try {
    const url = new URL(payload.url);
    const valid = ['http:', 'https:'].includes(url.protocol) && url.pathname.toLowerCase().endsWith('.m3u8');
    return { streamUrl: valid ? payload.url : null, roomStatus };
  } catch {
    return { streamUrl: null, roomStatus };
  }
};
