import crypto from 'crypto';
import db from '../database';
import { decodeBossPrivateText } from '../salaryCodec';
import { v4 as uuidv4 } from '../utils';

const EMBEDDING_DIMENSION = 512;
const EMBEDDING_MODEL = `local-hash-v1-${EMBEDDING_DIMENSION}`;
const MAX_CHUNK_LENGTH = 900;
const CHUNK_OVERLAP = 120;

export interface RagSearchInput {
  query: string;
  city?: string;
  platform?: string;
  onlyUnclicked?: boolean;
  onlyClicked?: boolean;
  salaryStatus?: 'all' | 'present' | 'missing';
  companyStatus?: 'all' | 'present' | 'missing';
  minSalaryK?: number;
  limit?: number;
  topK?: number;
  minScore?: number;
  userId?: string;
}

interface JobRow {
  id: string;
  platform: string;
  job_id: string | null;
  title: string;
  company_name: string | null;
  salary: string | null;
  location: string | null;
  experience: string | null;
  education: string | null;
  company_size: string | null;
  company_industry: string | null;
  job_url: string;
  tags: string | null;
  status: string;
  crawled_at: string;
  clicked?: number;
}

interface EmbeddingCandidate extends JobRow {
  chunk_index: number;
  content: string;
  embedding: string;
}

const DOMAIN_SYNONYMS: Array<{ match: RegExp; terms: string[]; requiredAny?: string[] }> = [
  {
    match: /康复|理疗|物理治疗|作业治疗|康复医疗/,
    terms: ['康复', '康复医疗', '康复治疗', '理疗', '物理治疗', '作业治疗', '康复师', '康复医院'],
    requiredAny: ['康复', '理疗', '物理治疗', '作业治疗'],
  },
  {
    match: /无人机|飞控|航测|低空|uav|航空/i,
    terms: ['无人机', '飞控', '航测', '低空经济', 'uav', '航空', '遥感', '巡检'],
    requiredAny: ['无人机', '飞控', '航测', 'uav', '航空'],
  },
  {
    match: /前端|web|react|vue|typescript|h5/i,
    terms: ['前端', 'web', 'react', 'vue', 'typescript', 'javascript', 'h5', '小程序'],
  },
  {
    match: /agent|ai|大模型|llm|智能体/i,
    terms: ['agent', 'ai', '大模型', 'llm', '智能体', 'langchain', 'langgraph', 'rag'],
  },
];

const EXTRA_TERMS = [
  '康复医疗', '康复治疗', '物理治疗', '作业治疗', '无人机', '低空经济',
  '前端开发', '测试开发', '后端开发', '全栈开发', '人工智能', '大模型',
  '智能体', '数据分析', '产品经理', '项目经理',
];

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeText(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeJob(record: any) {
  return {
    ...record,
    title: decodeBossPrivateText(record.title),
    company_name: decodeBossPrivateText(record.company_name),
    salary: decodeBossPrivateText(record.salary),
    location: decodeBossPrivateText(record.location),
    experience: decodeBossPrivateText(record.experience),
    education: decodeBossPrivateText(record.education),
    company_size: decodeBossPrivateText(record.company_size),
    company_industry: decodeBossPrivateText(record.company_industry),
    tags: decodeBossPrivateText(record.tags),
  };
}

function parseTags(tags: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(tags || '[]');
    return Array.isArray(parsed)
      ? parsed.map((item) => normalizeText(item)).filter(Boolean)
      : [];
  } catch {
    return normalizeText(tags).split(/[,\s，、/|]+/).filter(Boolean);
  }
}

function buildJobDocument(job: JobRow): string {
  const tags = parseTags(job.tags);
  const title = normalizeText(job.title);
  const company = normalizeText(job.company_name);
  const industry = normalizeText(job.company_industry);
  const document = [
    `职位：${title}`,
    title,
    `公司：${company}`,
    `行业：${industry}`,
    `地点：${normalizeText(job.location)}`,
    `薪资：${normalizeText(job.salary)}`,
    `经验：${normalizeText(job.experience)}`,
    `学历：${normalizeText(job.education)}`,
    `规模：${normalizeText(job.company_size)}`,
    `标签：${tags.join(' ')}`,
  ].filter((part) => part.replace(/^[^：]+：$/, '').trim());
  return document.join('\n');
}

