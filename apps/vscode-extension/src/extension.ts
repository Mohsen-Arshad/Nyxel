import * as vscode from 'vscode';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';

type PrivacyMode = 'standard' | 'strict';
type ContextItem = { path: string; content: string; score: number; reason: string };
type RouteResponse = { signals: { task: string; complexity: number; confidence: number; language: string; source: string; evidence: string[] }; decision: { providerId: string; reasons: string[] }; contextSummary?: { items: number; chars: number; selected: number; localCompression?: boolean; compressionReason?: string; memory?: boolean; ncpChars?: number } };

type GatewayState = 'starting' | 'ready' | 'offline' | 'stopped';
type ProviderInfo = {id:string;transport:string;configured:boolean;model?:string;source:string;status?:'on'|'off'|'error';health?:{healthy:boolean;latencyMs:number;error?:string}};
type ProviderDefinitionInfo = {id:string;name:string;transport:string;version:string;status?:'on'|'off'|'error';health?:{healthy:boolean;latencyMs:number;error?:string}};

const MAX_CONTEXT_CHARS = 24000;
const SENSITIVE_PATH = /(^|[\\/])(?:\.env(?:\..*)?|credentials(?:\..*)?|secrets?(?:\..*)?|.*\.pem|.*\.key|.*\.p12|.*\.pfx|id_rsa)$/i;
const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"\n]{8,}['"]/gi,
  /Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/g,
  /gh[pousr]_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9]{20,}/g,
];

function redact(text: string): string {
  let value = text;
  for (const pattern of SECRET_PATTERNS) value = value.replace(pattern, '[REDACTED]');
  return value;
}

function collectEditorContext(): ContextItem[] {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return [];
  const path = editor.document.uri.fsPath;
  if (SENSITIVE_PATH.test(path)) return [];

  const selection = editor.document.getText(editor.selection);
  const full = editor.document.getText();
  const items: ContextItem[] = [];
  if (selection.trim()) items.push({ path, content: redact(selection.slice(0, MAX_CONTEXT_CHARS)), score: 1, reason: 'active selection' });
  const bounded = redact(full.slice(0, MAX_CONTEXT_CHARS));
  if (bounded.trim()) items.push({ path, content: bounded, score: selection ? 0.88 : 0.94, reason: 'active file (bounded)' });
  return items;
}

