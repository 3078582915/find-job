export type PlatformName = 'boss' | 'zhilian' | '51job' | 'shixiseng';

export interface PlatformConfig {
  name: PlatformName;
  label: string;
  logo: string;
  color: string;
  loginType: 'qrcode' | 'browser';
  loginUrl: string;
  successUrlPattern: RegExp;
  hosts: string[];
  authCookieNames?: string[];
  loginProbeUrl?: string;
  loginRequiredUrlPattern?: RegExp;
  loginRequiredKeywords?: string[];
  loginCheckExpression?: string;
  requiresVerifiedLoginState?: boolean;
  requiresLoginForCrawl: boolean;
}

export const PLATFORM_CONFIG: PlatformConfig[] = [
  {
    name: 'boss',
    label: 'BOSS直聘',
    logo: 'B',
    color: '#00D4AA',
    loginType: 'qrcode',
    loginUrl: 'https://login.zhipin.com/',
    successUrlPattern: /zhipin\.com\/web\/geek\//,
    hosts: ['zhipin.com', 'bosszhipin.com', 'kanzhun.com'],
    authCookieNames: ['wt2', 'zp_at', '__zp_stoken__'],
    loginProbeUrl: 'https://www.zhipin.com/web/geek/',
    loginRequiredUrlPattern: /login\.zhipin\.com|zhipin\.com\/web\/user/i,
    loginRequiredKeywords: ['扫码登录', '登录/注册', '请先登录', '登录后查看'],
    requiresLoginForCrawl: true,
  },
  {
    name: 'zhilian',
    label: '智联招聘',
    logo: '智',
    color: '#FF6B35',
    loginType: 'browser',
    loginUrl: 'https://passport.zhaopin.com/',
    successUrlPattern: /https?:\/\/(?!passport\.)[^/]*zhaopin\.com/i,
    hosts: ['zhaopin.com'],
    authCookieNames: ['at', 'rt', 'zp_passport_deepknow_sessionId'],
    loginProbeUrl: 'https://www.zhaopin.com/',
    loginRequiredUrlPattern: /passport\.zhaopin\.com|login\.zhaopin\.com/i,
    loginRequiredKeywords: ['扫码登录', '账号登录', '登录/注册', '请先登录', '登录后查看'],
    requiresLoginForCrawl: true,
  },
  {
    name: '51job',
    label: '前程无忧',
    logo: '51',
    color: '#1E3A5F',
    loginType: 'browser',
    loginUrl: 'https://login.51job.com/login.php',
    successUrlPattern: /https?:\/\/(?!(?:login|passport)\.)[^/]*51job\.com/i,
    hosts: ['51job.com', '51jobcdn.com'],
    authCookieNames: ['51job', 'ps'],
    loginProbeUrl: 'https://we.51job.com/',
    loginRequiredUrlPattern: /login\.51job\.com|passport\.51job\.com/i,
    loginRequiredKeywords: ['会员登录', '账号登录', '登录/注册', '请先登录', '登录后查看'],
    requiresLoginForCrawl: true,
  },
  {
    name: 'shixiseng',
    label: '实习僧',
    logo: '实',
    color: '#FF7A45',
    loginType: 'browser',
    loginUrl: 'https://www.shixiseng.com/',
    successUrlPattern: /https?:\/\/[^/]*shixiseng\.com/i,
    hosts: ['shixiseng.com', 'xiaoyuanzhao.com'],
    loginProbeUrl: 'https://www.shixiseng.com/',
    loginRequiredUrlPattern: /passport\.shixiseng\.com|login\.shixiseng\.com/i,
    loginRequiredKeywords: ['扫码登录', '账号登录', '登录/注册', '请先登录'],
    loginCheckExpression: `(() => {
      const status = document.querySelector('.login-status, header [class*="login-status"]');
      const account = status?.querySelector('.logined');
      if (!status || !account) return false;

      const statusRect = status.getBoundingClientRect();
      const accountRect = account.getBoundingClientRect();
      const accountText = String(account.textContent || '').replace(/\\s+/g, ' ').trim();
      const hasIdentityElement = Boolean(
        account.querySelector('a[href], img, [class*="avatar"], [class*="user"]')
      );
      return statusRect.width > 0
        && statusRect.height > 0
        && accountRect.width > 0
        && accountRect.height > 0
        && (Boolean(accountText) || hasIdentityElement);
    })()`,
    requiresVerifiedLoginState: true,
    requiresLoginForCrawl: false,
  },
];

export function getPlatformConfig(name: string): PlatformConfig | undefined {
  return PLATFORM_CONFIG.find((platform) => platform.name === name);
}

export function isSupportedPlatform(name: string): name is PlatformName {
  return Boolean(getPlatformConfig(name));
}
