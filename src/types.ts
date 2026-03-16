export interface SubAgent {
  agentId: string;
  slug?: string;
  firstPrompt?: string;
  firstTimestamp?: string;
  lastTimestamp?: string;
  messageCount: number;
  lastMessageRole?: string;
}

export interface ClaudeSession {
  sessionId: string;
  cwd?: string;
  gitBranch?: string;
  firstPrompt?: string;
  firstTimestamp?: string;
  lastTimestamp?: string;
  messageCount: number;
  subAgents: SubAgent[];
  lastMessageRole?: string;
}

export interface ClaudeProject {
  key: string;
  path: string;
  displayName: string;
  sessions: ClaudeSession[];
  lastActivity?: string;
}

export interface MessageBlock {
  type: 'text' | 'tool';
  content: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  blocks: MessageBlock[];
  timestamp?: string;
}
