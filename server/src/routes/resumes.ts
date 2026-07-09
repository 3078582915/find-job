import { Router } from 'express';
import db from '../database';
import { v4 as uuidv4 } from '../utils';

const router = Router();
const DEMO_USER_ID = 'u001';

// 获取简历列表
router.get('/resumes', (_req, res) => {
  const resumes = db.prepare(
    'SELECT * FROM resumes WHERE user_id = ? ORDER BY created_at DESC'
  ).all(DEMO_USER_ID);
  res.json(resumes);
});

// 创建简历
router.post('/resumes', (req, res) => {
  const { name, content, isDefault } = req.body;
  if (!name) return res.status(400).json({ error: '简历名称不能为空' });

  const id = uuidv4();

  if (isDefault) {
    db.prepare('UPDATE resumes SET is_default = 0 WHERE user_id = ?').run(DEMO_USER_ID);
  }

  db.prepare(
    'INSERT INTO resumes (id, user_id, name, content, is_default) VALUES (?, ?, ?, ?, ?)'
  ).run(id, DEMO_USER_ID, name, JSON.stringify(content || {}), isDefault ? 1 : 0);

  const resume = db.prepare('SELECT * FROM resumes WHERE id = ?').get(id);
  res.status(201).json(resume);
});

// 更新简历
router.put('/resumes/:id', (req, res) => {
  const { id } = req.params;
  const { name, content, isDefault } = req.body;

  const existing = db.prepare('SELECT * FROM resumes WHERE id = ? AND user_id = ?').get(id, DEMO_USER_ID);
  if (!existing) return res.status(404).json({ error: '简历不存在' });

  if (isDefault) {
    db.prepare('UPDATE resumes SET is_default = 0 WHERE user_id = ?').run(DEMO_USER_ID);
  }

  db.prepare(
    'UPDATE resumes SET name = COALESCE(?, name), content = COALESCE(?, content), is_default = COALESCE(?, is_default) WHERE id = ?'
  ).run(name, content ? JSON.stringify(content) : null, isDefault !== undefined ? (isDefault ? 1 : 0) : null, id);

  const resume = db.prepare('SELECT * FROM resumes WHERE id = ?').get(id);
  res.json(resume);
});

// 删除简历
router.delete('/resumes/:id', (req, res) => {
  const { id } = req.params;
  const existing = db.prepare('SELECT * FROM resumes WHERE id = ? AND user_id = ?').get(id, DEMO_USER_ID);
  if (!existing) return res.status(404).json({ error: '简历不存在' });

  db.prepare('DELETE FROM resumes WHERE id = ?').run(id);
  res.json({ success: true });
});

export default router;
