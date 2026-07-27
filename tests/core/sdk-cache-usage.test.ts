import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import type { Model } from '@earendil-works/pi-ai';

test('pi-ai returns cache token lengths parsed from OpenAI and DeepSeek usage responses', async (context) => {
  let requestCount = 0;
  const server = createServer((request, response) => {
    request.resume();
    requestCount++;
    const usage = requestCount === 1
      ? {
          prompt_tokens: 2048,
          completion_tokens: 1,
          total_tokens: 2049,
          prompt_tokens_details: {
            cached_tokens: 1536,
            cache_write_tokens: 256,
          },
        }
      : {
          prompt_tokens: 2048,
          completion_tokens: 1,
          total_tokens: 2049,
          prompt_cache_hit_tokens: 1536,
          prompt_cache_miss_tokens: 512,
        };
    const chunk = {
      id: `cache-probe-${requestCount}`,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'cache-probe',
      choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      usage,
    };
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => server.close());

  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Mock server did not bind a TCP port');
  const model: Model<'openai-completions'> = {
    id: 'cache-probe',
    name: 'Cache probe',
    api: 'openai-completions',
    provider: 'cache-probe',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 32,
  };
  const run = async () => {
    const stream = streamSimple(
      model,
      { messages: [{ role: 'user', content: 'Reply with OK.', timestamp: 1 }] },
      { apiKey: 'local-test-key', maxTokens: 8, maxRetries: 0 },
    );
    for await (const _event of stream) { /* drain the real SDK response parser */ }
    return stream.result();
  };

  const openAi = await run();
  assert.deepEqual(
    {
      input: openAi.usage.input,
      cacheRead: openAi.usage.cacheRead,
      cacheWrite: openAi.usage.cacheWrite,
      totalTokens: openAi.usage.totalTokens,
    },
    { input: 256, cacheRead: 1536, cacheWrite: 256, totalTokens: 2049 },
  );

  const deepSeek = await run();
  assert.deepEqual(
    {
      input: deepSeek.usage.input,
      cacheRead: deepSeek.usage.cacheRead,
      cacheWrite: deepSeek.usage.cacheWrite,
      totalTokens: deepSeek.usage.totalTokens,
    },
    { input: 512, cacheRead: 1536, cacheWrite: 0, totalTokens: 2049 },
  );
});
