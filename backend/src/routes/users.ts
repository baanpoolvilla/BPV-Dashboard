import { Router, Response, NextFunction } from 'express';
import { authenticate, requireSelfOrCEO, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';

const router = Router();
router.use(authenticate);

// Guard: non-CEO may only access their own data
function selfOrCEO(req: AuthRequest, res: Response, next: NextFunction): void {
  return requireSelfOrCEO(req, res, next);
}

// GET /api/users/:userId
router.get('/:userId', selfOrCEO, async (req: AuthRequest, res: Response) => {
  const userId = req.params['userId'] as string;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, avatarUrl: true, department: true, position: true, role: true },
  });
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json(user);
});

// GET /api/users/:userId/projects
router.get('/:userId/projects', selfOrCEO, async (req: AuthRequest, res: Response) => {
  const userId = req.params['userId'] as string;
  const memberships = await prisma.projectMember.findMany({
    where: { userId },
    include: {
      project: {
        include: {
          tasks: { select: { status: true } },
          worksheets: {
            where: { userId },
            select: { id: true, thumbnailUrl: true, updatedAt: true },
            take: 1,
          },
        },
      },
    },
  });

  const projects = memberships.map(m => {
    const ws = m.project.worksheets[0];
    return {
      id: m.project.id,
      name: m.project.name,
      status: m.project.status,
      taskCount: m.project.tasks.length,
      worksheetId: ws?.id ?? null,
      thumbnailUrl: ws?.thumbnailUrl ?? null,
      lastUpdated: ws?.updatedAt ?? m.project.createdAt,
    };
  });

  res.json(projects);
});

// POST /api/users/:userId/projects  (create project + member + worksheet)
router.post('/:userId/projects', selfOrCEO, async (req: AuthRequest, res: Response) => {
  const userId = req.params['userId'] as string;
  const { name, description } = req.body as { name?: string; description?: string };
  if (!name?.trim()) { res.status(400).json({ error: 'name is required' }); return; }

  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      description: description?.trim() ?? null,
      status: 'active',
      startDate: new Date(),
      members: {
        create: { userId, roleInProject: 'owner' },
      },
      worksheets: {
        create: {
          userId,
          canvasData: { version: 1, elements: [] },
        },
      },
    },
    select: { id: true, name: true, status: true },
  });

  res.status(201).json(project);
});

// GET /api/users/:userId/attendance-history
router.get('/:userId/attendance-history', selfOrCEO, async (req: AuthRequest, res: Response) => {
  const userId = req.params['userId'] as string;
  const from = req.query.from ? new Date(req.query.from as string) : undefined;
  const to = req.query.to ? new Date(req.query.to as string) : undefined;

  const attendances = await prisma.attendance.findMany({
    where: {
      userId,
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    },
    orderBy: { date: 'desc' },
    select: { date: true, status: true, checkIn: true, checkOut: true },
  });

  res.json(attendances);
});

export default router;
