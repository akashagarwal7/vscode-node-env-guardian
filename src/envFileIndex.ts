import * as vscode from 'vscode';
import * as path from 'path';
import { isEnvFilePath, debounce, getConfig } from './utils';

const DEFAULT_ENV_PATTERN = '.env*';

/**
 * Tracks all .env* files at workspace roots and maintains a map
 * of defined variable names per file.
 */
export class EnvFileIndex implements vscode.Disposable {
  /** absolute file path → Set of defined variable names */
  private index: Map<string, Set<string>> = new Map();

  /** absolute file path → Set of commented-out variable names */
  private commentedIndex: Map<string, Set<string>> = new Map();

  /** absolute file path → Map of variable name → 0-indexed line number */
  private lineIndex: Map<string, Map<string, number>> = new Map();

  private watcher: vscode.FileSystemWatcher | undefined;
  private disposables: vscode.Disposable[] = [];

  /** Fired whenever the index changes */
  public readonly onDidChange: vscode.Event<void>;
  private _onDidChange = new vscode.EventEmitter<void>();

  constructor() {
    this.onDidChange = this._onDidChange.event;
  }

  // ── Initialisation ──────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    await this.reParse();
    this.setupWatcher();
    this.setupDocumentChangeListener();
  }

  async reParse(): Promise<void> {
    this.index.clear();
    this.commentedIndex.clear();
    this.lineIndex.clear();

    const pattern = getConfig<string>('envFilePattern', DEFAULT_ENV_PATTERN);
    const uris = await vscode.workspace.findFiles(pattern);

    for (const uri of uris) {
      if (this.isAtWorkspaceRoot(uri.fsPath)) {
        await this.parseFile(uri.fsPath);
      }
    }
    this._onDidChange.fire();
  }

  private setupWatcher(): void {
    const pattern = getConfig<string>('envFilePattern', DEFAULT_ENV_PATTERN);
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

    this.watcher.onDidCreate(async uri => {
      if (this.isAtWorkspaceRoot(uri.fsPath)) {
        await this.parseFile(uri.fsPath);
        this._onDidChange.fire();
      }
    }, null, this.disposables);

    this.watcher.onDidChange(async uri => {
      if (this.isAtWorkspaceRoot(uri.fsPath)) {
        await this.parseFile(uri.fsPath);
        this._onDidChange.fire();
      }
    }, null, this.disposables);

    this.watcher.onDidDelete(uri => {
      this.index.delete(uri.fsPath);
      this.commentedIndex.delete(uri.fsPath);
      this.lineIndex.delete(uri.fsPath);
      this._onDidChange.fire();
    }, null, this.disposables);
  }

  private setupDocumentChangeListener(): void {
    const debouncedParse = debounce((filePath: string, content: string) => {
      const { vars, lines } = this.parseContentWithLines(content);
      this.index.set(filePath, vars);
      this.lineIndex.set(filePath, lines);
      const commentedVars = this.parseCommentedContent(content);
      this.commentedIndex.set(filePath, commentedVars);
      this._onDidChange.fire();
    }, 300);

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        const fsPath = e.document.uri.fsPath;
        if (isEnvFilePath(fsPath) && this.isAtWorkspaceRoot(fsPath)) {
          debouncedParse(fsPath, e.document.getText());
        }
      })
    );
  }

  // ── Parsing ──────────────────────────────────────────────────────────────────

  async parseFile(filePath: string): Promise<void> {
    let content: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      content = Buffer.from(bytes).toString('utf8');
    } catch {
      this.index.delete(filePath);
      this.commentedIndex.delete(filePath);
      this.lineIndex.delete(filePath);
      return;
    }

    const { vars, lines } = this.parseContentWithLines(content);
    this.index.set(filePath, vars);
    this.lineIndex.set(filePath, lines);

    const commentedVars = this.parseCommentedContent(content);
    this.commentedIndex.set(filePath, commentedVars);
  }

  /** Pure parsing — exported for unit tests */
  parseContent(content: string): Set<string> {
    return this.parseContentWithLines(content).vars;
  }

  /** Parse content returning both variable names and their line numbers */
  private parseContentWithLines(content: string): { vars: Set<string>; lines: Map<string, number> } {
    const vars = new Set<string>();
    const lines = new Map<string, number>();
    const contentLines = content.split('\n');

    for (let i = 0; i < contentLines.length; i++) {
      const line = contentLines[i].trim();

      // Skip blank lines and comments
      if (!line || line.startsWith('#')) {
        continue;
      }

      // Match: VARIABLE_NAME= or VARIABLE_NAME =
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (match) {
        vars.add(match[1]);
        if (!lines.has(match[1])) {
          lines.set(match[1], i);
        }
      }
    }

    return { vars, lines };
  }

  /** Parse commented-out variable definitions (lines like `# VAR_NAME=...`) */
  parseCommentedContent(content: string): Set<string> {
    const vars = new Set<string>();
    const lines = content.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      const match = /^#\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
      if (match) {
        vars.add(match[1]);
      }
    }

    return vars;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  /**
   * Returns true only if the file is directly at a workspace root
   * (not in a subdirectory).
   */
  private isAtWorkspaceRoot(filePath: string): boolean {
    const dir = path.dirname(filePath);
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) {
      return false;
    }
    return folders.some(folder => folder.uri.fsPath === dir);
  }

  // ── Query API ────────────────────────────────────────────────────────────────

  /** Ensure a file is tracked, parsing it if not already in the index */
  async ensureTracked(filePath: string): Promise<void> {
    if (!this.index.has(filePath)) {
      await this.parseFile(filePath);
      this._onDidChange.fire();
    }
  }

  getVarsForFile(filePath: string): Set<string> {
    return this.index.get(filePath) ?? new Set();
  }

  getCommentedVarsForFile(filePath: string): Set<string> {
    return this.commentedIndex.get(filePath) ?? new Set();
  }

  getAllFiles(): Map<string, Set<string>> {
    return this.index;
  }

  getFilePaths(): string[] {
    return [...this.index.keys()];
  }

  hasFile(filePath: string): boolean {
    return this.index.has(filePath);
  }

  /** Returns the 0-indexed line number of a variable in the given file, or undefined */
  getVarLine(filePath: string, varName: string): number | undefined {
    return this.lineIndex.get(filePath)?.get(varName);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  dispose(): void {
    this._onDidChange.dispose();
    this.watcher?.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}
