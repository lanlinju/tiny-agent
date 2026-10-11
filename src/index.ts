import { AgentCommandSchema } from './protocols/commands';
import { AgentEventSchema } from './protocols/events';

const protocolNames = {
  commands: AgentCommandSchema.options.length,
  events: AgentEventSchema.options.length,
};

console.log(`ready protocols=${protocolNames.events}+${protocolNames.commands}`);
