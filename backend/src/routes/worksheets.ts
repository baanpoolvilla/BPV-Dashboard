import { Router, Response } from 'express';
import multer from 'multer';
import { authenticate, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { Prisma } from '@prisma/client';
type InputJsonValue = Prisma.InputJsonValue;

const router = Router();
router.use(authenticate);

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY!,
    secretAccessKey: process.env.S3_SECRET_KEY!,
  },
  forcePathStyle: true,
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET /api/worksheets/:worksheetId
router.get('/:worksheetId', async (req: AuthRequest, res: Response) => {
  const worksheetId = req.params['worksheetId'] as string;
  const ws = await prisma.worksheet.findUnique({
    where: { id: worksheetId },
    select: { id: true, projectId: true, userId: true, canvasData: true, updatedAt: true },
  });
  if (!ws) { res.status(404).json({ error: 'Worksheet not found' }); return; }
  res.json(ws);
});

// PUT /api/worksheets/:worksheetId
router.put('/:worksheetId', async (req: AuthRequest, res: Response) => {
  const worksheetId = req.params['worksheetId'] as string;
  const { canvasData } = req.body as { canvasData: InputJsonValue };
  const ws = await prisma.worksheet.update({
    where: { id: worksheetId },
    data: { canvasData },
    select: { id: true, updatedAt: true },
  });
  res.json(ws);
});

// POST /api/worksheets/:worksheetId/upload-image
router.post('/:worksheetId/upload-image', upload.single('file'), async (req: AuthRequest, res: Response) => {
  const worksheetId = req.params['worksheetId'] as string;
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }

  const key = `worksheets/${worksheetId}/${uuidv4()}-${req.file.originalname}`;
  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: key,
    Body: req.file.buffer,
    ContentType: req.file.mimetype,
  }));

  const url = `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${key}`;
  res.json({ url });
});

// POST /api/worksheets/:worksheetId/meeting-notes
router.post('/:worksheetId/meeting-notes', async (req: AuthRequest, res: Response) => {
  const worksheetId = req.params['worksheetId'] as string;
  const { meetingDate } = req.body as { meetingDate: string };
  const ws = await prisma.worksheet.findUnique({
    where: { id: worksheetId },
    select: { canvasData: true },
  });
  if (!ws) { res.status(404).json({ error: 'Worksheet not found' }); return; }

  const note = await prisma.meetingNote.create({
    data: {
      worksheetId,
      userId: req.userId!,
      meetingDate: new Date(meetingDate),
      canvasSnapshot: ws.canvasData as InputJsonValue,
    },
    select: { id: true, meetingDate: true, createdAt: true },
  });
  res.status(201).json(note);
});

// GET /api/worksheets/:worksheetId/meeting-notes
router.get('/:worksheetId/meeting-notes', async (req: AuthRequest, res: Response) => {
  const worksheetId = req.params['worksheetId'] as string;
  const notes = await prisma.meetingNote.findMany({
    where: { worksheetId },
    orderBy: { meetingDate: 'desc' },
    select: {
      id: true, meetingDate: true, createdAt: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
  });
  res.json(notes);
});

// GET /api/worksheets/notes/:noteId  (must register BEFORE /:worksheetId)
router.get('/notes/:noteId', async (req: AuthRequest, res: Response) => {
  const noteId = req.params['noteId'] as string;
  const note = await prisma.meetingNote.findUnique({
    where: { id: noteId },
    select: {
      id: true, meetingDate: true, canvasSnapshot: true,
      user: { select: { id: true, name: true, avatarUrl: true } },
    },
  });
  if (!note) { res.status(404).json({ error: 'Note not found' }); return; }
  res.json(note);
});

export default router;
