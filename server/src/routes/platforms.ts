import { Router } from 'express';
import db from '../database';
import { v4 as uuidv4 } from '../utils';
import { hasLoginState, clearLoginSuccess, validateLoginState } from '../crawlers/browser';
import { PLATFORM_CONFIG } from '../platformRegistry';

const router = Router();
const DEMO_USER_ID = 'u001';

function markPlatformLoginState(platform: string, loggedIn: boolean) {
  db.prepare(
    'UPDATE platform_accounts SET login_state = ?, status = ? WHERE user_id = ? AND platform_name = ?'
  ).run(loggedIn ? 'logged_in' : 'unlogged', loggedIn ? 'active' : 'inactive', DEMO_USER_ID, platform);
}

router.get('/platforms', async (req, res) => {
  const accounts = db.prepare(
    'SELECT * FROM platform_accounts WHERE user_id = ?'
  ).all(DEMO_USER_ID) as any[];
  const shouldVerify = req.query.verify === '1' || req.query.verify === 'true';

  const platforms = [];
  for (const config of PLATFORM_CONFIG) {
    const account = accounts.find(a => a.platform_name === config.name);
    const loggedIn = shouldVerify
      ? await validateLoginState(config.name)
      : hasLoginState(config.name);
    if (shouldVerify && account) markPlatformLoginState(config.name, loggedIn);
    const {
      loginUrl: _loginUrl,
      successUrlPattern: _successUrlPattern,
      hosts: _hosts,
      authCookieNames: _authCookieNames,
      loginProbeUrl: _loginProbeUrl,
      loginRequiredUrlPattern: _loginRequiredUrlPattern,
      loginRequiredKeywords: _loginRequiredKeywords,
      loginCheckExpression: _loginCheckExpression,
      requiresVerifiedLoginState: _requiresVerifiedLoginState,
      ...publicConfig
    } = config;
    platforms.push({
      ...publicConfig,
      bound: loggedIn,
      status: loggedIn ? 'active' : 'inactive',
      loginState: loggedIn ? 'logged_in' : 'unlogged',
      lastLogin: account?.last_login || null,
      lastSync: account?.last_sync || null,
      accountId: account?.account_id || null,
    });
  }

  res.json(platforms);
});

// 绑定平台（密码方式 - 保留接口但 Demo 不实际使用）
router.post('/platforms/:name/bind', (req, res) => {
  const { name } = req.params;
  const { account, password } = req.body;
  const config = PLATFORM_CONFIG.find(p => p.name === name);

  if (!config) return res.status(400).json({ error: `平台 ${name} 暂不支持` });

  if (!account || !password) {
    return res.status(400).json({ error: '请填写账号和密码' });
  }

  const existing = db.prepare(
    'SELECT * FROM platform_accounts WHERE user_id = ? AND platform_name = ?'
  ).get(DEMO_USER_ID, name) as any;

  if (existing) {
    db.prepare(
      'UPDATE platform_accounts SET account_id = ?, credentials = ?, status = ?, last_sync = datetime("now") WHERE id = ?'
    ).run(account, JSON.stringify({ password: '***' }), 'active', existing.id);
  } else {
    db.prepare(
      'INSERT INTO platform_accounts (id, user_id, platform_name, account_id, credentials, status, last_sync) VALUES (?, ?, ?, ?, ?, ?, datetime("now"))'
    ).run(uuidv4(), DEMO_USER_ID, name, account, JSON.stringify({ password: '***' }), 'active');
  }

  const {
    loginUrl: _loginUrl,
    successUrlPattern: _successUrlPattern,
    hosts: _hosts,
    authCookieNames: _authCookieNames,
    loginProbeUrl: _loginProbeUrl,
    loginRequiredUrlPattern: _loginRequiredUrlPattern,
    loginRequiredKeywords: _loginRequiredKeywords,
    loginCheckExpression: _loginCheckExpression,
    requiresVerifiedLoginState: _requiresVerifiedLoginState,
    ...publicConfig
  } = config;
  res.json({ success: true, platform: { ...publicConfig, bound: true, status: 'active' } });
});

// 登出平台（清除登录态）
router.delete('/platforms/:name/logout', (req, res) => {
  const { name } = req.params;
  db.prepare(
    'UPDATE platform_accounts SET login_state = ?, status = ?, last_login = NULL WHERE user_id = ? AND platform_name = ?'
  ).run('unlogged', 'inactive', DEMO_USER_ID, name);

  // 删除登录态文件
  clearLoginSuccess(name);
  console.log(`🗑️ 已清除 ${name} 登录态`);

  res.json({ success: true });
});

export default router;
