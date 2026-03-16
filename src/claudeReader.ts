import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ClaudeProject, ClaudeSession, SubAgent, ConversationMessage, MessageBlock } from './types';

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const MAX_SESSION_AGE_DAYS = 30;

interface RawMessage {
  type: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  message?: {
    content?: string | Array<{ type: string; text?: string; name?: string }>;
  };
  agentId?: string;
  slug?: string;
  isMeta?: boolean;
}

function extractText(msg: RawMessage): string | undefined {
  const content = msg.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item.type === 'text' && item.text) return item.text;
    }
  }
  return undefined;
}

function parseJsonlFile(filePath: string): RawMessage[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const messages: RawMessage[] = [];
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        messages.push(JSON.parse(trimmed));
      } catch {
        // skip malformed lines
      }
    }
    return messages;
  } catch {
    return [];
  }
}

function isCommandMessage(text: string): boolean {
  return (
    text.includes('<command-name>') ||
    text.includes('<command-message>') ||
    text.startsWith('/')
  );
}

function parseSubAgent(agentFilePath: string): SubAgent | null {
  const messages = parseJsonlFile(agentFilePath);
  if (messages.length === 0) return null;

  const agentId = path.basename(agentFilePath, '.jsonl').replace('agent-', '');
  let slug: string | undefined;
  let firstPrompt: string | undefined;
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let messageCount = 0;
  let lastMessageRole: string | undefined;

  for (const msg of messages) {
    if (msg.timestamp) {
      if (!firstTimestamp) firstTimestamp = msg.timestamp;
      lastTimestamp = msg.timestamp;
    }
    if (msg.slug && !slug) slug = msg.slug;

    if (msg.type === 'user' && !msg.isMeta && !firstPrompt) {
      const text = extractText(msg);
      if (text && text.length > 10 && !isCommandMessage(text)) {
        firstPrompt = text.substring(0, 200);
      }
    }

    if (msg.type === 'user' || msg.type === 'assistant') {
      messageCount++;
      lastMessageRole = msg.type;
    }
  }

  return { agentId, slug, firstPrompt, firstTimestamp, lastTimestamp, messageCount, lastMessageRole };
}

function parseSession(
  sessionFilePath: string,
  sessionId: string
): ClaudeSession | null {
  const messages = parseJsonlFile(sessionFilePath);
  if (messages.length === 0) return null;

  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let firstPrompt: string | undefined;
  let firstTimestamp: string | undefined;
  let lastTimestamp: string | undefined;
  let messageCount = 0;
  let lastMessageRole: string | undefined;

  for (const msg of messages) {
    if (msg.timestamp) {
      if (!firstTimestamp) firstTimestamp = msg.timestamp;
      lastTimestamp = msg.timestamp;
    }
    if (msg.cwd && !cwd) cwd = msg.cwd;
    if (msg.gitBranch && !gitBranch) gitBranch = msg.gitBranch;

    if (msg.type === 'user' && !msg.isMeta && !firstPrompt) {
      const text = extractText(msg);
      if (text && text.length > 10 && !isCommandMessage(text)) {
        firstPrompt = text.substring(0, 300);
      }
    }

    if (msg.type === 'user' || msg.type === 'assistant') {
      messageCount++;
      lastMessageRole = msg.type;
    }
  }

  if (lastTimestamp) {
    const ageDays =
      (Date.now() - new Date(lastTimestamp).getTime()) / 86400000;
    if (ageDays > MAX_SESSION_AGE_DAYS) return null;
  }

  const subAgents: SubAgent[] = [];
  const sessionDir = sessionFilePath.replace(/\.jsonl$/, '');
  const subagentsDir = path.join(sessionDir, 'subagents');

  if (fs.existsSync(subagentsDir)) {
    try {
      for (const file of fs.readdirSync(subagentsDir)) {
        if (file.endsWith('.jsonl')) {
          const agent = parseSubAgent(path.join(subagentsDir, file));
          if (agent) subAgents.push(agent);
        }
      }
    } catch {
      // ignore read errors
    }
  }

  return {
    sessionId,
    cwd,
    gitBranch,
    firstPrompt,
    firstTimestamp,
    lastTimestamp,
    messageCount,
    subAgents,
    lastMessageRole,
  };
}

export function readClaudeProjects(): ClaudeProject[] {
  if (!fs.existsSync(PROJECTS_DIR)) return [];

  const projects: ClaudeProject[] = [];

  let projectDirs: string[];
  try {
    projectDirs = fs
      .readdirSync(PROJECTS_DIR)
      .filter((d) =>
        fs.statSync(path.join(PROJECTS_DIR, d)).isDirectory()
      );
  } catch {
    return [];
  }

  for (const dirName of projectDirs) {
    const projectPath = path.join(PROJECTS_DIR, dirName);
    const sessions: ClaudeSession[] = [];
    let projectCwd: string | undefined;

    try {
      const jsonlFiles = fs
        .readdirSync(projectPath)
        .filter((f) => f.endsWith('.jsonl'));

      for (const file of jsonlFiles) {
        const sessionId = file.replace(/\.jsonl$/, '');
        const session = parseSession(
          path.join(projectPath, file),
          sessionId
        );
        if (session) {
          sessions.push(session);
          if (!projectCwd && session.cwd) projectCwd = session.cwd;
        }
      }
    } catch {
      continue;
    }

    if (sessions.length === 0) continue;

    sessions.sort((a, b) => {
      const at = a.lastTimestamp ? new Date(a.lastTimestamp).getTime() : 0;
      const bt = b.lastTimestamp ? new Date(b.lastTimestamp).getTime() : 0;
      return bt - at;
    });

    const actualPath = projectCwd ?? decodeDirName(dirName);
    const displayName = path.basename(actualPath);
    const lastActivity = sessions[0]?.lastTimestamp;

    projects.push({
      key: dirName,
      path: actualPath,
      displayName,
      sessions,
      lastActivity,
    });
  }

  projects.sort((a, b) => {
    const at = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
    const bt = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
    return bt - at;
  });

  return projects;
}

function decodeDirName(dirName: string): string {
  // Best-effort: leading - is /, each remaining - is /
  return '/' + dirName.replace(/^-/, '').replaceAll('-', '/');
}

export function readConversation(
  projectKey: string,
  sessionId: string,
  agentId?: string
): ConversationMessage[] {
  let filePath: string;
  if (agentId) {
    filePath = path.join(PROJECTS_DIR, projectKey, sessionId, 'subagents', `agent-${agentId}.jsonl`);
  } else {
    filePath = path.join(PROJECTS_DIR, projectKey, `${sessionId}.jsonl`);
  }

  const messages = parseJsonlFile(filePath);
  const conversation: ConversationMessage[] = [];

  for (const msg of messages) {
    if (msg.type !== 'user' && msg.type !== 'assistant') continue;
    if (msg.isMeta) continue;

    const blocks: MessageBlock[] = [];
    const content = msg.message?.content;

    if (typeof content === 'string') {
      if (content.trim()) {
        blocks.push({ type: 'text', content });
      }
    } else if (Array.isArray(content)) {
      for (const item of content) {
        if (item.type === 'text' && item.text) {
          blocks.push({ type: 'text', content: item.text });
        } else if (item.type === 'tool_use' && item.name) {
          blocks.push({ type: 'tool', content: item.name });
        }
      }
    }

    if (blocks.length > 0) {
      conversation.push({
        role: msg.type === 'user' ? 'user' : 'assistant',
        blocks,
        timestamp: msg.timestamp,
      });
    }
  }

  return conversation;
}