function splitTextIntoChunks(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  if (normalized.length <= MAX_CHUNK_LENGTH) return [normalized];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const hardEnd = Math.min(normalized.length, start + MAX_CHUNK_LENGTH);
    const slice = normalized.slice(start, hardEnd);
    const boundary = Math.max(
      slice.lastIndexOf('。'),
      slice.lastIndexOf('；'),
      slice.lastIndexOf('\n'),
      slice.lastIndexOf('，'),
    );
    const end = boundary > 300 ? start + boundary + 1 : hardEnd;
    chunks.push(normalized.slice(start, end).trim());
    if (end >= normalized.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks.filter(Boolean);
}

function textHash(text: string) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function hashToken(token: string) {
  const hash = crypto.createHash('md5').update(token).digest();
  return hash.readUInt32BE(0);
}

function addToken(vector: number[], token: string, weight = 1) {
  if (!token) return;
  const index = hashToken(token) % EMBEDDING_DIMENSION;
  vector[index] += weight;
}

function extractTokens(text: string): string[] {
  const normalized = normalizeText(text).toLowerCase();
  const tokens: string[] = [];

  for (const item of normalized.match(/[a-z0-9+#.-]{2,}/g) || []) tokens.push(item);
  for (const item of EXTRA_TERMS) {
    if (normalized.includes(item.toLowerCase())) tokens.push(item.toLowerCase(), item.toLowerCase());
  }

  const cjkParts = normalized.match(/[\u4e00-\u9fff]{2,}/g) || [];
  for (const part of cjkParts) {
    for (let index = 0; index < part.length - 1; index += 1) {
      tokens.push(part.slice(index, index + 2));
    }
    for (let index = 0; index < part.length - 2; index += 1) {
      tokens.push(part.slice(index, index + 3));
    }
    if (part.length <= 6) tokens.push(part);
  }

  for (const group of DOMAIN_SYNONYMS) {
    if (!group.match.test(normalized)) continue;
    for (const term of group.terms) tokens.push(term.toLowerCase(), term.toLowerCase());
  }

  return tokens;
}

function embedText(text: string): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSION }, () => 0);
  for (const token of extractTokens(text)) {
    addToken(vector, token, token.length >= 4 ? 1.35 : 1);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!norm) return vector;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) {
    score += left[index] * right[index];
  }
  return score;
}

function getRequiredTerms(query: string): string[] {
  const normalized = normalizeText(query);
  const required = new Set<string>();
  for (const group of DOMAIN_SYNONYMS) {
    if (!group.requiredAny || !group.match.test(normalized)) continue;
    group.requiredAny.forEach((term) => required.add(term.toLowerCase()));
  }
  return [...required];
}

function containsRequiredTerm(text: string, requiredTerms: string[]) {
  if (!requiredTerms.length) return true;
  const normalized = normalizeText(text).toLowerCase();
  return requiredTerms.some((term) => normalized.includes(term));
}

function getMonthlySalaryFloorK(salary: string | null | undefined): number | null {
  const text = String(salary || '').replace(/\s+/g, '').toUpperCase();
  if (!text || /面议|见详情|薪资缺失/.test(text)) return null;

  const kMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:-|~|至)\s*\d+(?:\.\d+)?K/);
  if (kMatch) return Number(kMatch[1]);

  const dailyMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:-|~|至)\s*\d+(?:\.\d+)?元\/天/);
  if (dailyMatch) return Number(dailyMatch[1]) * 21.75 / 1000;

  const monthlyMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:-|~|至)\s*\d+(?:\.\d+)?元\/月/);
  if (monthlyMatch) return Number(monthlyMatch[1]) / 1000;

  const yearlyMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:-|~|至)\s*\d+(?:\.\d+)?万\/年/);
  if (yearlyMatch) return Number(yearlyMatch[1]) * 10 / 12;

  return null;
}

