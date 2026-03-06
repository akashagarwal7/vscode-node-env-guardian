/**
 * Unit tests for MissingVarsProvider — tree structure and last-env-file persistence.
 *
 * These tests run with the vscode-mock and verify that the sidebar
 * shows section-based tree with nested usage locations, and continues
 * showing results after focus moves away from a .env file.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { MissingVarsProvider, MissingVarItem, UsageLocationItem, SectionHeaderItem, DefinedVarItem } from '../../src/missingVarsProvider';
import { ProcessEnvUsageScanner } from '../../src/scanner';
import { EnvFileIndex } from '../../src/envFileIndex';

/**
 * Create a minimal mock editor for a given file path.
 */
function mockEditor(fsPath: string): vscode.TextEditor {
  return {
    document: {
      uri: vscode.Uri.file(fsPath),
    },
  } as unknown as vscode.TextEditor;
}

/**
 * Build a MissingVarsProvider with stubbed scanner/envIndex.
 */
function buildProvider(
  usedVars: string[],
  definedVars: string[],
  envFilePath: string
): MissingVarsProvider {
  const scanner = new ProcessEnvUsageScanner();
  const envIndex = new EnvFileIndex();

  (scanner as unknown as Record<string, unknown>).getAllVariableNames = () => usedVars;
  (scanner as unknown as Record<string, unknown>).getUsagesForVariable = (name: string) => [
    { variableName: name, filePath: '/src/app.ts', line: 1, column: 0, columnEnd: 10 },
    { variableName: name, filePath: '/src/config.ts', line: 5, column: 2, columnEnd: 12 },
  ];

  (envIndex as unknown as Record<string, unknown>).getVarsForFile = (path: string) => {
    if (path === envFilePath) {
      return new Set(definedVars);
    }
    return new Set<string>();
  };
  (envIndex as unknown as Record<string, unknown>).getCommentedVarsForFile = () => new Set<string>();

  return new MissingVarsProvider(scanner, envIndex);
}

/** Helper: find a section by ID from the root children */
function findSection(provider: MissingVarsProvider, sectionId: string): SectionHeaderItem | undefined {
  return provider.getChildren()
    .filter((c): c is SectionHeaderItem => c instanceof SectionHeaderItem)
    .find(s => s.sectionId === sectionId);
}

suite('MissingVarsProvider — tree structure', () => {
  const envPath = '/workspace/.env';

  let originalActiveEditor: vscode.TextEditor | undefined;

  setup(() => {
    originalActiveEditor = vscode.window.activeTextEditor;
  });

  teardown(() => {
    (vscode.window as Record<string, unknown>).activeTextEditor = originalActiveEditor;
  });

  test('root children are SectionHeaderItem instances', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const roots = provider.getChildren();
    assert.strictEqual(roots.length, 1);
    assert.ok(roots[0] instanceof SectionHeaderItem);
    assert.strictEqual((roots[0] as SectionHeaderItem).sectionId, 'missing');
  });

  test('missing section contains MissingVarItem children', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const section = findSection(provider, 'missing')!;
    assert.strictEqual(section.items.length, 1);
    assert.ok(section.items[0] instanceof MissingVarItem);
    assert.strictEqual((section.items[0] as MissingVarItem).variableName, 'API_KEY');
  });

  test('MissingVarItem expands to UsageLocationItem children', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const section = findSection(provider, 'missing')!;
    const varItem = section.items[0];
    const usageChildren = provider.getChildren(varItem);
    assert.strictEqual(usageChildren.length, 2);
    assert.ok(usageChildren[0] instanceof UsageLocationItem);
    assert.ok(usageChildren[1] instanceof UsageLocationItem);
  });

  test('UsageLocationItem has a command to open the file', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const section = findSection(provider, 'missing')!;
    const usageChildren = provider.getChildren(section.items[0]);
    const child = usageChildren[0] as UsageLocationItem;
    assert.ok(child.command);
    assert.strictEqual(child.command!.command, 'vscode.open');
  });

  test('UsageLocationItem has no children', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const section = findSection(provider, 'missing')!;
    const usageChildren = provider.getChildren(section.items[0]);
    const grandchildren = provider.getChildren(usageChildren[0]);
    assert.strictEqual(grandchildren.length, 0);
  });

  test('MissingVarItem description shows usage count', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const section = findSection(provider, 'missing')!;
    assert.strictEqual((section.items[0] as MissingVarItem).description, '2 usages');
  });

  test('defined section appears for defined vars', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY', 'DB_URL'], ['DB_URL'], envPath);

    const definedSection = findSection(provider, 'defined')!;
    assert.ok(definedSection);
    assert.strictEqual(definedSection.items.length, 1);
    assert.ok(definedSection.items[0] instanceof DefinedVarItem);
    assert.strictEqual((definedSection.items[0] as DefinedVarItem).variableName, 'DB_URL');
  });

  test('section header description shows item count', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['A', 'B', 'C'], [], envPath);

    const section = findSection(provider, 'missing')!;
    assert.strictEqual(section.description, '3 — Total usages: 6');
  });
});

