import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import http from 'http';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DEBUG_PORT = 9222;
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
];

fs.mkdirSync(DATA_DIR, { recursive: true });

function getStorageStatePath(platform: string): string {
  return path.join(DATA_DIR, `storage-${platform}.json`);
}

function getProfileDir(platform: string): string {
  return path.join(DATA_DIR, `chrome-profile-${platform}`);
}

function findChrome(): string | null {
  for (const p of CHROME_PATHS) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/json/version', timeout: 1500 },
      (res) => {
        res.resume();
        resolve(true);
      }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForChrome(maxWaitMs = 20000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    if (await isPortInUse(DEBUG_PORT)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

interface ChromeTab {
  id: string;
  url: string;
  type: string;
  title?: string;
  webSocketDebuggerUrl?: string;
}

function getChromeTabs(): Promise<ChromeTab[]> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: DEBUG_PORT, path: '/json/list', timeout: 2000 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const tabs = JSON.parse(data);
            resolve(tabs.filter((t: any) => t.type === 'page'));
          } catch {
            resolve([]);
          }
        });
      }
    );
    req.on('error', () => resolve([]));
    req.on('timeout', () => {
      req.destroy();
      resolve([]);
    });
  });
}

function getCdpVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: DEBUG_PORT, path: '/json/version', timeout: 2000 },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const info = JSON.parse(data);
            resolve(info['Browser'] || 'unknown');
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
  });
}

async function cdpRequest<T>(wsUrl: string, requests: { id: number; method: string; params?: any }[], onEvent?: (msg: any) => void, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let settled = false;
    const results = new Map<number, any>();
    const expectedIds = new Set(requests.map((r) => r.id));

    const finish = (value: T, err?: Error) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch {}
      if (err) reject(err);
      else resolve(value);
    };

    ws.onopen = () => {
      for (const req of requests) {
        ws.send(JSON.stringify(req));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.id && expectedIds.has(msg.id)) {
          results.set(msg.id, msg);
          if (results.size === expectedIds.size) {
            finish(results as T);
          }
        }
        if (onEvent) onEvent(msg);
      } catch {}
    };

    ws.onerror = () => finish(undefined as T, new Error('WebSocket error'));
    ws.onclose = () => finish(undefined as T, new Error('WebSocket closed'));

    setTimeout(() => finish(undefined as T, new Error('CDP request timeout')), timeoutMs);
  });
}

async function extractCookiesViaCDP(): Promise<any[]> {
  const target = await getPreferredPageTarget('zhipin.com');
  if (!target?.webSocketDebuggerUrl) {
    throw new Error('No CDP page target available');
  }

  const results = await cdpRequest<Map<number, any>>(target.webSocketDebuggerUrl, [
    { id: 1, method: 'Network.getAllCookies' },
  ]);

  const msg = results.get(1);
  if (msg?.error) throw new Error(msg.error.message);
  const cookies = msg?.result?.cookies || [];
  const platformCookies = cookies.filter((c: any) => {
    const domain = String(c.domain || '');
    return domain.includes('zhipin.com') || domain.includes('bosszhipin.com') || domain.includes('kanzhun.com');
  });

  return (platformCookies.length > 0 ? platformCookies : cookies).map((c: any) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: c.expires || -1,
    httpOnly: c.httpOnly || false,
    secure: c.secure || false,
    sameSite: (c.sameSite as 'Strict' | 'Lax' | 'None') || 'Lax',
  }));
}

async function getPreferredPageTarget(preferHost?: string): Promise<ChromeTab | undefined> {
  const tabs = await getChromeTabs();
  return tabs.find((t) => t.webSocketDebuggerUrl && preferHost && t.url.includes(preferHost))
    || tabs.find((t) => t.webSocketDebuggerUrl && t.url.includes('zhipin.com'))
    || tabs.find((t) => t.webSocketDebuggerUrl && t.url !== 'about:blank')
    || tabs.find((t) => t.webSocketDebuggerUrl);
}

export async function evaluateOnZhipinTab(expression: string, timeoutMs = 30000): Promise<any> {
  const target = await getPreferredPageTarget('zhipin.com');
  if (!target?.webSocketDebuggerUrl) {
    throw new Error('No CDP page target available');
  }

  // Enable page/runtime domains first
  await cdpRequest(target.webSocketDebuggerUrl, [
    { id: 1, method: 'Runtime.enable' },
    { id: 2, method: 'Page.enable' },
  ], undefined, 5000);

  const results = await cdpRequest<Map<number, any>>(target.webSocketDebuggerUrl, [
    { id: 3, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } },
  ], undefined, timeoutMs);

  const msg = results.get(3);
  if (msg?.error) throw new Error(msg.error.message);
  if (msg?.result?.exceptionDetails) throw new Error(msg.result.exceptionDetails.exception?.description || 'Runtime exception');
  return msg?.result?.result?.value;
}

