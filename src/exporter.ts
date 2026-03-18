import * as fs from 'fs';
import * as path from 'path';
import { ClaudeSession, SubAgent, ConversationMessage, ManagerSettings } from './types';

export interface ExportParams {
  projectKey: string;
  sessionId: string;
  displayName: string;
  session: ClaudeSession;
  readConversation: (projectKey: string, sessionId: string, agentId?: string) => ConversationMessage[];
}

export interface ExportResult {
  rootPath: string;
  agentPaths: string[];
  skippedAgents: number;
}

function slugify(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function agentLabel(agent: SubAgent): string {
  return agent.slug ? slugify(agent.slug) : agent.agentId.slice(0, 8);
}

function deduplicateLabels(agents: SubAgent[]): Map<SubAgent, string> {
  const counts = new Map<string, number>();
  for (const agent of agents) {
    const base = agentLabel(agent);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }

  const seen = new Map<string, number>();
  const result = new Map<SubAgent, string>();
  for (const agent of agents) {
    const base = agentLabel(agent);
    if (counts.get(base)! > 1) {
      const idx = (seen.get(base) ?? 0) + 1;
      seen.set(base, idx);
      result.set(agent, idx === 1 ? base : `${base}-${idx}`);
    } else {
      result.set(agent, base);
    }
  }

  return result;
}

function formatTimestamp(ts: string | undefined): string {
  if (!ts) return 'Unknown date';
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch {
    return 'Unknown date';
  }
}

function formatTime(ts: string | undefined): string {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function renderToolBlock(block: { content: string; preview?: string; input?: string; output?: string; isError?: boolean }, format: ManagerSettings['exportToolFormat']): string {
  if (format === 'omit') return '';

  const name = block.content;

  if (format === 'compact') {
    if (block.preview) {
      const preview = truncate(block.preview, 60);
      return `> **${name}** ${preview}\n\n`;
    }
    return `> **${name}**\n\n`;
  }

  // expanded
  const inputSection = block.input
    ? `>\n> *Input*\n> \`\`\`\n> ${block.input.split('\n').join('\n> ')}\n> \`\`\`\n`
    : '';
  const outputLabel = block.isError ? '*Error*' : '*Output*';
  const outputContent = block.output ?? '';
  const outputSection = `>\n> ${outputLabel}\n> \`\`\`\n> ${outputContent.split('\n').join('\n> ')}\n> \`\`\`\n`;

  return `> **${name}**\n${inputSection}${outputSection}\n`;
}

function renderMessages(messages: ConversationMessage[], format: ManagerSettings['exportToolFormat']): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const role = msg.role === 'user' ? 'You' : 'Claude';
    const timeStr = msg.timestamp ? ` · ${formatTime(msg.timestamp)}` : '';
    parts.push(`### ${role}${timeStr}\n`);

    for (const block of msg.blocks) {
      if (block.type === 'text') {
        parts.push(block.content.trim() + '\n\n');
      } else {
        const rendered = renderToolBlock(block, format);
        if (rendered) parts.push(rendered);
      }
    }
  }

  return parts.join('\n');
}

function buildRootMarkdown(
  session: ClaudeSession,
  displayName: string,
  messages: ConversationMessage[],
  agentLinks: Array<{ label: string; filename: string }>,
  format: ManagerSettings['exportToolFormat'],
): string {
  const titlePrompt = session.firstPrompt
    ? truncate(session.firstPrompt, 80)
    : session.sessionId.slice(0, 8);
  const date = formatTimestamp(session.firstTimestamp);

  const lines: string[] = [];
  lines.push(`# Session: ${titlePrompt}\n`);
  lines.push(`**Project:** ${displayName}`);
  if (session.gitBranch) {
    lines.push(`**Branch:** ${session.gitBranch}`);
  }
  lines.push(`**Date:** ${date}\n`);

  if (agentLinks.length > 0) {
    lines.push('## Agents\n');
    for (const { label, filename } of agentLinks) {
      lines.push(`- [${label}](./${filename})`);
    }
    lines.push('');
    lines.push('---\n');
  }

  lines.push('## Conversation\n');
  lines.push(renderMessages(messages, format));

  return lines.join('\n');
}

function buildAgentMarkdown(
  agent: SubAgent,
  label: string,
  rootFilename: string,
  messages: ConversationMessage[],
  format: ManagerSettings['exportToolFormat'],
): string {
  const title = agent.slug ?? agent.agentId.slice(0, 8);

  const lines: string[] = [];
  lines.push(`← [Back to session](./${rootFilename})\n`);
  lines.push(`# Agent: ${title}\n`);
  lines.push('## Conversation\n');
  lines.push(renderMessages(messages, format));

  return lines.join('\n');
}

export function exportConversation(
  params: ExportParams,
  settings: ManagerSettings,
  rootPath: string,
): ExportResult {
  const { projectKey, sessionId, displayName, session, readConversation } = params;
  const format = settings.exportToolFormat;

  const rootDir = path.dirname(rootPath);
  const rootBasename = path.basename(rootPath, '.md');

  // Resolve agent labels with deduplication
  const labelMap = deduplicateLabels(session.subAgents);

  // Read root conversation
  const rootMessages = readConversation(projectKey, sessionId);

  // Process each agent
  const agentLinks: Array<{ label: string; filename: string }> = [];
  const agentPaths: string[] = [];
  let skippedAgents = 0;

  for (const agent of session.subAgents) {
    const label = labelMap.get(agent)!;
    let agentMessages: ConversationMessage[];
    try {
      agentMessages = readConversation(projectKey, sessionId, agent.agentId);
      if (agentMessages.length === 0) throw new Error('empty');
    } catch {
      skippedAgents++;
      continue;
    }

    const agentFilename = `${rootBasename}-agent-${label}.md`;
    agentLinks.push({ label, filename: agentFilename });

    const agentContent = buildAgentMarkdown(agent, label, path.basename(rootPath), agentMessages, format);
    const agentPath = path.join(rootDir, agentFilename);
    fs.writeFileSync(agentPath, agentContent, 'utf-8');
    agentPaths.push(agentPath);
  }

  // Write root file
  const rootContent = buildRootMarkdown(session, displayName, rootMessages, agentLinks, format);
  fs.writeFileSync(rootPath, rootContent, 'utf-8');

  return { rootPath, agentPaths, skippedAgents };
}