function explainMatch(query: string, content: string, score: number) {
  const queryTokens = [...new Set(extractTokens(query))]
    .filter((token) => token.length >= 2)
    .slice(0, 20);
  const normalized = normalizeText(content).toLowerCase();
  const matched = queryTokens
    .filter((token) => normalized.includes(token.toLowerCase()))
    .slice(0, 4);
  const percent = Math.round(score * 100);
  return matched.length
    ? `语义匹配 ${percent}%：${matched.join('、')}`
    : `语义匹配 ${percent}%`;
}

const upsertEmbedding = db.prepare(`
  INSERT INTO job_embeddings
    (id, job_id, chunk_index, content, embedding, text_hash, embedding_model, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(job_id, chunk_index) DO UPDATE SET
    content = excluded.content,
    embedding = excluded.embedding,
    text_hash = excluded.text_hash,
    embedding_model = excluded.embedding_model,
    updated_at = datetime('now')
`);

const deleteEmbeddingsForJob = db.prepare('DELETE FROM job_embeddings WHERE job_id = ?');

export function upsertRagIndexForJobIds(jobIds: string[]) {
  const ids = [...new Set(jobIds.filter(Boolean))];
  if (!ids.length) return { indexed: 0, chunks: 0 };
  const placeholders = ids.map(() => '?').join(',');
  const jobs = db.prepare(`
    SELECT * FROM jobs WHERE id IN (${placeholders})
  `).all(...ids) as JobRow[];

  let indexed = 0;
  let chunks = 0;
  const persist = db.transaction((rows: JobRow[]) => {
    for (const job of rows) {
      deleteEmbeddingsForJob.run(job.id);
      const document = buildJobDocument(job);
      const parts = splitTextIntoChunks(document);
      parts.forEach((content, index) => {
        upsertEmbedding.run(
          uuidv4(),
          job.id,
          index,
          content,
          JSON.stringify(embedText(content)),
          textHash(content),
          EMBEDDING_MODEL,
        );
        chunks += 1;
      });
      indexed += 1;
    }
  });
  persist(jobs);
  return { indexed, chunks };
}

export function deleteRagIndexForJobIds(jobIds: string[]) {
  const ids = [...new Set(jobIds.filter(Boolean))];
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const result = db.prepare(`DELETE FROM job_embeddings WHERE job_id IN (${placeholders})`).run(...ids);
  return result.changes;
}

export function indexMissingJobEmbeddings(limit = 300) {
  const rows = db.prepare(`
    SELECT j.id
    FROM jobs j
    LEFT JOIN job_embeddings e ON e.job_id = j.id
    WHERE e.job_id IS NULL
    ORDER BY j.crawled_at DESC
    LIMIT ?
  `).all(limit) as Array<{ id: string }>;
  return upsertRagIndexForJobIds(rows.map((row) => row.id));
}

export function reindexAllJobEmbeddings() {
  const rows = db.prepare('SELECT id FROM jobs ORDER BY crawled_at DESC').all() as Array<{ id: string }>;
  db.prepare('DELETE FROM job_embeddings').run();
  return upsertRagIndexForJobIds(rows.map((row) => row.id));
}

export function getRagIndexStats() {
  const totalJobs = (db.prepare('SELECT COUNT(*) AS count FROM jobs').get() as any).count || 0;
  const indexedJobs = (db.prepare('SELECT COUNT(DISTINCT job_id) AS count FROM job_embeddings').get() as any).count || 0;
  const chunks = (db.prepare('SELECT COUNT(*) AS count FROM job_embeddings').get() as any).count || 0;
  const model = (db.prepare('SELECT embedding_model FROM job_embeddings ORDER BY updated_at DESC LIMIT 1').get() as any)?.embedding_model || EMBEDDING_MODEL;
  return {
    totalJobs,
    indexedJobs,
    missingJobs: Math.max(0, totalJobs - indexedJobs),
    chunks,
    embeddingModel: model,
  };
}

