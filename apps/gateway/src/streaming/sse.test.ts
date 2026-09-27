import {describe,it,expect} from 'vitest';
import {parseSse} from './sse.js';

describe('SSE parser',()=>{
  it('parses chunked events and ignores comments',async()=>{
    const chunks=[
      ': heartbeat\n\n',
      'event: message\ndata: {"text":"hel',
      'lo"}\n\n',
      'data: [DONE]\n\n',
    ];
    const stream=new ReadableStream<Uint8Array>({
      start(controller){for(const chunk of chunks)controller.enqueue(new TextEncoder().encode(chunk));controller.close();}
    });
    const events=[] as Array<{event?:string;data:string}>;
    for await(const event of parseSse(stream))events.push(event);
    expect(events).toEqual([{event:'message',data:'{"text":"hello"}'},{data:'[DONE]'}]);
  });
});
