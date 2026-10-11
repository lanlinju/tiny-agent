/** Build the default system prompt for the local developer agent. */
export function defaultSystemPrompt(): string {
  return [
    'You are a coding agent.',
  ].join('\n');
}
