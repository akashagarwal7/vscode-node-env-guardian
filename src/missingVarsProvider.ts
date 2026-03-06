import * as vscode from 'vscode';
import * as path from 'path';
import { ProcessEnvUsageScanner, EnvUsage } from './scanner';
import { EnvFileIndex } from './envFileIndex';
import { isEnvFile, formatUsageLocation } from './utils';

/**
 * A single tree item representing one missing environment variable.
 */
export class MissingVarItem extends vscode.TreeItem {
  constructor(
    public readonly variableName: string,
    public readonly usages: EnvUsage[],
    workspaceRoot?: string
  ) {
    super(variableName, vscode.TreeItemCollapsibleState.None);

    this.contextValue = 'missingEnvVar';
    this.iconPath = new vscode.ThemeIcon('warning');

    // Build description: "src/api/client.ts:14, +2 more"
    if (usages.length === 0) {
      this.description = '';
      this.tooltip = variableName;
    } else {
      const first = usages[0];
      const firstLabel = formatUsageLocation(first.filePath, first.line, workspaceRoot);
      const extra = usages.length - 1;
      this.description = extra > 0 ? `${firstLabel}, +${extra} more` : firstLabel;

      // Tooltip: all file:line references, one per line
      this.tooltip = usages
        .map(u => formatUsageLocation(u.filePath, u.line, workspaceRoot))
        .join('\n');
    }
  }
}

/**
 * TreeDataProvider for the EnvGuardian sidebar view.
 *
 * Displays all process.env variables used in source code that are NOT
 * defined in the currently active .env* file.
 */
export class MissingVarsProvider
  implements vscode.TreeDataProvider<MissingVarItem>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<MissingVarItem | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly scanner: ProcessEnvUsageScanner,
    private readonly envIndex: EnvFileIndex
  ) {
    // Refresh when active editor changes to a .env* file
    vscode.window.onDidChangeActiveTextEditor(
      editor => {
        if (!editor || isEnvFile(editor.document.uri)) {
          this.refresh();
        }
      },
      null,
      this.disposables
    );

    // Refresh when any source or .env* file is saved
    vscode.workspace.onDidSaveTextDocument(
      () => this.refresh(),
      null,
      this.disposables
    );

    // Refresh when the scanner or env index changes
    this.scanner.onDidChange(() => this.refresh(), null, this.disposables);
    this.envIndex.onDidChange(() => this.refresh(), null, this.disposables);
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // ── TreeDataProvider ──────────────────────────────────────────────────────────

  getTreeItem(element: MissingVarItem): vscode.TreeItem {
    return element;
  }

  getChildren(): MissingVarItem[] {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || !isEnvFile(activeEditor.document.uri)) {
      return [];
    }

    const activeFilePath = activeEditor.document.uri.fsPath;
    const definedVars = this.envIndex.getVarsForFile(activeFilePath);
    const allUsedVarNames = this.scanner.getAllVariableNames();

    const missingVarNames = allUsedVarNames
      .filter(v => !definedVars.has(v))
      .sort();

    // Determine workspace root for display paths
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    return missingVarNames.map(varName => {
      const usages = this.scanner.getUsagesForVariable(varName);
      return new MissingVarItem(varName, usages, workspaceRoot);
    });
  }

  /**
   * Returns the welcome message items when no .env* file is focused.
   * VSCode shows "welcome content" automatically via contributes.viewsWelcome,
   * but we also handle it here for clarity.
   */
  getActiveEnvFileName(): string | undefined {
    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor || !isEnvFile(activeEditor.document.uri)) {
      return undefined;
    }
    return path.basename(activeEditor.document.uri.fsPath);
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
