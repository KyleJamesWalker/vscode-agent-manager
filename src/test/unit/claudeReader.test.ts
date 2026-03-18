jest.mock('os', () => ({ homedir: () => '/home/test' }));
jest.mock('fs');

import * as fs from 'fs';
import {
  readConversation,
  readClaudeProjects,
  decodeDirName,
  formatToolInput,
  generateToolPreview,
} from '../../claudeReader';

const PROJECTS = '/home/test/.claude/projects';

describe('decodeDirName', () => {
  test('converts leading dash to slash', () => {
    expect(decodeDirName('-Users-alice-work')).toBe('/Users/alice/work');
  });

  test('single segment with no leading dash', () => {
    expect(decodeDirName('tmp')).toBe('/tmp');
  });
});

describe('formatToolInput', () => {
  test('Bash returns command string', () => {
    expect(formatToolInput('Bash', { command: 'npm test' })).toBe('npm test');
  });

  test('Read returns file_path', () => {
    expect(formatToolInput('Read', { file_path: '/src/foo.ts' })).toBe('/src/foo.ts');
  });

  test('Grep returns pattern and path', () => {
    expect(formatToolInput('Grep', { pattern: 'foo', path: '/src' })).toBe('foo in /src');
  });

  test('Skill returns /skill-name', () => {
    expect(formatToolInput('Skill', { skill: 'brainstorming' })).toBe('/brainstorming');
  });

  test('unknown tool falls back to JSON', () => {
    const result = formatToolInput('Unknown', { x: 1 });
    expect(result).toContain('"x"');
  });
});

describe('generateToolPreview', () => {
  test('Bash truncates long command with ellipsis', () => {
    const cmd = 'a'.repeat(90);
    const preview = generateToolPreview('Bash', { command: cmd });
    expect(preview.startsWith('$ ')).toBe(true);
    expect(preview.endsWith('\u2026')).toBe(true);
    expect(preview.length).toBe(80); // '$ ' + 77 chars + '…'
  });

  test('Bash returns full command when short', () => {
    expect(generateToolPreview('Bash', { command: 'ls' })).toBe('$ ls');
  });

  test('Read returns filename', () => {
    expect(generateToolPreview('Read', { file_path: '/src/foo.ts' })).toBe('foo.ts');
  });

  test('Grep includes result count when output present', () => {
    const preview = generateToolPreview('Grep', { pattern: 'foo' }, 'match1\nmatch2\n');
    expect(preview).toContain('2 matches');
  });

  test('Agent returns description', () => {
    expect(generateToolPreview('Agent', { description: 'explore codebase' })).toBe('explore codebase');
  });

  test('WebFetch returns hostname', () => {
    expect(generateToolPreview('WebFetch', { url: 'https://example.com/foo' })).toBe('example.com');
  });
});

describe('readConversation', () => {
  beforeEach(() => jest.clearAllMocks());

  test('parses string content as a text block', () => {
    jest.mocked(fs.readFileSync).mockReturnValue(
      '{"type":"user","message":{"content":"Hello world"}}\n'
    );
    const result = readConversation('proj', 'sess');
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe('user');
    expect(result[0].blocks).toEqual([{ type: 'text', content: 'Hello world' }]);
  });

  test('parses array content text item as a text block', () => {
    jest.mocked(fs.readFileSync).mockReturnValue(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Hi there"}]}}\n'
    );
    const result = readConversation('proj', 'sess');
    expect(result[0].blocks).toEqual([{ type: 'text', content: 'Hi there' }]);
  });

  test('pairs tool_use with tool_result by tool_use_id', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/foo.ts' } }] },
      }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file body' }] },
      }),
    ].join('\n');
    jest.mocked(fs.readFileSync).mockReturnValue(lines);
    const result = readConversation('proj', 'sess');
    const assistantMsg = result.find((m) => m.role === 'assistant')!;
    expect(assistantMsg.blocks[0]).toMatchObject({
      type: 'tool',
      content: 'Read',
      output: 'file body',
    });
  });

  test('extracts tool_result with array content', () => {
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'ls' } }] },
      }),
      JSON.stringify({
        type: 'user',
        message: {
          content: [{
            type: 'tool_result',
            tool_use_id: 'tu2',
            content: [{ type: 'text', text: 'file-a\nfile-b' }],
          }],
        },
      }),
    ].join('\n');
    jest.mocked(fs.readFileSync).mockReturnValue(lines);
    const result = readConversation('proj', 'sess');
    const assistantMsg = result.find((m) => m.role === 'assistant')!;
    expect(assistantMsg.blocks[0]).toMatchObject({
      type: 'tool',
      content: 'Bash',
      output: 'file-a\nfile-b',
    });
  });

  test('filters out isMeta:true messages', () => {
    const lines = [
      JSON.stringify({ type: 'user', isMeta: true, message: { content: 'meta' } }),
      JSON.stringify({ type: 'user', message: { content: 'real' } }),
    ].join('\n');
    jest.mocked(fs.readFileSync).mockReturnValue(lines);
    const result = readConversation('proj', 'sess');
    expect(result).toHaveLength(1);
    expect(result[0].blocks[0].content).toBe('real');
  });

  test('skips malformed JSONL lines without throwing', () => {
    jest.mocked(fs.readFileSync).mockReturnValue(
      '{"type":"user","message":{"content":"ok"}}\nnot-json\n{"type":"assistant","message":{"content":[{"type":"text","text":"fine"}]}}\n'
    );
    const result = readConversation('proj', 'sess');
    expect(result).toHaveLength(2);
  });

  test('uses agentId path when provided', () => {
    jest.mocked(fs.readFileSync).mockReturnValue('');
    readConversation('proj', 'sess', 'agent123');
    const calledPath = String(jest.mocked(fs.readFileSync).mock.calls[0][0]);
    expect(calledPath).toContain('subagents');
    expect(calledPath).toContain('agent-agent123.jsonl');
  });
});

