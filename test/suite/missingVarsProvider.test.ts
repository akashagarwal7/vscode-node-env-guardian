/**
 * Unit tests for MissingVarsProvider — tree structure and last-env-file persistence.
 *
 * These tests run with the vscode-mock and verify that the sidebar
 * shows section-based tree with nested usage locations, and continues
 * showing results after focus moves away from a .env file.
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import { MissingVarsProvider, MissingVarItem, UsageLocationItem, SectionHeaderItem, DefinedVarItem, UnusedVarItem, EnvFileItem } from '../../src/missingVarsProvider';
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
  (envIndex as unknown as Record<string, unknown>).getVarLine = () => undefined;

  return new MissingVarsProvider(scanner, envIndex);
}

function buildProviderWithCommented(
  usedVars: string[],
  definedVars: string[],
  commentedVars: string[],
  envFilePath: string
): MissingVarsProvider {
  const scanner = new ProcessEnvUsageScanner();
  const envIndex = new EnvFileIndex();

  (scanner as unknown as Record<string, unknown>).getAllVariableNames = () => usedVars;
  (scanner as unknown as Record<string, unknown>).getUsagesForVariable = (name: string) => [
    { variableName: name, filePath: '/src/app.ts', line: 1, column: 0, columnEnd: 10 },
  ];

  (envIndex as unknown as Record<string, unknown>).getVarsForFile = (p: string) => {
    if (p === envFilePath) { return new Set(definedVars); }
    return new Set<string>();
  };
  (envIndex as unknown as Record<string, unknown>).getCommentedVarsForFile = (p: string) => {
    if (p === envFilePath) { return new Set(commentedVars); }
    return new Set<string>();
  };
  (envIndex as unknown as Record<string, unknown>).getVarLine = (_p: string, _v: string) => 0;

  return new MissingVarsProvider(scanner, envIndex);
}

function buildProviderWithUnused(
  usedVars: string[],
  definedVars: string[],
  envFilePath: string
): MissingVarsProvider {
  const scanner = new ProcessEnvUsageScanner();
  const envIndex = new EnvFileIndex();

  (scanner as unknown as Record<string, unknown>).getAllVariableNames = () => usedVars;
  (scanner as unknown as Record<string, unknown>).getUsagesForVariable = (name: string) => [
    { variableName: name, filePath: '/src/app.ts', line: 1, column: 0, columnEnd: 10 },
  ];

  (envIndex as unknown as Record<string, unknown>).getVarsForFile = (p: string) => {
    if (p === envFilePath) { return new Set(definedVars); }
    return new Set<string>();
  };
  (envIndex as unknown as Record<string, unknown>).getCommentedVarsForFile = () => new Set<string>();
  (envIndex as unknown as Record<string, unknown>).getVarLine = (_p: string, _v: string) => 5;

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

suite('MissingVarsProvider — commented section', () => {
  const envPath = '/workspace/.env';

  let originalActiveEditor: vscode.TextEditor | undefined;

  setup(() => {
    originalActiveEditor = vscode.window.activeTextEditor;
  });

  teardown(() => {
    (vscode.window as Record<string, unknown>).activeTextEditor = originalActiveEditor;
  });

  test('commented section appears when variables are commented out', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProviderWithCommented(['API_KEY'], [], ['API_KEY'], envPath);

    const section = findSection(provider, 'commented');
    assert.ok(section);
    assert.strictEqual(section!.items.length, 1);
  });

  test('toggleCommentedSection hides commented section', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProviderWithCommented(['API_KEY'], [], ['API_KEY'], envPath);

    assert.ok(provider.showCommentedSection);
    provider.toggleCommentedSection();
    assert.ok(!provider.showCommentedSection);

    const section = findSection(provider, 'commented');
    assert.strictEqual(section, undefined);
  });

  test('toggleCommentedSection shows section again', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProviderWithCommented(['API_KEY'], [], ['API_KEY'], envPath);

    provider.toggleCommentedSection(); // hide
    provider.toggleCommentedSection(); // show

    const section = findSection(provider, 'commented');
    assert.ok(section);
  });
});

suite('MissingVarsProvider — unused variables section', () => {
  const envPath = '/workspace/.env';

  let originalActiveEditor: vscode.TextEditor | undefined;

  setup(() => {
    originalActiveEditor = vscode.window.activeTextEditor;
  });

  teardown(() => {
    (vscode.window as Record<string, unknown>).activeTextEditor = originalActiveEditor;
  });

  test('unused section appears for defined but unused vars', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    // API_KEY is used, UNUSED_VAR is defined but not used
    const provider = buildProviderWithUnused(['API_KEY'], ['API_KEY', 'UNUSED_VAR'], envPath);

    const section = findSection(provider, 'unused');
    assert.ok(section);
    assert.strictEqual(section!.items.length, 1);
    assert.ok(section!.items[0] instanceof UnusedVarItem);
    assert.strictEqual((section!.items[0] as UnusedVarItem).variableName, 'UNUSED_VAR');
  });

  test('unused section description shows only count (no usages)', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProviderWithUnused(['API_KEY'], ['API_KEY', 'UNUSED_VAR'], envPath);

    const section = findSection(provider, 'unused');
    assert.strictEqual(section!.description, '1');
  });

  test('UnusedVarItem has no children', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProviderWithUnused(['API_KEY'], ['API_KEY', 'UNUSED_VAR'], envPath);

    const section = findSection(provider, 'unused');
    const children = provider.getChildren(section!.items[0]);
    assert.strictEqual(children.length, 0);
  });

  test('UnusedVarItem has command to navigate to env file', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProviderWithUnused(['API_KEY'], ['API_KEY', 'UNUSED_VAR'], envPath);

    const section = findSection(provider, 'unused');
    const item = section!.items[0] as UnusedVarItem;
    assert.ok(item.command);
    assert.strictEqual(item.command!.command, 'vscode.open');
  });
});

suite('MissingVarsProvider — multi-file (pin/unpin)', () => {
  const envPath = '/workspace/.env';
  const envProdPath = '/workspace/.env.production';

  let originalActiveEditor: vscode.TextEditor | undefined;

  setup(() => {
    originalActiveEditor = vscode.window.activeTextEditor;
  });

  teardown(() => {
    (vscode.window as Record<string, unknown>).activeTextEditor = originalActiveEditor;
  });

  test('pinFile adds file to pinned set', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    provider.pinFile(envProdPath);
    assert.ok(provider.getPinnedFiles().has(envProdPath));
  });

  test('unpinFile removes file from pinned set', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    provider.pinFile(envProdPath);
    provider.unpinFile(envProdPath);
    assert.ok(!provider.getPinnedFiles().has(envProdPath));
  });

  test('pinCurrentFile pins the active env file', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    provider.pinCurrentFile();
    assert.ok(provider.getPinnedFiles().has(envPath));
  });

  test('isMultiFile returns false with no pins', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    assert.ok(!provider.isMultiFile);
  });

  test('isMultiFile returns true with pinned + active', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    provider.pinFile(envProdPath);
    assert.ok(provider.isMultiFile);
  });

  test('multi-file mode wraps sections in EnvFileItem', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    provider.pinFile(envProdPath);
    const roots = provider.getChildren();
    assert.ok(roots.length >= 1);
    assert.ok(roots[0] instanceof EnvFileItem);
  });

  test('EnvFileItem contains sections as children', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    provider.pinFile(envProdPath);
    const roots = provider.getChildren();
    const fileItem = roots[0] as EnvFileItem;
    const children = provider.getChildren(fileItem);
    assert.ok(children.length > 0);
    assert.ok(children[0] instanceof SectionHeaderItem);
  });

  test('pinned file shows pinned contextValue', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    provider.pinFile(envProdPath);
    const roots = provider.getChildren();
    const pinnedItem = roots.find(r => r instanceof EnvFileItem && (r as EnvFileItem).envFilePath === envProdPath) as EnvFileItem;
    assert.ok(pinnedItem);
    assert.strictEqual(pinnedItem.contextValue, 'envFilePinned');
  });

  test('active (unpinned) file shows active contextValue', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    provider.pinFile(envProdPath);
    const roots = provider.getChildren();
    const activeItem = roots.find(r => r instanceof EnvFileItem && (r as EnvFileItem).envFilePath === envPath) as EnvFileItem;
    assert.ok(activeItem);
    assert.strictEqual(activeItem.contextValue, 'envFileActive');
  });
});

suite('MissingVarsProvider — getParent', () => {
  const envPath = '/workspace/.env';

  let originalActiveEditor: vscode.TextEditor | undefined;

  setup(() => {
    originalActiveEditor = vscode.window.activeTextEditor;
  });

  teardown(() => {
    (vscode.window as Record<string, unknown>).activeTextEditor = originalActiveEditor;
  });

  test('returns undefined for root section items', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const roots = provider.getChildren();
    const section = roots[0] as SectionHeaderItem;
    assert.strictEqual(provider.getParent(section), undefined);
  });

  test('returns section for MissingVarItem', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const section = findSection(provider, 'missing')!;
    const varItem = section.items[0];
    const parent = provider.getParent(varItem);
    assert.strictEqual(parent, section);
  });

  test('returns MissingVarItem for UsageLocationItem', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const section = findSection(provider, 'missing')!;
    const varItem = section.items[0] as MissingVarItem;
    const usageChildren = provider.getChildren(varItem);
    const usageItem = usageChildren[0] as UsageLocationItem;
    const parent = provider.getParent(usageItem);
    assert.strictEqual(parent, varItem);
  });
});

suite('MissingVarsProvider — getTreeItem and caching', () => {
  const envPath = '/workspace/.env';

  let originalActiveEditor: vscode.TextEditor | undefined;

  setup(() => {
    originalActiveEditor = vscode.window.activeTextEditor;
  });

  teardown(() => {
    (vscode.window as Record<string, unknown>).activeTextEditor = originalActiveEditor;
  });

  test('getTreeItem returns the element itself', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const roots = provider.getChildren();
    assert.strictEqual(provider.getTreeItem(roots[0]), roots[0]);
  });

  test('cached roots return same references', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const roots1 = provider.getChildren();
    const roots2 = provider.getChildren();
    assert.strictEqual(roots1, roots2);
  });

  test('refresh clears cached roots', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);

    const roots1 = provider.getChildren();
    provider.refresh();
    const roots2 = provider.getChildren();
    assert.notStrictEqual(roots1, roots2);
  });

  test('dispose does not throw', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const provider = buildProvider(['API_KEY'], [], envPath);
    provider.dispose();
  });

  test('MissingVarItem with 1 usage shows singular', () => {
    (vscode.window as Record<string, unknown>).activeTextEditor = mockEditor(envPath);
    const scanner = new ProcessEnvUsageScanner();
    const envIndex = new EnvFileIndex();

    (scanner as unknown as Record<string, unknown>).getAllVariableNames = () => ['SOLO'];
    (scanner as unknown as Record<string, unknown>).getUsagesForVariable = () => [
      { variableName: 'SOLO', filePath: '/src/app.ts', line: 1, column: 0, columnEnd: 10 },
    ];
    (envIndex as unknown as Record<string, unknown>).getVarsForFile = () => new Set<string>();
    (envIndex as unknown as Record<string, unknown>).getCommentedVarsForFile = () => new Set<string>();
    (envIndex as unknown as Record<string, unknown>).getVarLine = () => undefined;

    const provider = new MissingVarsProvider(scanner, envIndex);
    const section = findSection(provider, 'missing')!;
    assert.strictEqual((section.items[0] as MissingVarItem).description, '1 usage');
  });
});
