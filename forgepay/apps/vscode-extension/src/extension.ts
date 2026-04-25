import * as vscode from "vscode";
import { AgentClient } from "./agent-client.js";
import type { AgentMode } from "./agent-client.js";

const SECRET_KEY = "forgepay.apiKey";

async function getApiKey(
  context: vscode.ExtensionContext
): Promise<string | undefined> {
  let key = await context.secrets.get(SECRET_KEY);
  if (!key) {
    key = await vscode.window.showInputBox({
      prompt:      "Enter your ForgePay API key",
      placeHolder: "fp_live_...",
      password:    true,
      ignoreFocusOut: true,
    });
    if (key) {
      await context.secrets.store(SECRET_KEY, key);
    }
  }
  return key;
}

function getDashboardUrl(): string {
  return (
    vscode.workspace
      .getConfiguration("forgepay")
      .get<string>("dashboardUrl") ?? "https://dashboard.forgepay.io"
  );
}

function createWebviewContent(mode: AgentMode): string {
  const modeLabel =
    mode === "integrate"
      ? "Integrate"
      : mode === "insight"
      ? "Insight"
      : "Act";

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Forge Agent</title>
  <style>
    :root { --navy: #0A2540; --cyan: #00F0FF; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family, -apple-system, sans-serif);
      font-size: var(--vscode-font-size, 13px);
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      display: flex; flex-direction: column; height: 100vh;
    }
    #header {
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      display: flex; align-items: center; gap: 8px;
      font-weight: 600; font-size: 12px; color: var(--cyan);
    }
    #messages {
      flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px;
    }
    .msg { max-width: 85%; padding: 8px 12px; border-radius: 12px; font-size: 12px; line-height: 1.5; white-space: pre-wrap; }
    .msg.user { align-self: flex-end; background: var(--cyan); color: var(--navy); font-weight: 500; }
    .msg.assistant { align-self: flex-start; background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); }
    .tool-card { font-family: monospace; font-size: 11px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 6px 10px; color: var(--vscode-descriptionForeground); }
    .approval-card { border: 1px solid #f59e0b; border-radius: 6px; padding: 10px; background: rgba(245,158,11,0.08); font-size: 12px; }
    .approval-btns { margin-top: 8px; display: flex; gap: 8px; }
    .btn-confirm { background: var(--navy); color: white; border: none; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; }
    .btn-cancel  { background: transparent; color: var(--vscode-descriptionForeground); border: 1px solid var(--vscode-panel-border); padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 11px; }
    #input-area { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--vscode-panel-border); }
    #input { flex: 1; background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); color: var(--vscode-input-foreground); border-radius: 6px; padding: 6px 10px; font-size: 12px; resize: none; outline: none; font-family: inherit; }
    #send { background: var(--navy); color: white; border: none; border-radius: 6px; padding: 6px 14px; cursor: pointer; font-size: 12px; font-weight: 600; }
    #send:disabled { opacity: 0.4; }
  </style>
</head>
<body>
  <div id="header">⚡ Forge Agent — ${modeLabel} mode</div>
  <div id="messages"></div>
  <div id="input-area">
    <textarea id="input" rows="2" placeholder="Ask Forge Agent… (Enter to send, Shift+Enter for newline)"></textarea>
    <button id="send">Send</button>
  </div>
  <script>
    const vscode    = acquireVsCodeApi();
    const messages  = document.getElementById('messages');
    const input     = document.getElementById('input');
    const sendBtn   = document.getElementById('send');
    let   loading   = false;
    let   pendingEl = null;

    function appendMsg(role, text) {
      const el = document.createElement('div');
      el.className = 'msg ' + role;
      el.textContent = text;
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
      return el;
    }

    function appendToolCard(name, input) {
      const el = document.createElement('div');
      el.className = 'tool-card';
      el.textContent = '🔧 ' + name + '(' + JSON.stringify(input).slice(0, 80) + '…)';
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
    }

    function appendApprovalCard(id, name, input) {
      const el = document.createElement('div');
      el.className = 'approval-card';
      el.innerHTML = '<strong>⚠️ Approval required: ' + name + '</strong><pre style="margin:6px 0;font-size:10px;">' + JSON.stringify(input, null, 2) + '</pre><div class="approval-btns"><button class="btn-confirm" onclick="decide(\\''+id+'\\', true)">Confirm</button><button class="btn-cancel" onclick="decide(\\''+id+'\\', false)">Cancel</button></div>';
      messages.appendChild(el);
      messages.scrollTop = messages.scrollHeight;
    }

    window.decide = (id, approved) => {
      vscode.postMessage({ type: 'approval', id, approved });
      const btns = document.querySelector('[data-approval="' + id + '"]');
      if (btns) btns.innerHTML = approved ? '✓ Approved' : '✗ Cancelled';
    };

    function send() {
      const text = input.value.trim();
      if (!text || loading) return;
      loading = true;
      sendBtn.disabled = true;
      appendMsg('user', text);
      input.value = '';
      pendingEl = null;
      vscode.postMessage({ type: 'send', text });
    }

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    sendBtn.addEventListener('click', send);

    window.addEventListener('message', ({ data }) => {
      if (data.type === 'text') {
        if (!pendingEl) { pendingEl = appendMsg('assistant', ''); }
        pendingEl.textContent += data.delta;
        messages.scrollTop = messages.scrollHeight;
      }
      if (data.type === 'tool_call')         appendToolCard(data.name, data.input);
      if (data.type === 'approval_required') appendApprovalCard(data.id, data.name, data.input);
      if (data.type === 'done') { loading = false; sendBtn.disabled = false; pendingEl = null; }
      if (data.type === 'error') {
        appendMsg('assistant', 'Error: ' + data.message);
        loading = false; sendBtn.disabled = false; pendingEl = null;
      }
    });
  </script>
</body>
</html>`;
}

function registerForgeCommand(
  context: vscode.ExtensionContext,
  commandId: string,
  mode: AgentMode
) {
  const disposable = vscode.commands.registerCommand(commandId, async () => {
    const apiKey = await getApiKey(context);
    if (!apiKey) {
      vscode.window.showErrorMessage("ForgePay API key is required to use Forge Agent.");
      return;
    }

    const dashboardUrl = getDashboardUrl();
    const client = new AgentClient({ dashboardUrl, apiKey });

    const panel = vscode.window.createWebviewPanel(
      "forgeAgent",
      `Forge Agent — ${mode.charAt(0).toUpperCase() + mode.slice(1)}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    panel.webview.html = createWebviewContent(mode);

    panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "send") {
        try {
          const gen = client.sendMessage(
            msg.text,
            mode,
            async (id, name, input) => {
              const choice = await vscode.window.showWarningMessage(
                `Forge Agent wants to run: ${name}\n${JSON.stringify(input, null, 2)}`,
                { modal: true },
                "Confirm",
                "Cancel"
              );
              return choice === "Confirm";
            }
          );

          for await (const event of gen) {
            panel.webview.postMessage(event);
          }
        } catch (err) {
          panel.webview.postMessage({ type: "error", message: String(err) });
        }
      }
    }, undefined, context.subscriptions);
  });

  context.subscriptions.push(disposable);
}

export function activate(context: vscode.ExtensionContext) {
  registerForgeCommand(context, "forge.chat",      "act");
  registerForgeCommand(context, "forge.integrate", "integrate");
  registerForgeCommand(context, "forge.insight",   "insight");
}

export function deactivate() {}
