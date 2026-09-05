/**
 * Mock Obsidian API for unit testing
 * 
 * This provides minimal stubs for Obsidian imports so utility functions
 * that reference Obsidian types can be tested in Node.
 */

// Basic types
export class TFile {
  path: string;
  basename: string;
  extension: string;
  name: string;
  
  constructor(path: string) {
    this.path = path;
    this.name = path.split('/').pop() || '';
    this.basename = this.name.replace(/\.[^.]+$/, '');
    this.extension = this.name.split('.').pop() || '';
  }
}

export class TFolder {
  path: string;
  name: string;
  
  constructor(path: string) {
    this.path = path;
    this.name = path.split('/').pop() || '';
  }
}

export class TAbstractFile {
  path: string;
  name: string;
  
  constructor(path: string) {
    this.path = path;
    this.name = path.split('/').pop() || '';
  }
}

// Utility functions
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export function parseYaml(yaml: string): unknown {
  // Minimal YAML parsing for tests - handles "Key: value" and simple lists.
  const result: Record<string, unknown> = {};
  const lines = yaml.split(/\r?\n/);
  let currentListKey: string | null = null;
  for (const line of lines) {
    const listMatch = line.match(/^\s*-\s*(.*)$/);
    if (listMatch && currentListKey) {
      const current = result[currentListKey];
      if (Array.isArray(current)) {
        current.push(listMatch[1]);
      } else {
        result[currentListKey] = [listMatch[1]];
      }
      continue;
    }

    const match = line.match(/^([A-Za-z0-9 _'-]+):\s*(.*)$/);
    if (match) {
      const [, key, value] = match;
      const trimmedKey = key.trim();
      const trimmedValue = value.trim();
      if (trimmedValue === '') {
        result[trimmedKey] = '';
      } else if (/^(true|false)$/i.test(trimmedValue)) {
        result[trimmedKey] = /^true$/i.test(trimmedValue);
      } else if (/^-?\d+(?:\.\d+)?$/.test(trimmedValue)) {
        result[trimmedKey] = Number(trimmedValue);
      } else {
        result[trimmedKey] = trimmedValue;
      }
      currentListKey = trimmedKey;
    }
  }
  return result;
}

export function stringifyYaml(obj: unknown): string {
  if (typeof obj !== 'object' || obj === null) return '';
  const lines: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      v.forEach(item => lines.push(`  - ${item}`));
      continue;
    }
    const value = v === undefined || v === null ? '' : String(v);
    lines.push(`${k}: ${value}`);
  }
  return lines.join('\n');
}

export function getFrontMatterInfo(content: string): {
  exists: boolean;
  frontmatter?: string;
  from?: number;
  to?: number;
  position?: { start: { offset: number }; end: { offset: number } };
} {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { exists: false };
  }

  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const marker = `${newline}---`;
  const endIdx = content.indexOf(marker, 3);
  if (endIdx === -1) return { exists: false };

  const frontmatterStart = content.startsWith('---\r\n') ? 5 : 4;
  const frontmatter = content.slice(frontmatterStart, endIdx);
  const endOffset = endIdx + marker.length;
  return {
    exists: true,
    frontmatter,
    from: 0,
    to: endOffset,
    position: {
      start: { offset: 0 },
      end: { offset: endOffset }
    }
  };
}

// Moment stub (Obsidian uses moment.js)
export const moment = {
  locale: () => 'en',
};

// Platform detection
export const Platform = {
  isMobile: false,
  isDesktop: true,
  isMacOS: true,
  isWin: false,
  isLinux: false,
};

// Notice stub
export class Notice {
  constructor(_message: string, _timeout?: number) {
    // No-op in tests
  }
}

export class MenuItem {
  setTitle(_title: string): this { return this; }
  setIcon(_icon: string): this { return this; }
  setDisabled(_disabled: boolean): this { return this; }
  onClick(_callback: () => void): this { return this; }
}

export class Menu {
  items: MenuItem[] = [];
  addItem(callback: (item: MenuItem) => void): this {
    const item = new MenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }
  addSeparator(): this { return this; }
  showAtMouseEvent(_event: MouseEvent): this { return this; }
}

// Request URL stub
export async function requestUrl(options: unknown): Promise<{ status: number; json: unknown; text: string }> {
  if (process.env.RT_USE_LIVE_OBSIDIAN_REQUEST === '1') {
    const request = options as {
      url?: string;
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    };
    const response = await fetch(String(request.url ?? ''), {
      method: request.method ?? 'GET',
      headers: request.headers,
      body: request.body
    });
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      status: response.status,
      json,
      text
    };
  }
  throw new Error('requestUrl should be mocked in individual tests');
}

// Plugin/Modal base classes
export class Plugin {
  app: unknown;
  manifest: { version: string };
  
  constructor() {
    this.app = {};
    this.manifest = { version: '0.0.0' };
  }
  
  loadData(): Promise<unknown> { return Promise.resolve({}); }
  saveData(_data: unknown): Promise<void> { return Promise.resolve(); }
  registerEvent(_event: unknown): void {}
  registerDomEvent(_el: unknown, _type: string, _handler: unknown): void {}
  registerInterval(_interval: number): number { return 0; }
  addCommand(_cmd: unknown): void {}
  addSettingTab(_tab: unknown): void {}
}

export class Modal {
  app: unknown;
  containerEl: HTMLElement;
  modalEl: HTMLElement;
  contentEl: HTMLElement;
  
  constructor(_app: unknown) {
    this.app = _app;
    this.containerEl = {} as HTMLElement;
    this.modalEl = {} as HTMLElement;
    this.contentEl = {} as HTMLElement;
  }
  
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

export class PluginSettingTab {
  app: unknown;
  plugin: unknown;
  containerEl: HTMLElement;
  