describe('readClaudeProjects', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns empty array when PROJECTS_DIR does not exist', () => {
    jest.mocked(fs.existsSync).mockReturnValue(false);
    expect(readClaudeProjects()).toEqual([]);
  });

  test('filters sessions with lastTimestamp older than 30 days', () => {
    const oldTs = new Date(Date.now() - 31 * 86400000).toISOString();
    jest.mocked(fs.existsSync).mockImplementation((p) => p === PROJECTS);
    jest.mocked(fs.readdirSync)
      .mockReturnValueOnce(['proj1'] as any)
      .mockReturnValueOnce(['session.jsonl'] as any);
    jest.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
    jest.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ type: 'user', timestamp: oldTs, cwd: '/work', message: { content: 'hi' } })
    );
    expect(readClaudeProjects()).toEqual([]);
  });

  test('sorts projects by lastActivity descending', () => {
    const ts1 = new Date(Date.now() - 2 * 86400000).toISOString();
    const ts2 = new Date(Date.now() - 1 * 86400000).toISOString();
    jest.mocked(fs.existsSync).mockImplementation((p) => p === PROJECTS);
    jest.mocked(fs.readdirSync)
      .mockReturnValueOnce(['proj1', 'proj2'] as any)
      .mockReturnValueOnce(['a.jsonl'] as any)
      .mockReturnValueOnce(['b.jsonl'] as any);
    jest.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
    jest.mocked(fs.readFileSync)
      .mockReturnValueOnce(
        JSON.stringify({ type: 'user', timestamp: ts1, cwd: '/work/proj1', message: { content: 'hello world' } })
      )
      .mockReturnValueOnce(
        JSON.stringify({ type: 'user', timestamp: ts2, cwd: '/work/proj2', message: { content: 'hello world' } })
      );
    const projects = readClaudeProjects();
    expect(projects[0].displayName).toBe('proj2');
    expect(projects[1].displayName).toBe('proj1');
  });

  test('falls back to decodeDirName when session has no cwd', () => {
    const recentTs = new Date().toISOString();
    jest.mocked(fs.existsSync).mockImplementation((p) => p === PROJECTS);
    jest.mocked(fs.readdirSync)
      .mockReturnValueOnce(['-Users-alice-work'] as any)
      .mockReturnValueOnce(['session.jsonl'] as any);
    jest.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
    jest.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ type: 'user', timestamp: recentTs, message: { content: 'hello world' } })
    );
    const projects = readClaudeProjects();
    expect(projects[0].path).toBe('/Users/alice/work');
    expect(projects[0].displayName).toBe('work');
  });
});

describe('deriveStatus (via readClaudeProjects)', () => {
  beforeEach(() => jest.clearAllMocks());

  const recentTs = () => new Date().toISOString();

  function setupSingleProject(jsonlContent: string): void {
    jest.mocked(fs.existsSync).mockImplementation((p) => p === PROJECTS);
    jest.mocked(fs.readdirSync)
      .mockReturnValueOnce(['proj1'] as any)
      .mockReturnValueOnce(['session.jsonl'] as any);
    jest.mocked(fs.statSync).mockReturnValue({ isDirectory: () => true } as any);
    jest.mocked(fs.readFileSync).mockReturnValue(jsonlContent);
  }

  test('active when last message is user', () => {
    setupSingleProject(
      JSON.stringify({ type: 'user', timestamp: recentTs(), cwd: '/work', message: { content: 'hello world' } })
    );
    const projects = readClaudeProjects();
    expect(projects[0].sessions[0].status).toBe('active');
  });

  test('waiting when last message is assistant with text content', () => {
    const lines = [
      JSON.stringify({ type: 'user', timestamp: recentTs(), cwd: '/work', message: { content: 'hello world' } }),
      JSON.stringify({ type: 'assistant', timestamp: recentTs(), message: { content: [{ type: 'text', text: 'Done' }] } }),
    ].join('\n');
    setupSingleProject(lines);
    const projects = readClaudeProjects();
    expect(projects[0].sessions[0].status).toBe('waiting');
  });

  test('thinking when last assistant message ends with tool_use', () => {
    const lines = [
      JSON.stringify({ type: 'user', timestamp: recentTs(), cwd: '/work', message: { content: 'hello world' } }),
      JSON.stringify({ type: 'assistant', timestamp: recentTs(), message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: {} }] } }),
    ].join('\n');
    setupSingleProject(lines);
    const projects = readClaudeProjects();
    expect(projects[0].sessions[0].status).toBe('thinking');
  });
});
