import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRouter from './routes/auth';
import dashboardRouter from './routes/dashboard';
import usersRouter from './routes/users';
import worksheetsRouter from './routes/worksheets';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '10mb' }));

app.use('/api/auth', authRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/users', usersRouter);
// /worksheets/notes/:noteId must come before /worksheets/:id - handled inside router by order
app.use('/api/worksheets', worksheetsRouter);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));
