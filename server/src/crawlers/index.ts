import { crawlBoss, type CrawledJob } from './boss';
import { crawl51Job, crawlShixiseng, crawlZhilian } from './otherPlatforms';
import type { PlatformName } from '../platformRegistry';

export type { CrawledJob };

export function crawlJobsByPlatform(
  platform: PlatformName,
  query: string,
  city?: string,
  pages?: number
): Promise<{ jobs: CrawledJob[]; error?: string; needLogin?: boolean }> {
  switch (platform) {
    case 'boss':
      return crawlBoss(query, city, pages);
    case 'zhilian':
      return crawlZhilian(query, city, pages);
    case '51job':
      return crawl51Job(query, city, pages);
    case 'shixiseng':
      return crawlShixiseng(query, city, pages);
    default:
      return Promise.resolve({ jobs: [], error: `平台 ${platform} 暂不支持` });
  }
}
