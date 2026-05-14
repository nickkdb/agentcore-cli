import { BedrockAgentCoreApp } from 'bedrock-agentcore/runtime';
import { Agent, tool } from '@strands-agents/sdk';
import { loadModel } from './model/load.js';
import { getStreamableHttpMcpClient } from './mcp_client/client.js';

// Define a collection of MCP clients
const mcpClients = [getStreamableHttpMcpClient()].filter(Boolean);

// Define a collection of tools used by the model
const tools: unknown[] = [];

// Define a simple function tool
const addNumbers = tool({
  name: 'add_numbers',
  description: 'Return the sum of two numbers',
  inputSchema: {
    type: 'object',
    properties: {
      a: { type: 'number' },
      b: { type: 'number' },
    },
    required: ['a', 'b'],
  },
  callback: async ({ a, b }: { a: number; b: number }) => a + b,
});
tools.push(addNumbers);

// Add MCP clients to tools if available
for (const mcpClient of mcpClients) {
  if (mcpClient) {
    tools.push(mcpClient);
  }
}

const SYSTEM_PROMPT = `
You are a helpful assistant. Use tools when appropriate.
`;

let cachedAgent: Agent | null = null;

async function getOrCreateAgent(): Promise<Agent> {
  if (!cachedAgent) {
    const model = await loadModel();
    cachedAgent = new Agent({
      model,
      systemPrompt: SYSTEM_PROMPT,
      tools,
    });
  }
  return cachedAgent;
}

const app = new BedrockAgentCoreApp({
  invocationHandler: {
    async *process(payload: any, context: any) {
      const agent = await getOrCreateAgent();

      for await (const event of agent.stream(payload.prompt ?? '')) {
        if (
          event.type === 'modelStreamUpdateEvent' &&
          event.event?.type === 'modelContentBlockDeltaEvent' &&
          event.event.delta?.type === 'textDelta'
        ) {
          yield { data: event.event.delta.text };
        }
      }
    },
  },
});

app.run({ port: parseInt(process.env.PORT ?? '8080') });
