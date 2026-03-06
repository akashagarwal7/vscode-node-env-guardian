import * as vscode from 'vscode';
import * as path from 'path';
import { ProcessEnvUsageScanner } from './scanner';
import { EnvFileIndex } from './envFileIndex';
import { MissingVarsProvider, MissingVarItem, SectionHeaderItem } from './missingVarsProvider';
import { EnvDiagnosticsProvider } from './diagnostics';
import { registerCommands } from './commands';

// Singletons held for the lifetime of the extension
let scanner: ProcessEnvUsageScanner | undefined;
let envIndex: EnvFileIndex | undefined;
let missingVarsProvider: MissingVarsProvider | undefined;
let diagnosticsProvider: EnvDiagnosticsProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // 1. Initialise the usage scanner
  scanner = new ProcessEnvUsageScanner();

  // 2. Initialise the env file index
  envIndex = new EnvFileIndex();

  // 3. Register the MissingVarsProvider as a TreeDataProvider
  missingVarsProvider = new MissingVarsProvider(scanner, envIndex);
  const treeView = vscode.window.createTreeView('envGuardian.missingVars', {
    treeDataProvider: missingVarsProvider,
    showCollapseAll: true,
  });

  // Update the tree view title
  missingVarsProvider.onDidChangeTreeData(() => {
    const activeFile = missingVarsProvider!.getActiveEnvFileName();
    const roots = missingVarsProvider!.getChildren();
    const totalCount = roots.reduce(
      (sum, r) => sum + (r instanceof SectionHeaderItem ? r.items.length : 1),
      0
    );
    const totalUsages = roots.reduce((sum, r) => {
      if (r instanceof SectionHeaderItem) {
        return sum + r.items.reduce((s, i) => s + ('usages' in i ? i.usages.length : 0), 0);
      }
      return sum + ('usages' in r ? r.usages.length : 0);
    }, 0);
    if (activeFile) {
      treeView.title = totalCount > 0
        ? `Environment Variables (${totalCount}) — Total usages: ${totalUsages} — ${activeFile}`
        : `Environment Variables — ${activeFile}`;
    } else {
      treeView.title = 'Environment Variables';
    }
  });

  // Register expand-all command — expands one nesting level per press
  let expandLevel = 0;
  treeView.onDidCollapseElement(() => { expandLevel = 0; });
  missingVarsProvider.onDidChangeTreeData(() => { expandLevel = 0; });
  const expandAllDisposable = vscode.commands.registerCommand('envGuardian.expandAll', async () => {
    const roots = missingVarsProvider!.getChildren();
    if (expandLevel === 0) {
      // First press: expand section headers only
      for (const item of roots) {
        if (item instanceof SectionHeaderItem || item instanceof MissingVarItem) {
          await treeView.reveal(item, { expand: 1 });
        }
      }
    } else {
      // Second press: expand var items inside sections
      for (const item of roots) {
        if (item instanceof SectionHeaderItem) {
          for (const child of item.items) {
            await treeView.reveal(child, { expand: 1 });
          }
        }
        if (item instanceof MissingVarItem) {
          await treeView.reveal(item, { expand: 1 });
        }
      }
    }
    expandLevel = Math.min(expandLevel + 1, 2);
  });


  // Register expand-section command (inline button on section headers)
  const expandSectionDisposable = vscode.commands.registerCommand(
    'envGuardian.expandSection',
    async (item: SectionHeaderItem) => {
      if (!item?.items) { return; }
      for (const child of item.items) {
        await treeView.reveal(child, { expand: 1 });
      }
    }
  );

  // Register add-all-missing command
  const addAllMissingDisposable = vscode.commands.registerCommand(
    'envGuardian.addAllMissing',
    async () => {
      const filePath = missingVarsProvider!.getActiveEnvFilePath();
      if (!filePath) {
        vscode.window.showWarningMessage('Node Env Guardian: No .env file is currently tracked.');
        return;
      }

      // Get only the truly missing var names (exclude commented-out)
      const roots = missingVarsProvider!.getChildren();
      const missingSection = roots.find(
        (i): i is SectionHeaderItem => i instanceof SectionHeaderItem && i.sectionId === 'missing'
      );
      const missingNames = missingSection
        ? missingSection.items.map(i => i.variableName)
        : [];

      if (missingNames.length === 0) {
        vscode.window.showInformationMessage('No missing variables to add.');
        return;
      }

      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = doc.getText();
      const prefix = text.length > 0 && !text.endsWith('\n') ? '\n' : '';
      const insertion = prefix + missingNames.map(v => `${v}=`).join('\n') + '\n';

      const edit = new vscode.WorkspaceEdit();
      const lastLine = doc.lineAt(doc.lineCount - 1);
      edit.insert(uri, lastLine.range.end, insertion);

      const success = await vscode.workspace.applyEdit(edit);
      if (success) {
        await doc.save();
        vscode.window.showInformationMessage(
          `Added ${missingNames.length} variable${missingNames.length !== 1 ? 's' : ''} to ${path.basename(filePath)}.`
        );
      }
    }
  );

  // Register toggle-commented-section command
  const toggleCommentedDisposable = vscode.commands.registerCommand(
    'envGuardian.toggleCommentedSection',
    () => {
      missingVarsProvider!.toggleCommentedSection();
      vscode.commands.executeCommand(
        'setContext',
        'envGuardian.showCommentedSection',
        missingVarsProvider!.showCommentedSection
      );
    }
  );
  // Set initial context (shown by default)
  vscode.commands.executeCommand('setContext', 'envGuardian.showCommentedSection', true);

  // 4. Initialise the diagnostics provider
  diagnosticsProvider = new EnvDiagnosticsProvider(scanner, envIndex);

  // Register code action provider for Quick Fix on env diagnostics
  const codeActionProvider = diagnosticsProvider.createCodeActionProvider();
  const codeActionDisposable = vscode.languages.registerCodeActionsProvider(
    [
      { scheme: 'file', language: 'javascript' },
      { scheme: 'file', language: 'typescript' },
      { scheme: 'file', language: 'javascriptreact' },
      { scheme: 'file', language: 'typescriptreact' },
    ],
    codeActionProvider,
    {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }
  );

  // 5. Register all commands
  const commandDisposables = registerCommands(
    context,
    scanner,
    envIndex,
    missingVarsProvider
  );

  // 6. Push all disposables
  context.subscriptions.push(
    scanner,
    envIndex,
    missingVarsProvider,
    diagnosticsProvider,
    treeView,
    expandAllDisposable,
    expandSectionDisposable,
    addAllMissingDisposable,
    toggleCommentedDisposable,
    codeActionDisposable,
    ...commandDisposables
  );

  // 7. Kick off the initial scans (after registering everything so events propagate correctly)
  await Promise.all([scanner.initialize(), envIndex.initialize()]);

  // 8. Compute initial diagnostics for any already-open documents
  diagnosticsProvider.refreshAllOpenSourceFiles();
}

export function deactivate(): void {
  // All disposables are cleaned up via context.subscriptions above.
  // Explicit disposal here in case deactivate is called before context cleanup.
  scanner?.dispose();
  envIndex?.dispose();
  missingVarsProvider?.dispose();
  diagnosticsProvider?.dispose();

  scanner = undefined;
  envIndex = undefined;
  missingVarsProvider = undefined;
  diagnosticsProvider = undefined;
}