class GatewayManager implements vscode.Disposable {
  private process: ChildProcess | undefined;
  private state: GatewayState = 'stopped';
  private port: number;
  private readonly token: string;
  private readonly storageDir: string;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.port = vscode.workspace.getConfiguration('nyxelrelay.gateway').get<number>('port', 4321);
    this.token = randomBytes(32).toString('hex');
    this.storageDir = join(context.globalStorageUri.fsPath, 'data');
  }

  get baseUrl(): string { return `http://127.0.0.1:${this.port}`; }
  get authToken(): string { return this.token; }
  get currentState(): GatewayState { return this.state; }

  private gatewayEntry(): string | undefined {
    const extensionGateway = join(this.context.extensionPath, '..', 'gateway', 'dist', 'index.js');
    if (existsSync(extensionGateway)) return extensionGateway;
    const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspace) {
      const workspaceGateway = join(workspace, 'apps', 'gateway', 'dist', 'index.js');
      if (existsSync(workspaceGateway)) return workspaceGateway;
    }
    return undefined;
  }

  private headers(init: RequestInit = {}): Record<string, string> {
    const headers: Record<string, string> = { 'x-nyxelrelay-token': this.token };
    if (init.body !== undefined && init.body !== null) headers['content-type'] = 'application/json';
    return headers;
  }

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        headers: { 'x-nyxelrelay-token': this.token },
        signal: AbortSignal.timeout(1000),
      });
      if (!response.ok) return false;
      const data = await response.json() as { protocol?: string };
      return data.protocol === 'phase5.1.0';
    } catch {
      return false;
    }
  }

  private async portAvailable(port: number): Promise<boolean> {
    return new Promise(resolve => {
      const socket = createConnection({ host: '127.0.0.1', port });
      const finish = (available: boolean) => { socket.destroy(); resolve(available); };
      socket.once('connect', () => finish(false));
      socket.once('error', () => finish(true));
    });
  }

  private async selectPort(): Promise<void> {
    for (let offset = 0; offset < 20; offset++) {
      const candidate = this.port + offset;
      if (await this.portAvailable(candidate)) {
        this.port = candidate;
        return;
      }
    }
    throw new Error(`No free Gateway port found near ${this.port}`);
  }

  async start(): Promise<boolean> {
    if (await this.health()) { this.state = 'ready'; return true; }
    await this.selectPort();
    const entry = this.gatewayEntry();
    if (!entry) {
      this.state = 'offline';
      return false;
    }

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(this.storageDir));
    this.state = 'starting';
    this.process = spawn(process.execPath, [entry], {
      cwd: join(entry, '..', '..'),
      env: {
        ...process.env,
        NYXELRELAY_PORT: String(this.port),
        NYXELRELAY_TOKEN: this.token,
        NYXELRELAY_DATA_DIR: this.storageDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.process.stdout?.on('data', data => console.debug(`[NyxelRelay Gateway] ${String(data).trim()}`));
    this.process.stderr?.on('data', data => console.error(`[NyxelRelay Gateway] ${String(data).trim()}`));
    this.process.on('exit', () => {
      this.process = undefined;
      if (this.state !== 'stopped') this.state = 'offline';
    });

    for (let attempt = 0; attempt < 50; attempt++) {
      if (await this.health()) { this.state = 'ready'; return true; }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    this.state = 'offline';
    return false;
  }

  async ensureReady(): Promise<void> {
    if (await this.health()) { this.state = 'ready'; return; }
    if (!this.process) {
      if (await this.start()) return;
    }
    throw new Error('NyxelRelay Gateway is not available. Use “NyxelRelay: Restart Gateway” or inspect the Debug Console.');
  }

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    await this.ensureReady();
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { ...this.headers(init), ...(init.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`Gateway ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  async cancel(requestId: string): Promise<void> {
    await this.request('/cancel', { method: 'POST', body: JSON.stringify({ requestId }) });
  }

  async providers(): Promise<{runtime:ProviderInfo[];definitions:ProviderDefinitionInfo[]}> {
    return this.request('/providers');
  }

  async configureProvider(config: {id:string;transport:'api'|'local';model:string;baseUrl?:string;apiKey?:string}): Promise<unknown> {
    return this.request('/providers/configure', {method:'POST', body:JSON.stringify(config)});
  }

  async deleteProvider(id:string): Promise<void> {
    await this.request(`/providers/${encodeURIComponent(id)}`, {method:'DELETE'});
  }

  async startWeb(id:string): Promise<unknown> {
    return this.request(`/providers/${encodeURIComponent(id)}/start`, {method:'POST'});
  }

  async stopWeb(id:string): Promise<unknown> {
    return this.request(`/providers/${encodeURIComponent(id)}/stop`, {method:'POST'});
  }

  async pickWeb(id:string,target:'input'|'send'|'response'): Promise<any> {
    return this.request(`/providers/${encodeURIComponent(id)}/pick`, {method:'POST',body:JSON.stringify({target})});
  }

  async scanWeb(id:string,target:'input'|'send'|'response'): Promise<any> {
    return this.request(`/providers/${encodeURIComponent(id)}/scan`, {method:'POST',body:JSON.stringify({target})});
  }

  async importDefinition(definition: unknown): Promise<unknown> {
    return this.request('/providers/import', {method:'POST',body:JSON.stringify(definition)});
  }

  async getProviderDefinition(id:string): Promise<any> {
    return this.request(`/providers/${encodeURIComponent(id)}/export`);
  }

  async restart(): Promise<boolean> {
    await this.stop();
    return this.start();
  }

  async stop(): Promise<void> {
    const processRef = this.process;
    this.state = 'stopped';
    if (!processRef) return;
    try {
      await fetch(`${this.baseUrl}/shutdown`, {
        method: 'POST',
        headers: { 'x-nyxelrelay-token': this.token },
        signal: AbortSignal.timeout(1500),
      });
    } catch {
      // Gateway may already be dead. Kill is the fallback.
    }
    processRef.kill();
    this.process = undefined;
  }

  dispose(): Thenable<void> { return this.stop(); }
}

class ChatView implements vscode.WebviewViewProvider, vscode.Disposable {
  private view?: vscode.WebviewView;
  private busy = false;
  private activeRequestId: string | undefined;
  private selectedProvider = '';
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly gateway: GatewayManager,
    private readonly runChat: (prompt: string, privacy: PrivacyMode, model?: string) => Promise<void>,
    private readonly configureApi: (config: {id:string;transport:'api'|'local';model:string;baseUrl?:string;apiKey?:string}) => Promise<void>,
    private readonly saveWebDefinition: (definition: unknown) => Promise<void>,
    private readonly removeProvider: (id:string) => Promise<void>,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [] };
    view.webview.html = this.html(view.webview);
    this.disposables.push(view.webview.onDidReceiveMessage(async message => {
      try {
        if (message.type === 'ask') {
          if (this.busy) return;
          this.busy = true;
          await this.runChat(String(message.prompt ?? ''), message.privacy === 'strict' ? 'strict' : 'standard', message.model ? String(message.model) : undefined);
          this.busy = false;
        } else if (message.type === 'cancel') {
          if (this.activeRequestId) await this.gateway.cancel(this.activeRequestId);
        } else if (message.type === 'refreshProviders') {
          this.post({ type:'providers', ...(await this.gateway.providers()) });
        } else if (message.type === 'configureApi') {
          await this.configureApi({id:String(message.id),transport:message.transport==='local'?'local':'api',model:String(message.model),...(message.baseUrl?{baseUrl:String(message.baseUrl)}:{}),...(message.apiKey?{apiKey:String(message.apiKey)}:{})});
          this.post({type:'toast',message:`${String(message.id)} configured.`});
          this.post({ type:'providers', ...(await this.gateway.providers()) });
        } else if (message.type === 'editProvider') {
          const definition = await this.gateway.getProviderDefinition(String(message.id));
          this.post({ type:'editWeb', definition });
        } else if (message.type === 'createWeb') {
          await this.saveWebDefinition(message.definition);
          if(!message.silent)this.post({type:'toast',message:`Web provider ${String(message.definition?.provider?.name ?? '')} saved.`});
          this.post({ type:'providers', ...(await this.gateway.providers()) });
        } else if (message.type === 'startWeb') {
          await this.gateway.startWeb(String(message.id));
          this.post({type:'toast',message:`${String(message.id)} browser transport connected.`});
          this.post({ type:'providers', ...(await this.gateway.providers()) });
        } else if (message.type === 'stopWeb') {
          await this.gateway.stopWeb(String(message.id));
          this.post({type:'toast',message:`Web provider ${String(message.id)} stopped.`});
          this.post({ type:'providers', ...(await this.gateway.providers()) });
        } else if (message.type === 'pickWeb') {
          const result=await this.gateway.pickWeb(String(message.id), message.target);
          this.post({type:'picked',target:message.target,picked:result.picked,definition:result.definition});
          this.post({type:'toast',message:`${String(message.target)} locator captured.`});
          this.post({ type:'providers', ...(await this.gateway.providers()) });
        } else if (message.type === 'scanWeb') {
          const result=await this.gateway.scanWeb(String(message.id), message.target);
          this.post({type:'scanResult',target:message.target,result});
        } else if (message.type === 'deleteProvider') {
          await this.removeProvider(String(message.id));
          this.post({type:'toast',message:`${String(message.id)} removed.`});
          this.post({ type:'providers', ...(await this.gateway.providers()) });
        } else if (message.type === 'importProvider') {
          const uri = await vscode.window.showOpenDialog({canSelectMany:false,filters:{'NyxelRelay Provider':['json']}});
          if(uri?.[0]) { const raw=await vscode.workspace.fs.readFile(uri[0]); await this.gateway.importDefinition(JSON.parse(Buffer.from(raw).toString('utf8'))); this.post({type:'providers',...(await this.gateway.providers())}); }
        } else if (message.type === 'exportProvider') {
          const id=String(message.id); const definition=await this.gateway.request(`/providers/${encodeURIComponent(id)}/export`); const uri=await vscode.window.showSaveDialog({saveLabel:'Export Provider',defaultUri:vscode.Uri.file(`${id}.json`),filters:{'NyxelRelay Provider':['json']}}); if(uri) await vscode.workspace.fs.writeFile(uri,Buffer.from(JSON.stringify(definition,null,2),'utf8'));
        } else if (message.type === 'restart') {
          this.post({ type: 'status', status: 'starting', text: 'Starting Gateway…' });
          const ready = await this.gateway.restart();
          this.post({ type: 'status', status: ready ? 'ready' : 'offline', text: ready ? 'Gateway ready' : 'Gateway could not be started' });
        } else if (message.type === 'openSettings') {
          await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:nyxelrelay-vscode');
        }
      } catch (error) {
        this.busy = false;
        const providerAction = ['refreshProviders','configureApi','createWeb','startWeb','stopWeb','pickWeb','scanWeb','deleteProvider','importProvider','exportProvider'].includes(String(message.type));
        this.post({ type: providerAction ? 'providerError' : 'error', message: String(error) });
        if(providerAction){ try { this.post({ type:'providers', ...(await this.gateway.providers()) }); } catch { /* preserve original provider error */ } }
      }
    }));
  }

  post(message: unknown): void { this.view?.webview.postMessage(message); }
  providerError(message: string): void { this.post({ type: 'providerError', message }); }

  setGatewayStatus(status: GatewayState, text: string): void { this.post({ type: 'status', status, text }); }
  beginAssistant(meta: { provider: string; task: string; complexity: number; confidence: number; source: string; evidence: string[]; contextItems: number; contextChars: number; selectedContext: number; reasons: string[] }): void {
    this.post({ type: 'assistantStart', meta });
  }
  appendAssistant(text: string): void { this.post({ type: 'assistantDelta', text }); }
  completeAssistant(): void { this.post({ type: 'assistantComplete' }); }
  error(message: string): void { this.post({ type: 'error', message }); }
  setBusy(busy: boolean): void { this.busy = busy; this.post({ type: 'busy', busy }); }
  setRequestId(requestId: string | undefined): void { this.activeRequestId = requestId; this.post({ type:'requestId', requestId: requestId ?? null }); }

  private html(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('hex');
    const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;
    return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
:root{color-scheme:light dark}body{font-family:var(--vscode-font-family);font-size:13px;color:var(--vscode-foreground);padding:10px;margin:0}.header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}.title{font-weight:700}.status{font-size:11px;opacity:.8}.tabs{display:flex;gap:4px;margin:8px 0}.tab{flex:1;background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);border:0;border-radius:5px;padding:6px;cursor:pointer}.tab.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}.panel{display:none}.panel.active{display:block}.messages{display:flex;flex-direction:column;gap:10px;min-height:220px;max-height:calc(100vh - 250px);overflow:auto;padding:4px 1px}.bubble{border:1px solid var(--vscode-panel-border);border-radius:8px;padding:9px;line-height:1.45;overflow-wrap:anywhere}.user{background:var(--vscode-textBlockQuote-background)}.assistant{background:var(--vscode-editor-background)}.meta{font-size:10px;opacity:.7;margin-bottom:5px}.composer{position:sticky;bottom:0;background:var(--vscode-sideBar-background);padding-top:8px}.prompt,.input{width:100%;box-sizing:border-box;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border);border-radius:6px;padding:7px;font:inherit}.prompt{min-height:70px;resize:vertical}.field{margin:7px 0}.label{font-size:11px;opacity:.8;margin-bottom:3px}.row{display:flex;gap:6px}.row>*{flex:1}.toolbar{display:flex;gap:6px;align-items:center;margin-top:6px}.provider-select{width:100%;box-sizing:border-box;margin:6px 0;background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);padding:6px;border-radius:4px}.select{background:var(--vscode-dropdown-background);color:var(--vscode-dropdown-foreground);border:1px solid var(--vscode-dropdown-border);padding:5px;border-radius:4px}.btn{border:0;border-radius:4px;padding:6px 9px;background:var(--vscode-button-background);color:var(--vscode-button-foreground);cursor:pointer}.btn.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}.btn:disabled{opacity:.5;cursor:default}.link{background:none;border:0;color:var(--vscode-textLink-foreground);cursor:pointer;padding:3px}.card{border:1px solid var(--vscode-panel-border);border-radius:7px;padding:8px;margin:7px 0}.provider-card{border-left:4px solid var(--vscode-panel-border);transition:border-color .15s ease,background .15s ease}.provider-card.status-on{border-color:#2ea043;background:color-mix(in srgb,#2ea043 8%,transparent)}.provider-card.status-off{border-color:#3b82f6;background:color-mix(in srgb,#3b82f6 7%,transparent)}.provider-card.status-error{border-color:#f85149;background:color-mix(in srgb,#f85149 8%,transparent)}.provider-card.status-degraded{border-color:#d29922;background:color-mix(in srgb,#d29922 8%,transparent)}.provider-status{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:600}.provider-dot{width:8px;height:8px;border-radius:50%;display:inline-block}.status-on .provider-dot{background:#2ea043}.status-off .provider-dot{background:#3b82f6}.status-error .provider-dot{background:#f85149}.status-degraded .provider-dot{background:#d29922}.provider-error-text{font-size:10px;margin-top:4px;opacity:.8}.cardhead{display:flex;justify-content:space-between;gap:6px}.name{font-weight:700}.muted{opacity:.65;font-size:11px}.actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.section{border-top:1px solid var(--vscode-panel-border);margin-top:10px;padding-top:8px}.empty{opacity:.65;text-align:center;margin-top:35px}.error{border-color:var(--vscode-inputValidation-errorBorder);color:var(--vscode-errorForeground)}#toast{position:fixed;bottom:8px;left:8px;right:8px;padding:7px;border-radius:5px;background:var(--vscode-notifications-background);display:none}
</style></head><body>
<div class="header"><div class="title">NyxelRelay</div><div><span id="status" class="status">Starting…</span> <button id="settings" class="link">⚙</button></div></div>
<div class="tabs"><button class="tab active" data-tab="chat">Chat</button><button class="tab" data-tab="providers">Providers</button></div>
<div id="chat" class="panel active"><select id="providerOverride" class="provider-select"><option value="">Auto route</option></select><div id="messages" class="messages"><div id="empty" class="empty">Ask about the current code, debugging, refactoring, tests, or architecture.</div></div><div class="composer"><textarea id="prompt" class="prompt" placeholder="Ask NyxelRelay…"></textarea><div class="toolbar"><select id="privacy" class="select"><option value="standard">Standard</option><option value="strict">Privacy</option></select><span style="font-size:10px;opacity:.7">Ctrl/Cmd+Enter</span><button id="cancel" class="btn" disabled>Cancel</button><button id="send" class="btn">Send</button></div></div></div>
<div id="providers" class="panel"><div class="toolbar"><button class="btn" id="refresh">Refresh</button><button class="btn secondary" id="import">Import</button><button class="btn secondary" id="newWeb">+ Web Provider</button></div><div id="providerList"></div>
<div class="section"><b>API / Local setup</b><div class="field"><div class="label">Provider</div><select id="apiId" class="input"><option value="openai">OpenAI</option><option value="deepseek">DeepSeek</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option><option value="ollama">Ollama</option><option value="lmstudio">LM Studio</option></select></div><div class="row"><div class="field"><div class="label">Model</div><input id="apiModel" class="input" placeholder="model id"></div><div class="field"><div class="label">Transport</div><select id="apiTransport" class="input"><option value="api">API</option><option value="local">Local</option></select></div></div><div class="field"><div class="label">API Key</div><input id="apiKey" class="input" type="password" placeholder="stored in VS Code SecretStorage"></div><div class="field"><div class="label">Base URL (optional)</div><input id="apiBase" class="input" placeholder="https://api.../v1"></div><button class="btn" id="saveApi">Save & Test</button></div>
<div class="section" id="webEditor" style="display:none"><b>Web Provider</b><div class="field"><div class="label">ID</div><input id="webId" class="input" placeholder="chatgpt-web"></div><div class="field"><div class="label">Name</div><input id="webName" class="input" placeholder="ChatGPT Web"></div><div class="field"><div class="label">Website URL</div><input id="webUrl" class="input" placeholder="https://example.com"></div><div class="field"><div class="label">Browser transport</div><select id="webBrowserMode" class="select"><option value="existing">Existing Browser (recommended)</option><option value="managed">Managed Nyxel Browser</option></select></div><div class="field"><div class="label">Browser</div><select id="webBrowserFamily" class="select"><option value="chrome">Chrome</option><option value="edge">Edge</option><option value="chromium">Any Chromium browser</option></select></div><div class="field"><div class="label">Input CSS locator <span class="muted">(optional, can be picked after Start)</span></div><input id="webInput" class="input" placeholder="Pick from the running browser"></div><div class="field"><div class="label">Send CSS locator <span class="muted">(optional, can be picked after Start)</span></div><input id="webSend" class="input" placeholder="Pick from the running browser"></div><div class="field"><div class="label">Response CSS locator <span class="muted">(optional, can be picked after Start)</span></div><input id="webResponse" class="input" placeholder="Pick from the running browser"></div><div class="actions"><button class="btn" id="saveWeb">Save Web Provider</button></div><div class="muted">Save only ID/Name/URL first. Then Start the provider, pick Input/Send/Response directly from the normal browser, and save is updated automatically. Existing Browser requires the NyxelRelay Browser Bridge extension.</div></div></div>
<div id="toast"></div>
<script nonce="${nonce}">
const vscode=acquireVsCodeApi();const $=id=>document.getElementById(id);let current=null;let providers={runtime:[],definitions:[]};let editingWebDefinition=null;let selectedProvider='';
function toast(t){const x=$('toast');x.textContent=t;x.style.display='block';setTimeout(()=>x.style.display='none',2600)}
function providerError(t){const list=$('providerList');list.querySelector('.provider-error')?.remove();const x=document.createElement('div');x.className='card error provider-error';x.textContent=t;list.prepend(x)}
function collectWebDefinition(){const id=$('webId').value.trim(),name=$('webName').value.trim(),url=$('webUrl').value.trim(),input=$('webInput').value.trim(),send=$('webSend').value.trim(),response=$('webResponse').value.trim(),browserMode=$('webBrowserMode').value,browserFamily=$('webBrowserFamily').value;if(!id||!name||!url)return null;const locator=v=>({strategies:[{type:'css',value:v,confidence:.8}],framePath:[],shadowPath:[]});const base=editingWebDefinition?.transport==='web'?editingWebDefinition:{};return {...base,schemaVersion:1,provider:{id,name,version:editingWebDefinition?.provider?.version||'1.0.0'},transport:'web',website:{url},browser:{mode:browserMode,family:browserFamily},...(input?{input:{locator:locator(input)}}:{}),...(send?{send:{mode:'keyboard',key:'Enter',locator:locator(send)}}:{}),...(response?{response:{locator:locator(response),selection:editingWebDefinition?.response?.selection||'last'}}:{}),...(!input?{input:undefined}:{}),...(!send?{send:undefined}:{}),...(!response?{response:undefined}:{}),streaming:base.streaming||{enabled:true,completionSignals:['mutation-idle']},capabilities:base.capabilities||{streaming:true,vision:false,files:false,tools:false,maxContextTokens:32768}}}
function persistWebEditor(silent=true){const definition=collectWebDefinition();if(!definition)return false;vscode.postMessage({type:'createWeb',definition,silent});return true}
function tab(name){if(name!=='providers' && $('webEditor').style.display!=='none' && editingWebDefinition)persistWebEditor(true);document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===name));document.querySelectorAll('.panel').forEach(x=>x.classList.toggle('active',x.id===name));if(name==='providers')vscode.postMessage({type:'refreshProviders'})}
document.querySelectorAll('.tab').forEach(x=>x.onclick=()=>tab(x.dataset.tab));
function bubble(kind,text,meta){const el=document.createElement('div');el.className='bubble '+kind;if(meta){const m=document.createElement('div');m.className='meta';m.textContent=meta;el.appendChild(m)}const body=document.createElement('div');body.textContent=text;el.appendChild(body);$('messages').appendChild(el);$('empty')?.remove();$('messages').scrollTop=$('messages').scrollHeight;return {el,body}}
function setBusy(v){$('send').disabled=v;$('cancel').disabled=!v;$('prompt').disabled=v;if(!v)$('prompt').focus()}
$('providerOverride').onchange=()=>{selectedProvider=$('providerOverride').value;vscode.postMessage({type:'setProviderOverride',providerId:selectedProvider})};$('send').onclick=()=>{const text=$('prompt').value.trim();if(!text||$('send').disabled)return;bubble('user',text,'You');$('prompt').value='';setBusy(true);vscode.postMessage({type:'ask',prompt:text,privacy:$('privacy').value,model:$('providerOverride').value || undefined})};$('cancel').onclick=()=>vscode.postMessage({type:'cancel'});$('prompt').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();$('send').click()}});$('settings').onclick=()=>vscode.postMessage({type:'openSettings'});
$('refresh').onclick=()=>vscode.postMessage({type:'refreshProviders'});$('import').onclick=()=>vscode.postMessage({type:'importProvider'});$('newWeb').onclick=()=>{clearWebEditor();$('webEditor').style.display='block';$('webId').focus()};
$('apiId').onchange=()=>{const id=$('apiId').value;if(id==='ollama'){ $('apiTransport').value='local'; if(!$('apiModel').value) $('apiModel').value='qwen2.5:7b'; if(!$('apiBase').value) $('apiBase').value='http://127.0.0.1:11434'; } else if(id==='lmstudio'){ $('apiTransport').value='local'; if(!$('apiBase').value) $('apiBase').value='http://127.0.0.1:1234/v1'; } else { $('apiTransport').value='api'; }};
$('saveApi').onclick=()=>{const id=$('apiId').value;const transport=$('apiTransport').value;const model=$('apiModel').value.trim();const key=$('apiKey').value.trim();const base=$('apiBase').value.trim();if(!model){toast('Model is required');return}if(transport==='api'&&!key){toast('API key is required');return}vscode.postMessage({type:'configureApi',id,transport,model,apiKey:key,baseUrl:base})};
function clearWebEditor(){
  editingWebDefinition=null;
  ['webId','webName','webUrl','webInput','webSend','webResponse'].forEach(id=>$(id).value='');
  $('webBrowserMode').value='existing'; $('webBrowserFamily').value='chrome';
}
function loadWebEditor(def){
  editingWebDefinition=def;
  $('webEditor').style.display='block';
  $('webId').value=def?.provider?.id||'';
  $('webName').value=def?.provider?.name||'';
  $('webUrl').value=def?.website?.url||'';
  $('webBrowserMode').value=def?.browser?.mode||'existing';
  $('webBrowserFamily').value=def?.browser?.family||'chrome';
  $('webInput').value=def?.input?.locator?.strategies?.find(x=>x.type==='css')?.value||'';
  $('webSend').value=def?.send?.locator?.strategies?.find(x=>x.type==='css')?.value||'';
  $('webResponse').value=def?.response?.locator?.strategies?.find(x=>x.type==='css')?.value||'';
  $('webId').focus();
}
$('saveWeb').onclick=()=>{if(!collectWebDefinition()){toast('ID, Name and Website URL are required');return}persistWebEditor(false)};
function render(){const list=$('providerList');list.innerHTML='';const override=$('providerOverride');const selected=selectedProvider || override.value;override.innerHTML='<option value="">Auto route</option>';const all=[...providers.runtime.map(x=>({...x,kind:'runtime'})),...providers.definitions.map(x=>({...x,kind:'definition',configured:true}))];all.forEach(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.id+(p.transport==='web'?' · web':'')+(p.model?' · '+p.model:'')+(p.status==='on'?' · ready':p.status==='error'?' · error':' · off');override.appendChild(o)});override.value=all.some(p=>p.id===selected)?selected:'';selectedProvider=override.value;if(!all.length){list.innerHTML='<div class="empty">No configured providers.</div>';return}all.forEach(p=>{const status=p.status || (p.health?.healthy?'on':'error');const card=document.createElement('div');card.className='card provider-card status-'+status;card.title=p.transport==='web'?'Click to edit this Web Provider':'';card.style.cursor=p.transport==='web'?'pointer':'default';card.onclick=()=>{if(p.transport==='web')vscode.postMessage({type:'editProvider',id:p.id});};const head=document.createElement('div');head.className='cardhead';const left=document.createElement('div');const name=document.createElement('div');name.className='name';name.textContent=p.id;const muted=document.createElement('div');muted.className='muted';muted.textContent=(p.transport||'web')+' · '+(p.model||p.version||'configured');left.appendChild(name);left.appendChild(muted);const statusBox=document.createElement('div');statusBox.className='provider-status';const dot=document.createElement('span');dot.className='provider-dot';const label=document.createElement('span');label.textContent=status==='on'?'ON':status==='off'?'OFF':status==='degraded'?'DEGRADED':'ERROR';statusBox.appendChild(dot);statusBox.appendChild(label);head.appendChild(left);head.appendChild(statusBox);card.appendChild(head);if(p.health?.error){const err=document.createElement('div');err.className='provider-error-text';err.textContent=p.health.error;card.appendChild(err)}const actions=document.createElement('div');actions.className='actions';actions.onclick=e=>e.stopPropagation();if(p.transport==='web'){const running=status==='on';['Start','Scan Input','Scan Send','Scan Response','Pick Input','Pick Send','Pick Response','Stop'].forEach(label=>{const b=document.createElement('button');b.className='btn secondary';b.textContent=label;b.disabled=(label!=='Start' && !running);b.onclick=()=>{if(label==='Start')vscode.postMessage({type:'startWeb',id:p.id});else if(label.startsWith('Scan ')){const target=label==='Scan Input'?'input':label==='Scan Send'?'send':'response';vscode.postMessage({type:'scanWeb',id:p.id,target});}else if(label==='Stop')vscode.postMessage({type:'stopWeb',id:p.id});else vscode.postMessage({type:'pickWeb',id:p.id,target:label==='Pick Input'?'input':label==='Pick Send'?'send':'response'})};actions.appendChild(b)})}const edit=document.createElement('button');edit.className='btn secondary';edit.textContent='Edit';edit.onclick=()=>vscode.postMessage({type:'editProvider',id:p.id});actions.appendChild(edit);const ex=document.createElement('button');ex.className='btn secondary';ex.textContent='Export';ex.onclick=()=>vscode.postMessage({type:'exportProvider',id:p.id});actions.appendChild(ex);const del=document.createElement('button');del.className='btn secondary';del.textContent='Remove';del.onclick=()=>vscode.postMessage({type:'deleteProvider',id:p.id});actions.appendChild(del);card.appendChild(actions);list.appendChild(card)})}
window.addEventListener('message', (e) => {
  const d = e.data;

  if (d.type === 'providerError') {
    providerError(d.message);
    return;
  }

  if (d.type === 'status') {
    $('status').textContent = d.text;
    $('status').className = 'status ' + d.status;
  }

  if (d.type === 'busy') {
    setBusy(d.busy);
  }

  if (d.type === 'requestId') {
    $('cancel').disabled = !d.requestId;
  }

  if (d.type === 'providers') {
    providers = {
      runtime: d.runtime || [],
      definitions: d.definitions || [],
    };
    render();
  }

  if (d.type === 'editWeb') {
    loadWebEditor(d.definition);
  }

  if (d.type === 'toast') {
    toast(d.message);
  }

  if (d.type === 'scanResult') {
    const items = Array.isArray(d.result?.candidates) ? d.result.candidates : [];
    const best = items[0];
    const selector = typeof best?.selector === 'string' ? best.selector : '';

    // A scan is meant to discover the locator and put the best stable
    // candidate directly into the corresponding Web Provider field.
    if (selector && (d.target === 'input' || d.target === 'send' || d.target === 'response')) {
      const fieldId = d.target === 'input'
        ? 'webInput'
        : d.target === 'send'
          ? 'webSend'
          : 'webResponse';
      $(fieldId).value = selector;
    }

    const lines = items.slice(0, 8).map((x, i) => {
      const score = (Number(x.score) * 100).toFixed(0);
      return (i + 1) + '. ' + x.selector + ' · ' + score + '% · ' + x.reason;
    });

    if (selector) {
      toast(
        (d.target || '') + ' locator set: ' + selector +
        (items.length > 1 ? ' · ' + items.length + ' candidates found' : '')
      );
    } else {
      toast((d.target || '') + ' scan: No candidate found');
    }

    if (lines.length) {
      console.log('NyxelRelay scan', d.target, lines);
    }

    return;
  }

  if (d.type === 'picked') {
    const selector = (d.picked?.cssCandidates || [])[0] || '';

    if (d.target === 'input') {
      $('webInput').value = selector;
    }

    if (d.target === 'send') {
      $('webSend').value = selector;
    }

    if (d.target === 'response') {
      $('webResponse').value = selector;
    }

    toast('Locator captured');
  }

  if (d.type === 'assistantStart') {
    const m = d.meta;
    current = bubble(
      'assistant',
      '',
      m.provider + ' • ' +
      m.task + ' • complexity ' +
      Number(m.complexity).toFixed(2) +
      ' • confidence ' +
      Number(m.confidence).toFixed(2)
    );
  }

  if (d.type === 'assistantDelta' && current) {
    current.body.textContent += d.text;
    $('messages').scrollTop = $('messages').scrollHeight;
  }

  if (d.type === 'assistantComplete') {
    current = null;
    setBusy(false);
  }

  if (d.type === 'error') {
    bubble('assistant', 'Error: ' + d.message, 'NyxelRelay');
    setBusy(false);
  }
});
vscode.postMessage({type:'refreshProviders'});
setInterval(()=>{if(document.querySelector('.tab.active')?.dataset.tab==='providers')vscode.postMessage({type:'refreshProviders'})},2000);
</script></body></html>`;
  }

  dispose(): void { for (const disposable of this.disposables) disposable.dispose(); }
}

async function routeAndChat(gateway: GatewayManager, view: ChatView, prompt: string, privacy: PrivacyMode, model?: string): Promise<void> {
  if (!prompt.trim()) return;
  view.setBusy(true);
  view.setGatewayStatus('starting', 'Checking Gateway…');
  const context = collectEditorContext();
  const requestId = randomBytes(16).toString('hex');
  view.setRequestId(requestId);
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const body: Record<string, unknown> = { requestId, prompt: prompt.trim(), privacy, ...(model ? { modelOverride: model } : {}), ...(workspaceRoot ? { workspaceRoot } : {}), ...(context.length ? { context } : {}) };

  try {
    const route = await gateway.request<RouteResponse>('/route', { method: 'POST', body: JSON.stringify(body) });
    view.setGatewayStatus('ready', `Gateway ready • ${route.decision.providerId}`);
    view.beginAssistant({
      provider: route.decision.providerId,
      task: route.signals.task,
      complexity: route.signals.complexity,
      confidence: route.signals.confidence,
      source: route.signals.source,
      evidence: route.signals.evidence,
      contextItems: route.contextSummary?.items ?? 0,
      contextChars: route.contextSummary?.chars ?? 0,
      selectedContext: route.contextSummary?.selected ?? 0,
      reasons: route.decision.reasons,
    });

    const response = await fetch(`${gateway.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-nyxelrelay-token': gateway.authToken },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Gateway ${response.status}: ${await response.text()}`);
    if (!response.body) throw new Error('Gateway returned no response stream');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as { type: string; text?: string; error?: string; providerId?: string };
        if (event.type === 'delta') view.appendAssistant(event.text ?? '');
        if (event.type === 'fallback') view.setGatewayStatus('starting', `Fallback from ${event.providerId ?? 'provider'}…`);
        if (event.type === 'cancelled') { view.setGatewayStatus('ready', 'Request cancelled'); view.completeAssistant(); }
        if (event.type === 'error') throw new Error(event.error ?? 'Provider error');
        if (event.type === 'complete') view.completeAssistant();
      }
    }
    if (buffer.trim()) {
      const event = JSON.parse(buffer) as { type: string; text?: string; error?: string; providerId?: string };
      if (event.type === 'delta') view.appendAssistant(event.text ?? '');
      if (event.type === 'fallback') view.setGatewayStatus('starting', `Fallback from ${event.providerId ?? 'provider'}…`);
      if (event.type === 'cancelled') { view.setGatewayStatus('ready', 'Request cancelled'); view.completeAssistant(); }
      if (event.type === 'error') throw new Error(event.error ?? 'Provider error');
      if (event.type === 'complete') view.completeAssistant();
    }
  } catch (error) {
    view.error(String(error));
    view.setGatewayStatus(gateway.currentState === 'offline' ? 'offline' : 'ready', gateway.currentState === 'offline' ? 'Gateway offline' : 'Gateway ready');
  } finally {
    view.setRequestId(undefined);
    view.setBusy(false);
  }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const gateway = new GatewayManager(context);
  context.subscriptions.push(gateway);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.text = '$(hubot) NyxelRelay';
  status.command = 'nyxelrelay.openChat';
  status.show();
  context.subscriptions.push(status);

  const autoStart = vscode.workspace.getConfiguration('nyxelrelay.gateway').get<boolean>('autoStart', true);
  if (autoStart) {
    const ready = await gateway.start();
    status.text = ready ? '$(check) NyxelRelay' : '$(warning) NyxelRelay offline';
  } else {
    status.text = (await gateway.health()) ? '$(check) NyxelRelay' : '$(circle-slash) NyxelRelay';
  }

  let chatView: ChatView;
  const configureApi = async (config: {id:string;transport:'api'|'local';model:string;baseUrl?:string;apiKey?:string}) => {
    if (config.transport==='api' && config.apiKey) await context.secrets.store(`nyxelrelay.apiKey.${config.id}`, config.apiKey);
    const saved={...config}; delete (saved as any).apiKey; await context.globalState.update(`nyxelrelay.provider.${config.id}`, saved);
    await gateway.configureProvider(config);
  };
  const saveWebDefinition = async (definition: any) => { await gateway.importDefinition(definition); };
  const removeProvider = async (id:string) => { await gateway.deleteProvider(id); await context.globalState.update(`nyxelrelay.provider.${id}`, undefined); await context.secrets.delete(`nyxelrelay.apiKey.${id}`); };
  for (const key of ['openai','deepseek','anthropic','gemini','ollama','lmstudio']) {
    const saved=context.globalState.get<any>(`nyxelrelay.provider.${key}`);
    if(saved){ const apiKey=await context.secrets.get(`nyxelrelay.apiKey.${key}`); try { await gateway.configureProvider({...saved,...(apiKey?{apiKey}:{})}); } catch { /* surfaced by Provider UI */ } }
  }
  const runChat = (prompt: string, privacy: PrivacyMode, model?: string) => routeAndChat(gateway, chatView, prompt, privacy, model);
  chatView = new ChatView(context.extensionUri, gateway, runChat, configureApi, saveWebDefinition, removeProvider);
  context.subscriptions.push(chatView);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider('nyxelrelay.chat', chatView, { webviewOptions: { retainContextWhenHidden: true } }));

  context.subscriptions.push(vscode.commands.registerCommand('nyxelrelay.openChat', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.nyxelrelay');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('nyxelrelay.ask', async () => {
    const prompt = await vscode.window.showInputBox({ prompt: 'Ask NyxelRelay', placeHolder: 'Explain, debug, refactor, test…' });
    if (prompt) await runChat(prompt, 'standard');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('nyxelrelay.restartGateway', async () => {
    status.text = '$(sync~spin) NyxelRelay';
    const ready = await gateway.restart();
    status.text = ready ? '$(check) NyxelRelay' : '$(warning) NyxelRelay offline';
    vscode.window.showInformationMessage(ready ? 'NyxelRelay Gateway is ready.' : 'NyxelRelay Gateway could not be started.');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('nyxelrelay.providerStatus', async () => {
    try {
      const result = await gateway.request<{runtime:Array<{id:string;transport:string;configured:boolean;model?:string;source:string}>;definitions:Array<{id:string;name:string;transport:string;version:string}>}>('/providers');
      const items = result.runtime.map(p => ({ label:`${p.id} · ${p.transport}`, description:p.model ? `${p.model} · ${p.source}` : p.source }));
      const definitions = result.definitions.map(p => ({ label:`${p.id} · definition`, description:`${p.transport} · v${p.version}` }));
      await vscode.window.showQuickPick([...items,...definitions], { title:'NyxelRelay Providers', placeHolder:'Configured runtime providers and imported definitions' });
    } catch (error) { vscode.window.showErrorMessage(`NyxelRelay: ${String(error)}`); }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('nyxelrelay.startWebProvider', async () => {
    try {
      const result = await gateway.request<{definitions:Array<{id:string;name:string;transport:string}>}>('/providers');
      const web = result.definitions.filter(p => p.transport === 'web');
      const selected = await vscode.window.showQuickPick(web.map(p => ({ label:p.name, description:p.id, id:p.id })), { title:'Start Web Provider' });
      if (!selected) return;
      await gateway.request(`/providers/${encodeURIComponent(selected.id)}/start`, { method:'POST' });
      vscode.window.showInformationMessage(`Web provider ${selected.id} is running. Log in through the opened browser window.`);
    } catch (error) { vscode.window.showErrorMessage(`NyxelRelay: ${String(error)}`); }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('nyxelrelay.stopWebProvider', async () => {
    try {
      const result = await gateway.request<{definitions:Array<{id:string;name:string;transport:string}>}>('/providers');
      const web = result.definitions.filter(p => p.transport === 'web');
      const selected = await vscode.window.showQuickPick(web.map(p => ({ label:p.name, description:p.id, id:p.id })), { title:'Stop Web Provider' });
      if (!selected) return;
      await gateway.request(`/providers/${encodeURIComponent(selected.id)}/stop`, { method:'POST' });
      vscode.window.showInformationMessage(`Web provider ${selected.id} stopped.`);
    } catch (error) { vscode.window.showErrorMessage(`NyxelRelay: ${String(error)}`); }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('nyxelrelay.providerImport', async () => {
    try {
      const uri = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'NyxelRelay Provider': ['json'] } });
      if (!uri?.[0]) return;
      const raw = await vscode.workspace.fs.readFile(uri[0]);
      await gateway.request('/providers/import', { method: 'POST', body: Buffer.from(raw).toString('utf8') });
      vscode.window.showInformationMessage('NyxelRelay provider imported.');
    } catch (error) { vscode.window.showErrorMessage(`NyxelRelay: ${String(error)}`); }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('nyxelrelay.providerExport', async () => {
    try {
      const id = await vscode.window.showInputBox({ prompt: 'Provider id to export', placeHolder: 'grok' });
      if (!id) return;
      const definition = await gateway.request(`/providers/${encodeURIComponent(id)}/export`);
      const uri = await vscode.window.showSaveDialog({ saveLabel: 'Export Provider', defaultUri: vscode.Uri.file(`${id}.json`), filters: { 'NyxelRelay Provider': ['json'] } });
      if (!uri) return;
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(definition, null, 2), 'utf8'));
      vscode.window.showInformationMessage(`Exported ${id}.`);
    } catch (error) { vscode.window.showErrorMessage(`NyxelRelay: ${String(error)}`); }
  }));
}

export function deactivate(): void { /* GatewayManager is disposed by extension context. */ }
