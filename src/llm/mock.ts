import type { AssistantMessage, LLMProvider, Message } from './provider';
import { contentText } from './provider';

/** Create a deterministic mock LLM for tests and no-key demos. */
export function createMockLLM(): LLMProvider {
  return {
    chat: async ({ messages }) => buildResponse(messages),
  };
}

function buildResponse(messages: readonly Message[]): AssistantMessage {
  const lastToolMessage = findLastToolMessage(messages);

  if (!lastToolMessage) {
    return {
      role: 'assistant',
      content: 'I will call the time tool now.',
      toolCalls: [
        {
          id: 'mock-tool-call-1',
          type: 'function',
          function: {
            name: 'time',
            arguments: '{}',
          },
        },
      ],
    };
  }

  return {
    role: 'assistant',
    content: `The time tool returned: ${contentText(lastToolMessage.content)}`,
    toolCalls: [],
  };
}

function findLastToolMessage(messages: readonly Message[]): Message | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'tool') {
      return message;
    }
  }
  return undefined;
}
