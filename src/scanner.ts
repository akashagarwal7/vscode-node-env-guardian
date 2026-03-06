import * as vscode from 'vscode';
import { debounce, getConfig, getExcludeGlobs } from './utils';

export interface EnvUsage {
  variableName: string;
  filePath: string;   // absolute path
  line: number;       // 0-indexed
  column: number;     // 0-indexed start of full expression
  columnEnd: number;  // 0-indexed end of full expression
}

/**
 * Two patterns:
 *   1. process.env.VAR_NAME
 *   2. process.env['VAR_NAME'] or process.env["VAR_NAME"]
 *
 * The regex captures the full expression and the variable name.
 * Named groups:
 *   - expr: the full process.env.X or process.env['X'] text
 *   - varDot: variable name from dot-access
 *   - varBracket: variable name from bracket-access
 */
const ENV_USAGE_REGEX =
  /(?<expr>process\.env(?:\.(?<varDot>[A-Za-z_][A-Za-z0-9_]*)|\[\s*['"](?<varBracket>[A-Za-z_][A-Za-z0-9_]*)['"]\s*\]))/g;

const DEFAULT_SOURCE_GLOBS = ['**/*.{js,ts,jsx,tsx,mjs,cjs,mts,cts}'];

/**
 * Scans workspace source files for process.env.* references and
 * maintains a live, indexed map of all usages.
 */
export class ProcessEnvUsageScanner implements vscode.Disposable {
  /** variable name → list of usages */
  private usagesByVar: Map<string, EnvUsage[]> = new Map();
  /** file path → list of usages */
  private usagesByFile: Map<string, EnvUsage[]> = new Map();

  private watchers: vscode.FileSystemWatcher[] = [];
  private disposables: vscode.Disposable[] = [];

  /** Fired whenever the index changes */
  public readonly onDidChange: vscode.Event<void>;
  private _onDidChange = new vscode.EventEmitter<void>();

  constructor() {
    this.onDidChange = this._onDidChange.event;
  }

  // ── Initialisation ──────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    await this.rescan();
    this.setupWatchers();
  }

  async rescan(): Promise<void> {
    this.usagesByVar.clear();
    this.usagesByFile.clear();

    const sourceGlobs = getConfig<string[]>('sourceGlobs', DEFAULT_SOURCE_GLOBS);
    const excludePattern = `{${getExcludeGlobs().join(',')}}`;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: 'Node Env Guardian: scanning source files…',
      },
      async () => {
        for (const glob of sourceGlobs) {
          const uris = await vscode.workspace.findFiles(glob, excludePattern);
          for (const uri of uris) {
            await this.scanFile(uri.fsPath);
          }
        }
      }
    );
    this._onDidChange.fire();
  }

  private setupWatchers(): void {
    const sourceGlobs = getConfig<string[]>('sourceGlobs', DEFAULT_SOURCE_GLOBS);

    for (const glob of sourceGlobs) {
      const watcher = vscode.workspace.createFileSystemWatcher(glob);

      const debouncedScan = debounce(async (fsPath: string) => {
        await this.scanFile(fsPath);
        this._onDidChange.fire();
      }, 300);

      watcher.onDidCreate(uri => debouncedScan(uri.fsPath), null, this.disposables);
      watcher.onDidChange(uri => debouncedScan(uri.fsPath), null, this.disposables);
      watcher.onDidDelete(uri => {
        this.removeFile(uri.fsPath);
        this._onDidChange.fire();
      }, null, this.disposables);

      this.watchers.push(watcher);
    }
  }

  // ── Scanning ─────────────────────────────────────────────────────────────────

  async scanFile(filePath: string): Promise<void> {
    // Remove stale entries for this file first
    this.removeFile(filePath);

    let content: string;
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
      content = Buffer.from(bytes).toString('utf8');
    } catch {
      // File may have been deleted just after the event fired
      return;
    }

    const usages = this.parseUsages(filePath, content);
    if (usages.length === 0) {
      return;
    }

    this.usagesByFile.set(filePath, usages);

    for (const usage of usages) {
      const list = this.usagesByVar.get(usage.variableName) ?? [];
      list.push(usage);
      this.usagesByVar.set(usage.variableName, list);
    }
  }

  /** Parse all process.env usages from a source content string. */
  parseUsages(filePath: string, content: string): EnvUsage[] {
    const usages: EnvUsage[] = [];
    const lines = content.split('\n');

    // Build a line-start offset table for fast offset → (line, col) lookup
    const lineStartOffsets: number[] = [];
    let offset = 0;
    for (const line of lines) {
      lineStartOffsets.push(offset);
      offset += line.length + 1; // +1 for the \n
    }

    const offsetToLineCol = (charOffset: number): { line: number; col: number } => {
      // Binary search
      let lo = 0;
      let hi = lineStartOffsets.length - 1;
      while (lo < hi) {
        const mid = Math.floor((lo + hi + 1) / 2);
        if (lineStartOffsets[mid] <= charOffset) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }
      return { line: lo, col: charOffset - lineStartOffsets[lo] };
    };

    ENV_USAGE_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = ENV_USAGE_REGEX.exec(content)) !== null) {
      const groups = match.groups!;
      const variableName = groups['varDot'] ?? groups['varBracket'];
      if (!variableName) {
        continue; // dynamic access — skip
      }

      const exprStart = match.index;
      const exprEnd = match.index + match[0].length;

      const start = offsetToLineCol(exprStart);
      const end = offsetToLineCol(exprEnd);

      usages.push({
        variableName,
        filePath,
        line: start.line,
        column: start.col,
        columnEnd: end.col,
      });
    }

    return usages;
  }

  private removeFile(filePath: string): void {
    const existingUsages = this.usagesByFile.get(filePath);
    if (!existingUsages) {
      return;
    }

    this.usagesByFile.delete(filePath);

    for (const usage of existingUsages) {
      const list = this.usagesByVar.get(usage.variableName);
      if (!list) {
        continue;
      }
      const filtered = list.filter(u => u.filePath !== filePath);
      if (filtered.length === 0) {
        this.usagesByVar.delete(usage.variableName);
      } else {
        this.usagesByVar.set(usage.variableName, filtered);
      }
    }
  }

  // ── Query API ────────────────────────────────────────────────────────────────

  getAllVariableNames(): string[] {
    return [...this.usagesByVar.keys()];
  }

  getUsagesForVariable(variableName: string): EnvUsage[] {
    return this.usagesByVar.get(variableName) ?? [];
  }

  getUsagesForFile(filePath: string): EnvUsage[] {
    return this.usagesByFile.get(filePath) ?? [];
  }

  getAllUsages(): Map<string, EnvUsage[]> {
    return this.usagesByVar;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  dispose(): void {
    this._onDidChange.dispose();
    for (const w of this.watchers) {
      w.dispose();
    }
    for (const d of this.disposables) {
      d.dispose();
    }
    this.watchers = [];
    this.disposables = [];
  }
}

/** Exported for testing without VSCode dependency */
export function parseEnvUsagesFromContent(filePath: string, content: string): EnvUsage[] {
  // Lightweight version that doesn't need an instance
  const scanner = { parseUsages: ProcessEnvUsageScanner.prototype.parseUsages.bind({}) };
  return scanner.parseUsages(filePath, content);
}