suite('MissingVarsProvider — last env file persistence', () => {
  const envPath = '/workspace/.env';
  const srcPath = '/workspace/src/app.ts';

  let originalActiveEditor: vscode.TextEditor | undefined;
  let editorChangeListeners: Array<(e: vscode.TextEditor | undefined) => void>;

  setup(() => {
    originalActiveEditor = vscode.window.activeTextEditor;
    editorChangeListeners = [];

    const originalOn = vscode.window.onDidChangeActiveTextEditor;
    (vscode.window as Record<string, unknown>).onDidChangeActiveTextEditor = (
      listener: (e: vscode.TextEditor | undefined) => void,
      _thisArg?: unknown,
      disposables?: vscode.Disposable[]
    ) => {
      editorChangeListeners.push(listener);
      return originalOn(listener, _thisArg, disposables);
    };
  });

  teardown(() => {
    (vscode.window as Record<string, unknown>).activeTextEditor = originalActiveEditor;
  });

  test('returns missing section when an env file is active', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY', 'DB_URL'], ['DB_URL'], envPath);

    const missingSection = findSection(provider, 'missing')!;
    assert.ok(missingSection);
    assert.strictEqual(missingSection.items.length, 1);
    assert.strictEqual((missingSection.items[0] as MissingVarItem).variableName, 'API_KEY');
  });

  test('returns empty when no env file has ever been focused', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = undefined;
    const provider = buildProvider(['API_KEY'], [], envPath);

    const children = provider.getChildren();
    assert.strictEqual(children.length, 0);
  });

  test('persists results when focus moves from env file to non-env file', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY', 'DB_URL'], ['DB_URL'], envPath);

    let missingSection = findSection(provider, 'missing')!;
    assert.strictEqual(missingSection.items.length, 1);
    assert.strictEqual((missingSection.items[0] as MissingVarItem).variableName, 'API_KEY');

    // Simulate switching to a non-env file
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(srcPath);
    for (const listener of editorChangeListeners) {
      listener(mockEditor(srcPath));
    }

    missingSection = findSection(provider, 'missing')!;
    assert.strictEqual(missingSection.items.length, 1);
    assert.strictEqual((missingSection.items[0] as MissingVarItem).variableName, 'API_KEY');
  });

  test('getActiveEnvFileName returns basename after switching away', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider([], [], envPath);

    assert.strictEqual(provider.getActiveEnvFileName(), '.env');

    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(srcPath);
    for (const listener of editorChangeListeners) {
      listener(mockEditor(srcPath));
    }

    assert.strictEqual(provider.getActiveEnvFileName(), '.env');
  });

  test('updates tracked file when a different env file is focused', () => {
    const envProdPath = '/workspace/.env.production';

    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envProdPath);
    for (const listener of editorChangeListeners) {
      listener(mockEditor(envProdPath));
    }

    assert.strictEqual(provider.getActiveEnvFileName(), '.env.production');
  });
});