export function semanticSearchJobs(input: RagSearchInput) {
  const query = normalizeText(input.query).slice(0, 160);
  if (!query) return [];

  indexMissingJobEmbeddings(300);

  const userId = input.userId || 'u001';
  const platform = normalizeText(input.platform);
  const city = normalizeText(input.city);
  const salaryStatus = input.salaryStatus || 'all';
  const companyStatus = input.companyStatus || 'all';
  const limit = clampInteger(input.limit, 10, 1, 50);
  const topK = clampInteger(input.topK, Math.max(limit * 4, 20), limit, 120);
  const minScore = Number.isFinite(Number(input.minScore)) ? Number(input.minScore) : 0.04;

  let where = 'WHERE j.status = ?';
  const params: unknown[] = ['active'];
  if (platform && platform !== 'all') {
    where += ' AND j.platform = ?';
    params.push(platform);
  }
  if (city && city !== 'all' && city !== '全国') {
    where += ' AND j.location LIKE ?';
    params.push(`%${city}%`);
  }
  if (salaryStatus === 'present') {
    where += " AND TRIM(COALESCE(j.salary, '')) NOT IN ('', '·', '薪资见详情')";
  } else if (salaryStatus === 'missing') {
    where += " AND TRIM(COALESCE(j.salary, '')) IN ('', '·', '薪资见详情')";
  }
  if (companyStatus === 'present') {
    where += " AND TRIM(COALESCE(j.company_name, '')) <> ''";
  } else if (companyStatus === 'missing') {
    where += " AND TRIM(COALESCE(j.company_name, '')) = ''";
  }
  if (input.onlyUnclicked) {
    where += ' AND NOT EXISTS (SELECT 1 FROM job_clicks c WHERE c.job_id = j.id AND c.user_id = ?)';
    params.push(userId);
  } else if (input.onlyClicked) {
    where += ' AND EXISTS (SELECT 1 FROM job_clicks c WHERE c.job_id = j.id AND c.user_id = ?)';
    params.push(userId);
  }

  const candidates = db.prepare(`
    SELECT e.chunk_index, e.content, e.embedding, j.*,
      EXISTS(SELECT 1 FROM job_clicks c WHERE c.job_id = j.id AND c.user_id = ?) AS clicked
    FROM job_embeddings e
    JOIN jobs j ON j.id = e.job_id
    ${where}
    ORDER BY j.crawled_at DESC
    LIMIT 2000
  `).all(userId, ...params) as EmbeddingCandidate[];

  const queryEmbedding = embedText(query);
  const requiredTerms = getRequiredTerms(query);
  const byJob = new Map<string, { score: number; row: EmbeddingCandidate; content: string }>();

  for (const candidate of candidates) {
    if (!containsRequiredTerm(candidate.content, requiredTerms)) continue;
    let embedding: number[];
    try {
      embedding = JSON.parse(candidate.embedding);
    } catch {
      continue;
    }
    const score = cosineSimilarity(queryEmbedding, embedding);
    if (score < minScore) continue;
    const existing = byJob.get(candidate.id);
    if (!existing || score > existing.score) {
      byJob.set(candidate.id, { score, row: candidate, content: candidate.content });
    }
  }

  const minSalaryK = Number(input.minSalaryK || 0);
  return [...byJob.values()]
    .sort((left, right) => right.score - left.score)
    .slice(0, topK)
    .map((item) => {
      const decoded = decodeJob(item.row);
      return {
        ...decoded,
        rag_score: Number(item.score.toFixed(4)),
        rag_reason: explainMatch(query, item.content, item.score),
      };
    })
    .filter((job) => {
      if (minSalaryK <= 0) return true;
      const floor = getMonthlySalaryFloorK(job.salary);
      return floor !== null && floor >= minSalaryK;
    })
    .slice(0, limit);
}
