import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import session from 'cookie-session';
import authRouter from './routes/auth.js';
import apiRouter from './routes/api.js';

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));

app.set('trust proxy', 1);
app.use(session({
  name: 'sesh',
  secret: process.env.SESSION_SECRET || 'uh-not-secret',
  maxAge: 24 * 60 * 60 * 1000,
  sameSite: 'lax'
}));

// quick ping
app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/api', apiRouter);

const port = process.env.PORT || 8088;
app.listen(port, () => {
  console.log('server listening on', port);
});