export async function navigateZhipinTab(url: string, timeoutMs = 60000): Promise<void> {
  const target = await getPreferredPageTarget('zhipin.com');
  if (!target?.webSocketDebuggerUrl) {
    throw new Error('No CDP page target available');
  }

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(target.webSocketDebuggerUrl as string);
    let nextId = 1;
    let settled = false;
    let navigationStarted = false;
    let readyStateTimer: NodeJS.Timeout | null = null;
    const pending = new Map<number, { resolve: (value: any) => void; reject: (err: Error) => void }>();

    const cleanup = () => {
      if (readyStateTimer) clearInterval(readyStateTimer);
      try { ws.close(); } catch {}
    };

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (err) reject(err);
      else resolve();
    };

    const send = (method: string, params?: any) => new Promise<any>((resolveRequest, rejectRequest) => {
      const id = nextId++;
      pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      ws.send(JSON.stringify({ id, method, params }));
    });

    const checkReadyState = async () => {
      if (!navigationStarted || settled) return;
      try {
        const msg = await send('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        });
        const state = msg?.result?.result?.value;
        if (state === 'interactive' || state === 'complete') {
          finish();
        }
      } catch {
        // Navigation may briefly destroy the execution context; the next tick can succeed.
      }
    };

    ws.onopen = async () => {
      try {
        await send('Page.enable');
        await send('Runtime.enable');
        const navigateResult = await send('Page.navigate', { url });
        if (navigateResult?.error) throw new Error(navigateResult.error.message);
        navigationStarted = true;
        readyStateTimer = setInterval(checkReadyState, 500);
        void checkReadyState();
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string);
        if (msg.id && pending.has(msg.id)) {
          const handler = pending.get(msg.id)!;
          pending.delete(msg.id);
          if (msg.error) handler.reject(new Error(msg.error.message));
          else handler.resolve(msg);
        }
        if (navigationStarted && (msg.method === 'Page.loadEventFired' || msg.method === 'Page.domContentEventFired')) {
          finish();
        }
      } catch {}
    };

    ws.onerror = () => finish(new Error('WebSocket error'));
    ws.onclose = () => finish(new Error('WebSocket closed'));

    setTimeout(() => finish(new Error('CDP navigation timeout')), timeoutMs);
  });
}

export function hasLoginState(platform: string): boolean {
  const storageStatePath = getStorageStatePath(platform);
  if (!fs.existsSync(storageStatePath)) return false;

  try {
    const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf-8'));
    if (!Array.isArray(state.cookies)) return false;
    return state.cookies.some((cookie: any) => {
      const domain = String(cookie.domain || '');
      const expires = Number(cookie.expires ?? -1);
      const notExpired = expires <= 0 || expires * 1000 > Date.now();
      const domainMatches = platform !== 'boss' || domain.includes('zhipin.com') || domain.includes('bosszhipin.com');
      return domainMatches && notExpired;
    });
  } catch {
    return false;
  }
}

export function getLoginStatePath(platform: string): string {
  return getStorageStatePath(platform);
}

export function clearLoginSuccess(platform: string): void {
  const p = getStorageStatePath(platform);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function closeBrowser(_platform: string): Promise<void> {
  // Keep the user's visible Chrome session alive. CDP sockets opened by helper
  // functions are short-lived and close themselves after each request.
}

async function launchChromeWithDebug(userDataDir: string, url: string): Promise<boolean> {
  const chromePath = findChrome();
  if (!chromePath) {
    console.log('❌ 找不到 Chrome 安装位置');
    return false;
  }

  if (await isPortInUse(DEBUG_PORT)) {
    console.log(`✅ Chrome 调试端口 ${DEBUG_PORT} 已在运行，复用现有实例`);
    return true;
  }

  for (const lockFile of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    const lockPath = path.join(userDataDir, lockFile);
    if (fs.existsSync(lockPath)) {
      try { fs.unlinkSync(lockPath); } catch {}
    }
  }

  console.log(`🚀 启动 Chrome（调试模式）...`);

  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1920,1080',
    url,
  ];

  const child = spawn(chromePath, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });
  child.unref();

  const started = await waitForChrome(20000);
  if (!started) {
    console.log('❌ Chrome 启动超时（20秒）');
    return false;
  }

  const version = await getCdpVersion();
  console.log(`✅ Chrome 已启动 (${version})，调试端口 ${DEBUG_PORT}`);
  return true;
}

interface LoginOptions {
  platform: string;
  loginUrl: string;
  successUrlPattern: string | RegExp;
  timeoutMs?: number;
}

