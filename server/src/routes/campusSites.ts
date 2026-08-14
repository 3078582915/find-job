import { Router } from 'express';
import {
  CampusSiteDuplicateError,
  CampusSiteInputError,
  CampusSiteTrustError,
  createCampusSite,
  deleteCampusSite,
  discoverCampusSites,
  getCampusSiteById,
  getCampusSiteStats,
  getVerifiedRegistryCandidate,
  listCampusSites,
  updateCampusSite,
  updateCampusSiteApplicationStatus,
} from '../services/campusSiteService';

const router = Router();

function text(value: unknown, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function errorResponse(res: any, error: unknown) {
  if (error instanceof CampusSiteDuplicateError) return res.status(409).json({ error: error.message });
  if (error instanceof CampusSiteInputError || error instanceof CampusSiteTrustError) {
    return res.status(400).json({ error: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  return res.status(500).json({ error: `校招官网处理失败：${message}` });
}

router.get('/campus-sites', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = Math.max(1, Math.min(100, Number(req.query.size) || 20));
  const result = listCampusSites({
    keyword: text(req.query.keyword, 100),
    sourceType: text(req.query.sourceType, 20) as any,
    verificationStatus: text(req.query.verificationStatus, 20) as any,
    applicationStatus: text(req.query.applicationStatus, 20) as any,
    status: text(req.query.status, 20) as any,
    limit: size,
    offset: (page - 1) * size,
  });
  res.json({ total: result.total, page, size, records: result.records, stats: getCampusSiteStats() });
});

router.get('/campus-sites/stats', (_req, res) => {
  res.json(getCampusSiteStats());
});

router.post('/campus-sites/discover', async (req, res) => {
  const companyName = text(req.body.companyName, 100);
  if (!companyName) return res.status(400).json({ error: '请提供公司名称' });
  try {
    const candidates = await discoverCampusSites(companyName, text(req.body.sourceQuery, 240) || companyName);
    res.json({ companyName, candidates, verified: candidates.length > 0 });
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.post('/campus-sites', (req, res) => {
  try {
    const sourceType = req.body.sourceType === 'agent' ? 'agent' : 'manual';
    let verificationEvidence = Array.isArray(req.body.verificationEvidence) ? req.body.verificationEvidence : undefined;
    let verificationMethod = req.body.verificationMethod;
    let verificationStatus = req.body.verificationStatus;
    if (sourceType === 'agent') {
      const verified = getVerifiedRegistryCandidate(text(req.body.companyName, 100), text(req.body.officialUrl, 2048));
      if (!verified) throw new CampusSiteTrustError('Agent 发现的链接未通过官方验证，不能保存');
      verificationEvidence = verified.evidenceUrls;
      verificationMethod = verified.verificationMethod;
      verificationStatus = verified.verificationStatus;
    }
    const record = createCampusSite({
      companyName: req.body.companyName,
      siteName: req.body.siteName,
      officialUrl: req.body.officialUrl,
      sourceType,
      sourceQuery: req.body.sourceQuery,
      confidence: req.body.confidence,
      verificationStatus,
      verificationMethod,
      verificationEvidence,
      siteKind: req.body.siteKind,
      tags: req.body.tags,
      notes: req.body.notes,
    });
    res.status(201).json(record);
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.put('/campus-sites/:id', (req, res) => {
  try {
    const record = updateCampusSite(req.params.id, {
      companyName: req.body.companyName,
      siteName: req.body.siteName,
      officialUrl: req.body.officialUrl,
      siteKind: req.body.siteKind,
      tags: req.body.tags,
      notes: req.body.notes,
      status: req.body.status,
    });
    if (!record) return res.status(404).json({ error: '校招官网不存在' });
    res.json(record);
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.patch('/campus-sites/:id/application-status', (req, res) => {
  try {
    const record = updateCampusSiteApplicationStatus(req.params.id, text(req.body.applicationStatus, 30) as any);
    if (!record) return res.status(404).json({ error: '校招官网不存在' });
    res.json(record);
  } catch (error) {
    return errorResponse(res, error);
  }
});

router.delete('/campus-sites/:id', (req, res) => {
  const deleted = deleteCampusSite(text(req.params.id, 80));
  if (!deleted) return res.status(404).json({ error: '校招官网不存在或已删除' });
  res.json({ success: true, deleted });
});

router.get('/campus-sites/:id', (req, res) => {
  const record = getCampusSiteById(text(req.params.id, 80));
  if (!record) return res.status(404).json({ error: '校招官网不存在' });
  res.json(record);
});

export default router;
