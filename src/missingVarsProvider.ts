import * as vscode from 'vscode';
import * as path from 'path';
import { ProcessEnvUsageScanner, EnvUsage } from './scanner';
import { EnvFileIndex } from './envFileIndex';
import { isEnvFile, formatUsageLocation } from './utils';

export type TreeNode = MissingVarItem | UsageLocationItem | SectionHeaderItem | SeparatorItem;

/**
 * A visual separator in the tree view.
 */
export class SeparatorItem extends vscode.TreeItem {
  constructor() {
    super('─────────────', vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'separator';
    this.description = '';
  }
}

/**
 * A collapsible section header in the tree view.
 */
export class SectionHeaderItem extends vscode.TreeItem {
  constructor(
    public readonly sectionId: string,
    label: string,
    public readonly items: MissingVarItem[]
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'sectionHeader';
    this.iconPath = new vscode.ThemeIcon('comment');
    this.description = `${items.length}`;
  }
}

/**
 * A tree item representing one missing environment variable (parent node).
 */
export class MissingVarItem extends vscode.TreeItem {
  constructor(
    public readonly variableName: string,
    public readonly usages: EnvUsage[],
    workspaceRoot?: string
  ) {
    super(
      variableName,
      usages.length > 0
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None
    );

    this.contextValue = 'missingEnvVar';
    this.iconPath = new vscode.ThemeIcon('warning');
    this.description = `${usages.length} usage${usages.length !== 1 ? 's' : ''}`;
    this.tooltip = usages.length > 0
      ? usages.map(u => formatUsageLocation(u.filePath, u.line, workspaceRoot)).join('\n')
      : variableName;
  }
}

/**
 * A tree item representing a single source usage location (child node).
 */
export class UsageLocationItem extends vscode.TreeItem {
  constructor(
    public readonly usage: EnvUsage,
    workspaceRoot?: string
  ) {
    const label = formatUsageLocation(usage.filePath, usage.line, workspaceRoot);
    super(label, vscode.TreeItemCollapsibleState.None);

    this.contextValue = 'envUsageLocation';
    this.iconPath = new vscode.ThemeIcon('go-to-file');
    this.tooltip = usage.filePath + ':' + (usage.line + 1);

    this.command = {
      command: 'vscode.open',
      title: 'Go to Usage',
      arguments: [
        vscode.Uri.file(usage.filePath),
        {
          selection: new vscode.Range(usage.line, usage.column, usage.line, usage.columnEnd),
        },
      ],
    };
  }
}

/**
 * TreeDataProvider for the Node Env Guardian sidebar view.
 *
 * Displays all process.env variables used in source code that are NOT
 * defined in the currently active .env* file, with usage locations as
 * nested children. Variables that are commented out in the env file
 * are shown in a separate collapsible section.
 */
export class MissingVarsProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private disposables: vscode.Disposable[] = [];
  private lastEnvFilePath: string | undefined;
  private _showCommentedSection = true;

  constructor(
    private readonly scanner: ProcessEnvUsageScanner,
    private readonly envIndex: EnvFileIndex
  ) {
    // Seed from the current editor if it's already an env file
    const current = vscode.window.activeTextEditor;
    if (current && isEnvFile(current.document.uri)) {
      this.lastEnvFilePath = current.document.uri.fsPath;
    }

    // Refresh when active editor changes; track last env file
    vscode.window.onDidChangeActiveTextEditor(
      editor => {
        if (editor && isEnvFile(editor.document.uri)) {
          this.lastEnvFilePath = editor.document.uri.fsPath;
        }
        this.refresh();
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

  get showCommentedSection(): boolean {
    return this._showCommentedSection;
  }

  toggleCommentedSection(): void {
    this._showCommentedSection = !this._showCommentedSection;
    this.refresh();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // ── TreeDataProvider ──────────────────────────────────────────────────────────

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getParent(element: TreeNode): TreeNode | undefined {
    if (element instanceof UsageLocationItem) {
      const roots = this.getChildren();
      for (const r of roots) {
        if (r instanceof MissingVarItem && r.usages.includes(element.usage)) {
          return r;
        }
        if (r instanceof SectionHeaderItem) {
          const match = r.items.find(i => i.usages.includes(element.usage));
          if (match) {
            return match;
          }
        }
      }
    }
    if (element instanceof MissingVarItem) {
      // Check if this item belongs to a section
      const roots = this.getChildren();
      for (const r of roots) {
        if (r instanceof SectionHeaderItem && r.items.includes(element)) {
          return r;
        }
      }
    }
    return undefined;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    // Child level: return usage locations for a MissingVarItem
    if (element instanceof MissingVarItem) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      return element.usages.map(u => new UsageLocationItem(u, workspaceRoot));
    }

    // Section header: return its child MissingVarItems
    if (element instanceof SectionHeaderItem) {
      return element.items;
    }

    // If called with a UsageLocationItem, no further children
    if (element) {
      return [];
    }

    // Root level
    const activeEditor = vscode.window.activeTextEditor;
    const activeFilePath =
      activeEditor && isEnvFile(activeEditor.document.uri)
        ? activeEditor.document.uri.fsPath
        : this.lastEnvFilePath;

    if (!activeFilePath) {
      return [];
    }

    const definedVars = this.envIndex.getVarsForFile(activeFilePath);
    const commentedVars = this.envIndex.getCommentedVarsForFile(activeFilePath);
    const allUsedVarNames = this.scanner.getAllVariableNames();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const result: TreeNode[] = [];

    // Truly missing vars: not defined AND not commented out
    const missingVarNames = allUsedVarNames
      .filter(v => !definedVars.has(v) && !commentedVars.has(v))
      .sort();

    for (const varName of missingVarNames) {
      const usages = this.scanner.getUsagesForVariable(varName);
      result.push(new MissingVarItem(varName, usages, workspaceRoot));
    }

    // Commented-out section: vars that are used in code and commented out in env file
    if (this._showCommentedSection) {
      const commentedMissing = allUsedVarNames
        .filter(v => !definedVars.has(v) && commentedVars.has(v))
        .sort();

      if (commentedMissing.length > 0) {
        const commentedItems = commentedMissing.map(varName => {
          const usages = this.scanner.getUsagesForVariable(varName);
          return new MissingVarItem(varName, usages, workspaceRoot);
        });
        if (missingVarNames.length > 0) {
          result.push(new SeparatorItem());
        }
        result.push(new SectionHeaderItem('commented', 'Commented Out Variables', commentedItems));
      }
    }

    return result;
  }

  /**
   * Returns the basename of the currently tracked .env* file.
   * Prefers the active editor if it's an env file, otherwise falls back
   * to the last focused env file.
   */
  getActiveEnvFileName(): string | undefined {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && isEnvFile(activeEditor.document.uri)) {
      return path.basename(activeEditor.document.uri.fsPath);
    }
    if (this.lastEnvFilePath) {
      return path.basename(this.lastEnvFilePath);
    }
    return undefined;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