  constructor(_app: unknown, _plugin: unknown) {
    this.app = _app;
    this.plugin = _plugin;
    this.containerEl = {} as HTMLElement;
  }
  
  display(): void {}
  hide(): void {}
}

// Component base — a working model of Obsidian's lifecycle: registrations
// accumulate until unload(), children load/unload with their parent, and
// removeChild() unloads the child immediately.
export class Component {
  private _loaded = false;
  private _cleanups: Array<() => void> = [];
  private _children: Component[] = [];

  load(): void {
    if (this._loaded) return;
    this._loaded = true;
    this.onload();
    for (const child of this._children) child.load();
  }
  onload(): void {}
  unload(): void {
    if (!this._loaded) return;
    this._loaded = false;
    for (const child of [...this._children]) child.unload();
    const cleanups = this._cleanups;
    this._cleanups = [];
    for (const cb of cleanups.reverse()) cb();
    this.onunload();
  }
  onunload(): void {}
  addChild<T extends Component>(child: T): T {
    this._children.push(child);
    if (this._loaded) child.load();
    return child;
  }
  removeChild<T extends Component>(child: T): T {
    const idx = this._children.indexOf(child);
    if (idx >= 0) this._children.splice(idx, 1);
    child.unload();
    return child;
  }
  register(cb: () => void): void { this._cleanups.push(cb); }
  registerEvent(_event: unknown): void {}
  registerDomEvent(el: unknown, type: string, handler: unknown): void {
    const target = el as { addEventListener?: (t: string, h: unknown) => void; removeEventListener?: (t: string, h: unknown) => void } | null;
    if (target && typeof target.addEventListener === 'function') {
      target.addEventListener(type, handler);
      this.register(() => target.removeEventListener?.(type, handler));
    }
  }
  registerInterval(interval: number): number {
    this.register(() => clearInterval(interval));
    return interval;
  }
}

// ItemView for custom views
export class ItemView extends Component {
  app: unknown;
  leaf: unknown;
  containerEl: HTMLElement;
  contentEl: HTMLElement;
  
  constructor(_leaf: unknown) {
    super();
    this.app = {};
    this.leaf = _leaf;
    this.containerEl = {} as HTMLElement;
    this.contentEl = {} as HTMLElement;
  }
  
  getViewType(): string { return ''; }
  getDisplayText(): string { return ''; }
  onOpen(): Promise<void> { return Promise.resolve(); }
  onClose(): Promise<void> { return Promise.resolve(); }
}

// Setting class
export class Setting {
  settingEl: HTMLElement;
  infoEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  
  constructor(_containerEl: HTMLElement) {
    this.settingEl = {} as HTMLElement;
    this.infoEl = {} as HTMLElement;
    this.nameEl = {} as HTMLElement;
    this.descEl = {} as HTMLElement;
    this.controlEl = {} as HTMLElement;
  }
  
  setName(_name: string): this { return this; }
  setDesc(_desc: string): this { return this; }
  setClass(_cls: string): this { return this; }
  addText(_cb: (text: unknown) => void): this { return this; }
  addTextArea(_cb: (ta: unknown) => void): this { return this; }
  addToggle(_cb: (toggle: unknown) => void): this { return this; }
  addDropdown(_cb: (dd: unknown) => void): this { return this; }
  addButton(_cb: (btn: unknown) => void): this { return this; }
  addExtraButton(_cb: (btn: unknown) => void): this { return this; }
  addSlider(_cb: (slider: unknown) => void): this { return this; }
}

// Workspace
export class Workspace {
  getLeavesOfType(_type: string): unknown[] { return []; }
  getActiveFile(): TFile | null { return null; }
  on(_event: string, _handler: unknown): unknown { return {}; }
}

// FileSystemAdapter (desktop adapter)
export class FileSystemAdapter {
  private basePath: string;

  constructor(basePath = '') {
    this.basePath = basePath;
  }

  getBasePath(): string { return this.basePath; }
  setBasePath(basePath: string): void { this.basePath = basePath; }
}

// Vault
export class Vault {
  adapter: FileSystemAdapter | null = null;
  getAbstractFileByPath(_path: string): TAbstractFile | null { return null; }
  getMarkdownFiles(): TFile[] { return []; }
  read(_file: TFile): Promise<string> { return Promise.resolve(''); }
  modify(_file: TFile, _content: string): Promise<void> { return Promise.resolve(); }
  create(_path: string, _content: string): Promise<TFile> { return Promise.resolve(new TFile(_path)); }
  delete(_file: TFile): Promise<void> { return Promise.resolve(); }
  on(_event: string, _handler: unknown): unknown { return {}; }
}

// App
export class App {
  vault: Vault;
  workspace: Workspace;
  metadataCache: { getFileCache: (_file: TFile) => { frontmatter?: Record<string, unknown> } | null };
  fileManager: { processFrontMatter: (_file: TFile, cb: (fm: Record<string, unknown>) => void) => Promise<void> };
  
  constructor() {
    this.vault = new Vault();
    this.workspace = new Workspace();
    this.metadataCache = {
      getFileCache: () => null,
    };
    this.fileManager = {
      processFrontMatter: async () => {
        // no-op in default mock; tests can override
      },
    };
  }
}

// MarkdownRenderer
export class MarkdownRenderer {
  static render(
    _app: App,
    _markdown: string,
    _el: HTMLElement,
    _sourcePath: string,
    _component: Component
  ): Promise<void> {
    return Promise.resolve();
  }
}