export async function loginInteractive({
  platform,
  loginUrl,
  successUrlPattern,
  timeoutMs = 120000,
}: LoginOptions): Promise<boolean> {
  const userDataDir = getProfileDir(platform);
  const storageStatePath = getStorageStatePath(platform);
  fs.mkdirSync(userDataDir, { recursive: true });

  const launched = await launchChromeWithDebug(userDataDir, loginUrl);
  if (!launched) {
    throw new Error('无法启动 Chrome');
  }

  const pattern =
    typeof successUrlPattern === 'string' ? new RegExp(successUrlPattern) : successUrlPattern;

  console.log(`👉 请在 Chrome 窗口中完成登录（${timeoutMs / 1000}秒内）...`);
  console.log(`📍 等待 URL 匹配: ${pattern}`);

  const startTime = Date.now();
  let loggedIn = false;
  let lastUrl = '';

  while (Date.now() - startTime < timeoutMs) {
    const tabs = await getChromeTabs();

    if (tabs.length === 0) {
      console.log('⚠️ 没有找到打开的标签页，Chrome 可能已关闭');
      throw new Error('Chrome 浏览器已关闭，请重试');
    }

    for (const tab of tabs) {
      if (tab.url && tab.url !== lastUrl && tab.url !== 'about:blank') {
        console.log(`📍 Tab: ${tab.url}`);
        lastUrl = tab.url;
      }
      if (tab.url && pattern.test(tab.url)) {
        loggedIn = true;
        console.log(`✅ ${platform} 登录成功（URL 匹配: ${tab.url}）`);
        break;
      }
    }

    if (loggedIn) break;
    await sleep(2000);
  }

  if (!loggedIn) {
    throw new Error(`${platform} 登录超时，请重试`);
  }

  console.log('💾 正在提取登录态（WebSocket CDP）...');
  try {
    const cookies = await extractCookiesViaCDP();
    const state = { cookies, origins: [] };
    fs.writeFileSync(storageStatePath, JSON.stringify(state, null, 2));
    console.log(`✅ 登录态已保存（${cookies.length} 个 cookies）`);
  } catch (err) {
    throw new Error(`保存登录态失败: ${err instanceof Error ? err.message : err}`);
  }

  console.log('💡 Chrome 保持打开，可以继续使用');
  return true;
}

function normalizeCookieForCDP(cookie: any) {
  const expires = Number(cookie.expires ?? -1);
  const normalized: any = {
    name: String(cookie.name || ''),
    value: String(cookie.value || ''),
    domain: cookie.domain,
    path: cookie.path || '/',
    httpOnly: Boolean(cookie.httpOnly),
    secure: Boolean(cookie.secure),
  };

  if (expires > 0) normalized.expires = expires;
  if (cookie.sameSite && ['Strict', 'Lax', 'None'].includes(cookie.sameSite)) {
    normalized.sameSite = cookie.sameSite;
  }

  return normalized.name && normalized.domain ? normalized : null;
}

async function applyCookiesViaCDP(platform: string): Promise<void> {
  const storageStatePath = getStorageStatePath(platform);
  const state = JSON.parse(fs.readFileSync(storageStatePath, 'utf-8'));
  const cookies = Array.isArray(state.cookies)
    ? state.cookies.map(normalizeCookieForCDP).filter(Boolean)
    : [];

  if (cookies.length === 0) {
    throw new Error(`${platform} 登录态文件没有可用 cookies，请重新扫码登录`);
  }

  const target = await getPreferredPageTarget('zhipin.com');
  if (!target?.webSocketDebuggerUrl) {
    throw new Error('No CDP page target available');
  }

  const results = await cdpRequest<Map<number, any>>(target.webSocketDebuggerUrl, [
    { id: 1, method: 'Network.setCookies', params: { cookies } },
  ], undefined, 10000);

  const msg = results.get(1);
  if (msg?.error) throw new Error(msg.error.message);
}

export async function ensureBrowserWithLogin(platform: string): Promise<void> {
  const storageStatePath = getStorageStatePath(platform);
  if (!fs.existsSync(storageStatePath)) {
    throw new Error(`${platform} 未登录，请先扫码登录`);
  }

  const userDataDir = getProfileDir(platform);
  fs.mkdirSync(userDataDir, { recursive: true });

  if (!(await isPortInUse(DEBUG_PORT))) {
    const launched = await launchChromeWithDebug(userDataDir, 'about:blank');
    if (!launched) throw new Error('无法启动 Chrome');
  }

  try {
    await applyCookiesViaCDP(platform);
  } catch (err) {
    console.log(`⚠️ 加载 cookies 失败：${err instanceof Error ? err.message : err}`);
    throw err;
  }
}
