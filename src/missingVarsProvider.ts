import * as vscode from 'vscode';
import * as path from 'path';
import { ProcessEnvUsageScanner, EnvUsage } from './scanner';
import { EnvFileIndex } from './envFileIndex';
import { isEnvFile, formatUsageLocation } from './utils';

export type TreeNode = MissingVarItem | DefinedVarItem | UnusedVarItem | UsageLocationItem | SectionHeaderItem;

/**
 * A collapsible section header in the tree view.
 */
export class SectionHeaderItem extends vscode.TreeItem {
  constructor(
    public readonly sectionId: string,
    label: string,
    public readonly items: (MissingVarItem | DefinedVarItem | UnusedVarItem)[],
    icon: string = 'comment'
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'sectionHeader';
    this.iconPath = new vscode.ThemeIcon(icon);
    const totalUsages = items.reduce((sum, i) => sum + ('usages' in i ? i.usages.length : 0), 0);
    this.description = sectionId === 'unused'
      ? `${items.length}`
      : `${items.length} — Total usages: ${totalUsages}`;
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
 * A tree item representing a defined environment variable (no warning icon).
 */
export class DefinedVarItem extends vscode.TreeItem {
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

    this.contextValue = 'definedEnvVar';
    this.iconPath = new vscode.ThemeIcon('check');
    this.description = `${usages.length} usage${usages.length !== 1 ? 's' : ''}`;
    this.tooltip = usages.length > 0
      ? usages.map(u => formatUsageLocation(u.filePath, u.line, workspaceRoot)).join('\n')
      : variableName;
  }
}

/**
 * A tree item representing a variable defined in the env file but not used in code.
 */
export class UnusedVarItem extends vscode.TreeItem {
  constructor(
    public readonly variableName: string
  ) {
    super(variableName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'unusedEnvVar';
    this.iconPath = new vscode.ThemeIcon('question');
    this.tooltip = `${variableName} is defined but not referenced in any source file`;
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
  private cachedRoots: TreeNode[] | undefined;

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
    this.cachedRoots = undefined;
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
        if ((r instanceof MissingVarItem || r instanceof DefinedVarItem) && r.usages.includes(element.usage)) {
          return r;
        }
        if (r instanceof SectionHeaderItem) {
          const match = r.items.find(i => 'usages' in i && i.usages.includes(element.usage));
          if (match) {
            return match;
          }
        }
      }
    }
    if (element instanceof MissingVarItem || element instanceof DefinedVarItem) {
      const roots = this.getChildren();
      for (const r of roots) {
        if (r instanceof SectionHeaderItem && (r.items as TreeNode[]).includes(element)) {
          return r;
        }
      }
    }
    return undefined;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    // Child level: return usage locations for a MissingVarItem or DefinedVarItem
    if (element instanceof MissingVarItem || element instanceof DefinedVarItem) {
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

    // Root level — return cached items so tree view references stay stable
    if (this.cachedRoots) {
      return this.cachedRoots;
    }

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

    // Missing vars section: not defined AND not commented out
    const missingVarNames = allUsedVarNames
      .filter(v => !definedVars.has(v) && !commentedVars.has(v))
      .sort();

    if (missingVarNames.length > 0) {
      const missingItems = missingVarNames.map(varName => {
        const usages = this.scanner.getUsagesForVariable(varName);
        return new MissingVarItem(varName, usages, workspaceRoot);
      });
      result.push(new SectionHeaderItem('missing', 'Missing Variables', missingItems, 'warning'));
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
        result.push(new SectionHeaderItem('commented', 'Commented Out Variables', commentedItems, 'comment'));
      }
    }

    // Defined variables section: vars that are used in code and defined in the env file
    const definedUsed = allUsedVarNames
      .filter(v => definedVars.has(v))
      .sort();

    if (definedUsed.length > 0) {
      const definedItems = definedUsed.map(varName => {
        const usages = this.scanner.getUsagesForVariable(varName);
        return new DefinedVarItem(varName, usages, workspaceRoot);
      });
      result.push(new SectionHeaderItem('defined', 'Defined Variables', definedItems, 'pass'));
    }

    // Unused variables section: defined in env file but not used in any source file
    const allUsedSet = new Set(allUsedVarNames);
    const unusedVarNames = [...definedVars]
      .filter(v => !allUsedSet.has(v))
      .sort();

    if (unusedVarNames.length > 0) {
      const unusedItems = unusedVarNames.map(varName => new UnusedVarItem(varName));
      result.push(new SectionHeaderItem('unused', 'Unused Variables', unusedItems, 'question'));
    }

    this.cachedRoots = result;
    return result;
  }

  /**
   * Returns the basename of the currently tracked .env* file.
   * Prefers the active editor if it's an env file, otherwise falls back
   * to the last focused env file.
   */
  getActiveEnvFileName(): string | undefined {
    const filePath = this.getActiveEnvFilePath();
    return filePath ? path.basename(filePath) : undefined;
  }

  getActiveEnvFilePath(): string | undefined {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && isEnvFile(activeEditor.document.uri)) {
      return activeEditor.document.uri.fsPath;
    }
    return this.lastEnvFilePath;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
  }
}
