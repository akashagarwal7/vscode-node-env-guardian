/**
 * Unit tests for EnvFileIndex content parsing.
 *
 * These tests run without the VSCode API — they exercise `parseContent` directly.
 */

import * as assert from 'assert';
import { EnvFileIndex } from '../../src/envFileIndex';

function parseContent(content: string): Set<string> {
  const index = new EnvFileIndex();
  return (index as unknown as { parseContent(c: string): Set<string> }).parseContent(content);
}

suite('EnvFileIndex — parseContent', () => {
  test('parses simple KEY=VALUE lines', () => {
    const vars = parseContent('API_KEY=abc\nDB_URL=postgres://localhost\n');
    assert.ok(vars.has('API_KEY'));
    assert.ok(vars.has('DB_URL'));
    assert.strictEqual(vars.size, 2);
  });

  test('parses empty values (VAR= still counts as defined)', () => {
    const vars = parseContent('EMPTY_VAR=\n');
    assert.ok(vars.has('EMPTY_VAR'));
  });

  test('skips blank lines', () => {
    const vars = parseContent('\nAPI_KEY=val\n\nDB_URL=val\n\n');
    assert.strictEqual(vars.size, 2);
  });

  test('skips comment lines', () => {
    const vars = parseContent('# This is a comment\nAPI_KEY=val\n# Another comment\n');
    assert.ok(vars.has('API_KEY'));
    assert.ok(!vars.has('# This is a comment'));
    assert.strictEqual(vars.size, 1);
  });

  test('skips lines that are not KEY=... format', () => {
    const vars = parseContent('not a valid line\nAPI_KEY=val\n123_INVALID=val\n');
    assert.ok(vars.has('API_KEY'));
    assert.ok(!vars.has('123_INVALID')); // starts with digit — invalid
    assert.strictEqual(vars.size, 1);
  });

  test('handles KEY = VALUE (spaces around =)', () => {
    const vars = parseContent('KEY = value\n');
    assert.ok(vars.has('KEY'));
  });

  test('handles duplicate keys (second definition still counts as defined)', () => {
    const vars = parseContent('FOO=bar\nFOO=baz\n');
    assert.ok(vars.has('FOO'));
    assert.strictEqual(vars.size, 1); // Still just one unique name
  });

  test('handles underscore-prefixed names', () => {
    const vars = parseContent('_PRIVATE=secret\n');
    assert.ok(vars.has('_PRIVATE'));
  });

  test('only matches uppercase variable names', () => {
    const vars = parseContent('MyVar=value\nmyVar=value\nMYVAR=value\n');
    assert.ok(!vars.has('MyVar'));
    assert.ok(!vars.has('myVar'));
    assert.ok(vars.has('MYVAR'));
    assert.strictEqual(vars.size, 1);
  });

  test('empty file results in empty set', () => {
    const vars = parseContent('');
    assert.strictEqual(vars.size, 0);
  });

  test('file with only comments results in empty set', () => {
    const vars = parseContent('# comment 1\n# comment 2\n');
    assert.strictEqual(vars.size, 0);
  });

  test('quoted values are parsed (variable name extracted correctly)', () => {
    const vars = parseContent('API_KEY="my-api-key"\nDB_URL=\'postgres://localhost\'\n');
    assert.ok(vars.has('API_KEY'));
    assert.ok(vars.has('DB_URL'));
  });
});

suite('EnvFileIndex — parseCommentedContent', () => {
  function parseCommented(content: string): Set<string> {
    const index = new EnvFileIndex();
    return (index as unknown as { parseCommentedContent(c: string): Set<string> }).parseCommentedContent(content);
  }

  test('parses commented-out variables', () => {
    const vars = parseCommented('# API_KEY=secret\n# DB_URL=postgres\n');
    assert.ok(vars.has('API_KEY'));
    assert.ok(vars.has('DB_URL'));
    assert.strictEqual(vars.size, 2);
  });

  test('ignores non-variable comments', () => {
    const vars = parseCommented('# This is a comment\n# API_KEY=secret\n');
    // "This" is not followed by "=", so it doesn't match the variable pattern
    assert.ok(vars.has('API_KEY'));
    assert.strictEqual(vars.size, 1);
  });

  test('only matches uppercase commented variable names', () => {
    const vars = parseCommented('# myVar=value\n# MyVar=value\n# MYVAR=value\n');
    assert.ok(!vars.has('myVar'));
    assert.ok(!vars.has('MyVar'));
    assert.ok(vars.has('MYVAR'));
    assert.strictEqual(vars.size, 1);
  });

  test('handles comment with extra spaces', () => {
    const vars = parseCommented('#  API_KEY = value\n');
    assert.ok(vars.has('API_KEY'));
  });

  test('empty content returns empty set', () => {
    const vars = parseCommented('');
    assert.strictEqual(vars.size, 0);
  });

  test('active definitions are not included', () => {
    const vars = parseCommented('API_KEY=value\n# DB_URL=value\n');
    assert.ok(!vars.has('API_KEY'));
    assert.ok(vars.has('DB_URL'));
  });
});

suite('EnvFileIndex — parseContentWithLines', () => {
  test('tracks line numbers for variables', () => {
    const index = new EnvFileIndex();
    // Access the private method via parseContent (which calls parseContentWithLines)
    // We need to test getVarLine, so we'll set up via parseFile-like path
    const parseWithLines = (index as unknown as {
      parseContentWithLines(c: string): { vars: Set<string>; lines: Map<string, number> };
    }).parseContentWithLines.bind(index);

    const result = parseWithLines('FOO=bar\n\nBAZ=qux\n');
    assert.strictEqual(result.lines.get('FOO'), 0);
    assert.strictEqual(result.lines.get('BAZ'), 2);
  });

  test('duplicate key keeps first line number', () => {
    const index = new EnvFileIndex();
    const parseWithLines = (index as unknown as {
      parseContentWithLines(c: string): { vars: Set<string>; lines: Map<string, number> };
    }).parseContentWithLines.bind(index);

    const result = parseWithLines('FOO=first\nFOO=second\n');
    assert.strictEqual(result.lines.get('FOO'), 0);
  });
});

suite('EnvFileIndex — query API', () => {
  test('getVarsForFile returns empty set for unknown file', () => {
    const index = new EnvFileIndex();
    const vars = index.getVarsForFile('/nonexistent/.env');
    assert.strictEqual(vars.size, 0);
  });

  test('getCommentedVarsForFile returns empty set for unknown file', () => {
    const index = new EnvFileIndex();
    const vars = index.getCommentedVarsForFile('/nonexistent/.env');
    assert.strictEqual(vars.size, 0);
  });

  test('getAllFiles returns the internal index map', () => {
    const index = new EnvFileIndex();
    const files = index.getAllFiles();
    assert.ok(files instanceof Map);
    assert.strictEqual(files.size, 0);
  });

  test('getFilePaths returns array of file paths', () => {
    const index = new EnvFileIndex();
    const paths = index.getFilePaths();
    assert.ok(Array.isArray(paths));
    assert.strictEqual(paths.length, 0);
  });

  test('hasFile returns false for unknown file', () => {
    const index = new EnvFileIndex();
    assert.strictEqual(index.hasFile('/nonexistent/.env'), false);
  });

  test('getVarLine returns undefined for unknown file', () => {
    const index = new EnvFileIndex();
    assert.strictEqual(index.getVarLine('/nonexistent/.env', 'FOO'), undefined);
  });

  test('dispose cleans up resources', () => {
    const index = new EnvFileIndex();
    // Should not throw
    index.dispose();
  });
});
