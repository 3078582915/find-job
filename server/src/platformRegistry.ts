export type PlatformName = 'boss' | 'zhilian' | '51job' | 'lagou';

export interface PlatformConfig {
  name: PlatformName;
  label: string;
  logo: string;
  color: string;
  loginType: 'qrcode' | 'browser';
  loginUrl: string;
  successUrlPattern: RegExp;
  hosts: string[];
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
  },
  {
    name: 'lagou',
    label: '拉勾网',
    logo: '拉',
    color: '#00BFFF',
    loginType: 'browser',
    loginUrl: 'https://passport.lagou.com/login/login.html',
    successUrlPattern: /https?:\/\/(?!(?:passport|login)\.)[^/]*lagou\.com/i,
    hosts: ['lagou.com'],
  },
];

export function getPlatformConfig(name: string): PlatformConfig | undefined {
  return PLATFORM_CONFIG.find((platform) => platform.name === name);
}

export function isSupportedPlatform(name: string): name is PlatformName {
  return Boolean(getPlatformConfig(name));
}
