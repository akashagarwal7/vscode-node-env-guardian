import * as vscode from 'vscode';
import * as path from 'path';
import { ProcessEnvUsageScanner, EnvUsage } from './scanner';
import { EnvFileIndex } from './envFileIndex';
import { isEnvFile, formatUsageLocation } from './utils';

export type TreeNode = EnvFileItem | MissingVarItem | DefinedVarItem | UnusedVarItem | UsageLocationItem | SectionHeaderItem;

/**
 * Top-level tree item representing a tracked .env* file.
 * Shown when multiple env files are pinned/tracked.
 */
export class EnvFileItem extends vscode.TreeItem {
  constructor(
    public readonly envFilePath: string,
    public readonly sections: SectionHeaderItem[],
    public readonly pinned: boolean
  ) {
    super(path.basename(envFilePath), vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = pinned ? 'envFilePinned' : 'envFileActive';
    this.iconPath = new vscode.ThemeIcon(pinned ? 'pinned' : 'file');
    const totalVars = sections.reduce((sum, s) => sum + s.items.length, 0);
    const totalUsages = sections.reduce((sum, s) =>
      sum + s.items.reduce((su, i) => su + ('usages' in i ? i.usages.length : 0), 0), 0);
    this.description = `${totalVars} vars — ${totalUsages} usages`;
    this.tooltip = envFilePath;
  }
}

/**
 * A collapsible section header in the tree view.
 */
export class SectionHeaderItem extends vscode.TreeItem {
  /** Back-reference to the owning env file path (set when multi-file mode) */
  public envFilePath?: string;

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
    public readonly variableName: string,
    public readonly envFilePath?: string,
    line?: number
  ) {
    super(variableName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'unusedEnvVar';
    this.iconPath = new vscode.ThemeIcon('question');
    this.tooltip = `${variableName} is defined but not referenced in any source file`;

    if (envFilePath && line !== undefined) {
      this.command = {
        command: 'vscode.open',
        title: 'Go to Definition',
        arguments: [
          vscode.Uri.file(envFilePath),
          { selection: new vscode.Range(line, 0, line, 0) },
        ],
      };
    }
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

const ENV_FILE_MIME = 'text/uri-list';

/**
 * TreeDataProvider for the Node Env Guardian sidebar view.
 *
 * Supports single-file mode (default, tracks last focused env file) and
 * multi-file mode (pinned files shown as top-level EnvFileItem nodes).
 */
export class MissingVarsProvider
  implements vscode.TreeDataProvider<TreeNode>, vscode.TreeDragAndDropController<TreeNode>, vscode.Disposable
{
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  readonly dropMimeTypes = [ENV_FILE_MIME];
  readonly dragMimeTypes: string[] = [];

  private disposables: vscode.Disposable[] = [];
  private lastEnvFilePath: string | undefined;
  private _showCommentedSection = true;
  private cachedRoots: TreeNode[] | undefined;

  /** Pinned env file paths (absolute) */
  private pinnedFiles: Set<string> = new Set();

  constructor(
    private readonly scanner: ProcessEnvUsageScanner,
    private readonly envIndex: EnvFileIndex
  ) {
    // Seed from the current editor if it's already an env file
    const current = vscode.window.activeTextEditor;
    if (current && isEnvFile(current.document.uri)) {
      this.lastEnvFilePath = current.document.uri.fsPath;
      this.envIndex.ensureTracked(current.document.uri.fsPath);
    }

    // Refresh when active editor changes; track last env file
    vscode.window.onDidChangeActiveTextEditor(
      async editor => {
        if (editor && isEnvFile(editor.document.uri)) {
          this.lastEnvFilePath = editor.document.uri.fsPath;
          await this.envIndex.ensureTracked(editor.document.uri.fsPath);
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

  // ── Pin management ────────────────────────────────────────────────────────

  pinFile(filePath: string): void {
    this.pinnedFiles.add(filePath);
    this.envIndex.ensureTracked(filePath);
    this.refresh();
  }

  unpinFile(filePath: string): void {
    this.pinnedFiles.delete(filePath);
    this.refresh();
  }

  pinCurrentFile(): void {
    const filePath = this.getActiveEnvFilePath();
    if (filePath) {
      this.pinFile(filePath);
    }
  }

  getPinnedFiles(): ReadonlySet<string> {
    return this.pinnedFiles;
  }

  /** Whether the tree is in multi-file mode (multiple files visible) */
  get isMultiFile(): boolean {
    if (this.pinnedFiles.size === 0) { return false; }
    if (this.pinnedFiles.size > 1) { return true; }
    // Exactly 1 pinned: multi-file if there's also an unpinned active file
    const active = this.getActiveEnvFilePath();
    return !!active && !this.pinnedFiles.has(active);
  }

  // ── Drag and drop ─────────────────────────────────────────────────────────

  handleDrag(): void {
    // We don't support dragging items out
  }

  async handleDrop(
    _target: TreeNode | undefined,
    sources: vscode.DataTransfer
  ): Promise<void> {
    const uriList = sources.get(ENV_FILE_MIME);
    if (!uriList) { return; }

    const text = await uriList.asString();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) { continue; }
      try {
        const uri = vscode.Uri.parse(trimmed);
        if (uri.scheme === 'file' && isEnvFile(uri)) {
          this.pinFile(uri.fsPath);
        }
      } catch {
        // skip invalid URIs
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

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

  // ── TreeDataProvider ──────────────────────────────────────────────────────

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getParent(element: TreeNode): TreeNode | undefined {
    const roots = this.getChildren();

    if (element instanceof EnvFileItem) {
      return undefined;
    }

    if (element instanceof SectionHeaderItem) {
      // In multi-file mode, parent is the EnvFileItem
      for (const r of roots) {
        if (r instanceof EnvFileItem && r.sections.includes(element)) {
          return r;
        }
      }
      return undefined;
    }

    if (element instanceof MissingVarItem || element instanceof DefinedVarItem || element instanceof UnusedVarItem) {
      const allSections = this.getAllSections(roots);
      for (const s of allSections) {
        if ((s.items as TreeNode[]).includes(element)) {
          return s;
        }
      }
      return undefined;
    }

    if (element instanceof UsageLocationItem) {
      const allSections = this.getAllSections(roots);
      for (const s of allSections) {
        for (const item of s.items) {
          if ('usages' in item && item.usages.includes(element.usage)) {
            return item;
          }
        }
      }
    }

    return undefined;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    // EnvFileItem: return its sections
    if (element instanceof EnvFileItem) {
      return element.sections;
    }

    // Child level: return usage locations for a MissingVarItem or DefinedVarItem
    if (element instanceof MissingVarItem || element instanceof DefinedVarItem) {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      return element.usages.map(u => new UsageLocationItem(u, workspaceRoot));
    }

    // Section header: return its child items
    if (element instanceof SectionHeaderItem) {
      return element.items;
    }

    // If called with a UsageLocationItem or UnusedVarItem, no further children
    if (element) {
      return [];
    }

    // Root level — return cached items so tree view references stay stable
    if (this.cachedRoots) {
      return this.cachedRoots;
    }

    const result = this.buildRoots();
    this.cachedRoots = result;
    return result;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private buildRoots(): TreeNode[] {
    // Determine which files to show
    const activeFilePath = this.getActiveEnvFilePath();
    const filesToShow: { filePath: string; pinned: boolean }[] = [];

    // Add pinned files first
    for (const fp of this.pinnedFiles) {
      filesToShow.push({ filePath: fp, pinned: true });
    }

    // Add active file if not already pinned
    if (activeFilePath && !this.pinnedFiles.has(activeFilePath)) {
      filesToShow.push({ filePath: activeFilePath, pinned: false });
    }

    if (filesToShow.length === 0) {
      return [];
    }

    // Single file, not pinned: flat sections (original behavior)
    if (filesToShow.length === 1 && !filesToShow[0].pinned) {
      return this.buildSectionsForFile(filesToShow[0].filePath);
    }

    // Multi-file or single pinned: wrap each in an EnvFileItem
    return filesToShow.map(({ filePath, pinned }) => {
      const sections = this.buildSectionsForFile(filePath);
      for (const s of sections) {
        (s as SectionHeaderItem).envFilePath = filePath;
      }
      return new EnvFileItem(filePath, sections as SectionHeaderItem[], pinned);
    });
  }

  private buildSectionsForFile(filePath: string): SectionHeaderItem[] {
    const definedVars = this.envIndex.getVarsForFile(filePath);
    const commentedVars = this.envIndex.getCommentedVarsForFile(filePath);
    const allUsedVarNames = this.scanner.getAllVariableNames();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const result: SectionHeaderItem[] = [];

    // Missing vars section
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

    // Commented-out section
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

    // Defined variables section
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

    // Unused variables section
    const allUsedSet = new Set(allUsedVarNames);
    const unusedVarNames = [...definedVars]
      .filter(v => !allUsedSet.has(v))
      .sort();

    if (unusedVarNames.length > 0) {
      const unusedItems = unusedVarNames.map(varName =>
        new UnusedVarItem(varName, filePath, this.envIndex.getVarLine(filePath, varName))
      );
      result.push(new SectionHeaderItem('unused', 'Unused Variables', unusedItems, 'question'));
    }

    return result;
  }

  private getAllSections(roots: TreeNode[]): SectionHeaderItem[] {
    const sections: SectionHeaderItem[] = [];
    for (const r of roots) {
      if (r instanceof SectionHeaderItem) {
        sections.push(r);
      } else if (r instanceof EnvFileItem) {
        sections.push(...r.sections);
      }
    }
    return sections;
  }

  /**
   * Returns the basename of the currently tracked .env* file.
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
