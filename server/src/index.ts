import express from 'express';
import cors from 'cors';
import db, { seed } from './database';
import statisticsRouter from './routes/statistics';
import resumesRouter from './routes/resumes';
import platformsRouter from './routes/platforms';
import deliveryRouter from './routes/delivery';
import jobsRouter from './routes/jobs';
import agentRouter from './routes/agent';

const app = express();
const PORT = 3001;
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
}));
app.use(express.json());

seed();

app.use('/api', statisticsRouter);
app.use('/api', resumesRouter);
app.use('/api', platformsRouter);
app.use('/api', deliveryRouter);
app.use('/api', jobsRouter);
app.use('/api', agentRouter);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`🚀 后端服务已启动: http://localhost:${PORT}`);
  console.log(`📊 API 地址: http://localhost:${PORT}/api`);
});

export default app;
