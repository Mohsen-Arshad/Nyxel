export type SseEvent = { event?: string; data: string };

export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName: string | undefined;
  let data: string[] = [];

  const flush = (): SseEvent | undefined => {
    if (!data.length) {
      eventName = undefined;
      return undefined;
    }
    const event: SseEvent = { data: data.join('\n') };
    if (eventName) event.event = eventName;
    eventName = undefined;
    data = [];
    return event;
  };

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) {
        const event = flush();
        if (event) yield event;
        continue;
      }
      if (line.startsWith(':')) continue;
      const separator = line.indexOf(':');
      const field = separator >= 0 ? line.slice(0, separator) : line;
      const raw = separator >= 0 ? line.slice(separator + 1).replace(/^ /, '') : '';
      if (field === 'event') eventName = raw;
      if (field === 'data') data.push(raw);
    }
    if (done) break;
  }
  const event = flush();
  if (event) yield event;
}

export async function readError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.error && typeof parsed.error.message === 'string') return parsed.error.message;
    if (parsed.message) return parsed.message;
  } catch { /* keep raw response */ }
  return text.slice(0, 1000) || `HTTP ${response.status}`;
}
