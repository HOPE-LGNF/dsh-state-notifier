/**
 * 可选的原生系统通知通道：Windows 宿主直接调用，WSL 宿主经 interop 调用。
 *
 * 浏览器通知受制于浏览器与 Windows 的抑制规则（全屏、专注助手），无法穿透。
 * 这条通道绕过浏览器，用 WinRT toast 的 `scenario="urgent"` 在支持的 Windows 上
 * 越过专注助手。它默认关闭，失败时静默返回，绝不影响 Agent。
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, isAbsolute } from 'node:path';

/** 只接受能直接调用 WinRT 的解释器；cmd.exe 无法直接创建 toast，不作为执行目标。 */
export const ALLOWED_EXECUTABLES = Object.freeze(['powershell.exe', 'pwsh.exe']);
export const NATIVE_APP_ID = 'DeepSeek.Harness.StateNotifier';
const EXEC_TIMEOUT_MS = 10_000;

const isAllowed = value => typeof value === 'string'
  && ALLOWED_EXECUTABLES.includes(basename(value).toLowerCase());

function readText(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

/** WSL 判据是 interop 注册与注入变量，而不是 PATH 里有没有 powershell。 */
function detectWsl() {
  if (process.platform !== 'linux') return false;
  if (process.env.WSL_INTEROP || process.env.WSL_DISTRO_NAME) return true;
  return readText('/proc/sys/fs/binfmt_misc/WSLInterop').includes('enabled');
}

/** 折叠重复斜杠，避免生成 `/v1.0//powershell.exe` 这类路径。 */
const normalize = path => path.replace(/\/{2,}/g, '/');

/**
 * 排序：系统自带的 Windows PowerShell 5.1 优先。
 * PowerShell 7（pwsh）不再内置 WinRT 投影，调用 toast 类型会失败，只作后备。
 */
const rank = path => (basename(path).toLowerCase() === 'powershell.exe' ? 0 : 1);

/** 按小写去重（Windows 路径大小写不敏感），保留首个写法。 */
function dedupe(paths) {
  const seen = new Set();
  const result = [];
  for (const path of paths) {
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(path);
  }
  return result;
}

/** 列出 PATH 中可与 Windows 互操作的解释器（WSL 下 PATH 可能不含 /mnt）。 */
function fromPath() {
  const found = [];
  for (const dir of (process.env.PATH ?? '').split(':')) {
    if (!dir) continue;
    for (const name of ALLOWED_EXECUTABLES) {
      const candidate = normalize(`${dir}/${name}`);
      try { if (statSync(candidate).isFile()) found.push(candidate); } catch { /* 不可读就跳过 */ }
    }
  }
  return found;
}

/** 扫描挂载的 Windows 盘符下的标准安装位置；系统盘不一定是 c。 */
function fromMounts() {
  const found = [];
  let drives = [];
  try { drives = readdirSync('/mnt'); } catch { return found; }
  for (const drive of drives) {
    found.push(
      normalize(`/mnt/${drive}/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`),
      normalize(`/mnt/${drive}/Program Files/PowerShell/7/pwsh.exe`),
      normalize(`/mnt/${drive}/Program Files/PowerShell/7-preview/pwsh.exe`),
    );
  }
  return found.filter(candidate => { try { return statSync(candidate).isFile(); } catch { return false; } });
}

/**
 * 探测可用性。只读文件系统与环境，不执行任何东西。
 * @returns {platform, wsl, available, candidates, reason}
 */
export function probe() {
  if (process.platform === 'win32') {
    const candidates = dedupe(fromPath()).sort((a, b) => rank(a) - rank(b));
    return { platform: 'win32', wsl: false, available: candidates.length > 0, candidates, reason: candidates.length ? '' : '未找到 powershell.exe 或 pwsh.exe' };
  }
  if (process.platform !== 'linux') {
    return { platform: process.platform, wsl: false, available: false, candidates: [], reason: '仅支持 Windows 与 WSL' };
  }
  if (!detectWsl()) {
    return { platform: 'linux', wsl: false, available: false, candidates: [], reason: '当前不是 WSL 环境' };
  }
  const candidates = dedupe([...fromPath(), ...fromMounts()]).sort((a, b) => rank(a) - rank(b));
  return {
    platform: 'linux', wsl: true, available: candidates.length > 0, candidates,
    reason: candidates.length ? '' : 'WSL interop 不可用，或未找到 powershell.exe / pwsh.exe',
  };
}

/**
 * 解析要执行的文件。manual 只接受绝对路径、白名单文件名且真实存在。
 * @returns {{ok: true, path: string} | {ok: false, reason: string}}
 */
export function resolveExecutable(mode, manualPath, detected = probe()) {
  if (mode !== 'manual') {
    if (!detected.available) return { ok: false, reason: detected.reason || '未找到可用的解释器' };
    return { ok: true, path: detected.candidates[0] };
  }
  if (typeof manualPath !== 'string' || !manualPath.trim()) return { ok: false, reason: '手动模式需要填写绝对路径' };
  const path = manualPath.trim();
  if (!isAbsolute(path)) return { ok: false, reason: '必须填写绝对路径' };
  if (!isAllowed(path)) return { ok: false, reason: '只接受 powershell.exe 或 pwsh.exe' };
  if (!existsSync(path)) return { ok: false, reason: '该路径不存在' };
  return { ok: true, path };
}

/** PowerShell 5.1 需要显式预加载 WinRT 类型，否则报“找不到类型”。 */
const SCRIPT = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
try {
  $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
  $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
  $payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('__PAYLOAD__')) | ConvertFrom-Json
  $appId = '__APPID__'
  $key = "HKCU:\\Software\\Classes\\AppUserModelId\\$appId"
  New-Item -Path $key -Force | Out-Null
  Set-ItemProperty -Path $key -Name DisplayName -Value 'DeepSeek Harness'
  $title = [Security.SecurityElement]::Escape([string]$payload.title)
  $body = [Security.SecurityElement]::Escape([string]$payload.body)
  $scenario = ''
  if ([Environment]::OSVersion.Version.Build -ge 22621) { $scenario = ' scenario="urgent"' }
  $xmlText = '<toast' + $scenario + '><visual><binding template="ToastGeneric"><text>' + $title + '</text><text>' + $body + '</text></binding></visual></toast>'
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $xml.LoadXml($xmlText)
  $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
  Write-Output 'RESULT ok'
} catch {
  Write-Output ('RESULT fail ' + $_.Exception.Message)
  exit 1
}`;

const encodePayload = payload => Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
const encodeScript = script => Buffer.from(script, 'utf16le').toString('base64');

/**
 * 发一条原生通知。永不抛错：宿主侧通知失败不能影响 Agent。
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export function notify(executable, { title, body }) {
  return new Promise(resolve => {
    if (!isAllowed(executable)) { resolve({ ok: false, reason: '解释器不在白名单内' }); return; }
    const script = SCRIPT
      .replace('__PAYLOAD__', encodePayload({ title: String(title ?? ''), body: String(body ?? '') }))
      .replace('__APPID__', NATIVE_APP_ID);
    try {
      execFile(executable, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encodeScript(script)], {
        timeout: EXEC_TIMEOUT_MS, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      }, error => {
        if (error) { resolve({ ok: false, reason: error.killed ? '执行超时' : '执行失败' }); return; }
        resolve({ ok: true });
      });
    } catch (error) {
      resolve({ ok: false, reason: '无法启动解释器' });
    }
  });
}
