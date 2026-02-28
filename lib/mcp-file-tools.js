const fs = require('fs');
const path = require('path');
const { z } = require('zod');

function registerFileTools(server, projectRoot) {
  function safePath(filePath) {
    const resolved = path.resolve(projectRoot, filePath);
    if (!resolved.startsWith(path.resolve(projectRoot))) {
      throw new Error('Access denied: path must be within project root');
    }
    return resolved;
  }

  function summarizeFile(filePath, content) {
    const lines = content.split('\n');
    const symbols = lines
      .map((line, idx) => ({ idx: idx + 1, line: line.trim() }))
      .filter(x => /^(function|async function|class|const .*=\s*\(|module\.exports|export )/.test(x.line))
      .slice(0, 20)
      .map(x => `${x.idx}: ${x.line}`);
    const preview = lines
      .slice(0, 24)
      .map((line, i) => `${i + 1}: ${line}`)
      .join('\n');
    return [
      `file: ${filePath}`,
      `lines: ${lines.length}`,
      'symbols:',
      symbols.length ? symbols.join('\n') : '(none detected)',
      'preview:',
      preview,
      'hint: use startLine/endLine for detailed ranges.',
    ].join('\n');
  }

  server.tool(
    'arena_read_file',
    'Read a file from the project. Default returns concise summary; use startLine/endLine for details.',
    {
      path: z.string().describe('Relative file path, e.g. "server.js" or "lib/env.js"'),
      startLine: z.number().optional().describe('Start line (1-based, optional)'),
      endLine: z.number().optional().describe('End line (1-based, optional)'),
    },
    async ({ path: filePath, startLine, endLine }) => {
      try {
        const abs = safePath(filePath);
        const content = fs.readFileSync(abs, 'utf8');
        const lines = content.split('\n');
        if (typeof startLine !== 'number' && typeof endLine !== 'number') {
          return { content: [{ type: 'text', text: summarizeFile(filePath, content) }] };
        }
        const start = (startLine || 1) - 1;
        const end = endLine || lines.length;
        if (end < start + 1) {
          return { content: [{ type: 'text', text: 'Error: endLine must be >= startLine.' }], isError: true };
        }
        if (end - start > 220) {
          return {
            content: [{ type: 'text', text: 'Error: requested range too large (>220 lines). Read in smaller chunks.' }],
            isError: true,
          };
        }
        const slice = lines.slice(start, end);
        const numbered = slice.map((l, i) => `${start + i + 1}: ${l}`).join('\n');
        return { content: [{ type: 'text', text: numbered }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'arena_list_files',
    'List files in a project directory. Path is relative to project root.',
    {
      path: z.string().optional().describe('Relative directory path (default: project root)'),
    },
    async ({ path: dirPath }) => {
      try {
        const abs = safePath(dirPath || '.');
        const entries = fs.readdirSync(abs, { withFileTypes: true });
        const listing = entries
          .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules')
          .map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`)
          .join('\n');
        return { content: [{ type: 'text', text: listing || '(empty directory)' }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  server.tool(
    'arena_write_file',
    'Write or overwrite a file in the project. Path is relative to project root. Will create parent directories if needed.',
    {
      path: z.string().describe('Relative file path, e.g. "lib/auth.js"'),
      content: z.string().describe('The full file content to write'),
    },
    async ({ path: filePath, content }) => {
      try {
        const abs = safePath(filePath);
        const lineCount = content.split('\n').length;
        if (lineCount > 200) {
          return {
            content: [{ type: 'text', text: `Blocked: file would be ${lineCount} lines (limit: 200). Split into smaller files first.` }],
            isError: true,
          };
        }
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
        return { content: [{ type: 'text', text: `Written ${lineCount} lines to ${filePath}` }] };
      } catch (err) {
        return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
      }
    }
  );

  return { safePath };
}

module.exports = { registerFileTools };
