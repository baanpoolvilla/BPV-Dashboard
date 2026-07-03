import { Router, Response } from 'express';
import { authenticate, requireCEO, AuthRequest } from '../middleware/auth';
import prisma from '../lib/prisma';

const router = Router();
router.use(authenticate);
router.use(requireCEO);

function getPeriodRange(period: string) {
  const now = new Date();
  const start = new Date(now);
  if (period === 'week') {
    const day = now.getDay();
    start.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  } else if (period === 'month') {
    start.setDate(1);
  }
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// Only non-CEO users are counted as "employees" in the dashboard
const EMPLOYEE_ROLE_FILTER = { role: { not: 'CEO' } };

// GET /api/dashboard/summary
router.get('/summary', async (req: AuthRequest, res: Response) => {
  const period = (req.query.period as string) || 'today';
  const department = (req.query.department as string) || 'all';
  const { start, end } = getPeriodRange(period);

  const userWhere = { ...EMPLOYEE_ROLE_FILTER, ...(department !== 'all' ? { department } : {}) };
  const [totalEmployees, attendances, tasks] = await Promise.all([
    prisma.user.count({ where: userWhere }),
    prisma.attendance.findMany({
      where: { date: { gte: start, lte: end }, user: userWhere },
      select: { status: true },
    }),
    prisma.task.findMany({
      where: { project: { members: { some: { user: userWhere } } } },
      select: { status: true },
    }),
  ]);

  const presentCount = attendances.filter((a: { status: string }) => a.status === 'present' || a.status === 'late').length;
  const doneCount = tasks.filter((t: { status: string }) => t.status === 'done').length;
  const overdueCount = tasks.filter((t: { status: string }) => t.status === 'overdue').length;

  res.json({
    totalEmployees,
    attendanceRate: attendances.length ? Math.round((presentCount / attendances.length) * 100) : 0,
    onTimeTaskRate: tasks.length ? Math.round((doneCount / tasks.length) * 100) : 0,
    overdueCount,
  });
});

// GET /api/dashboard/department-performance
router.get('/department-performance', async (_req: AuthRequest, res: Response) => {
  const users = await prisma.user.findMany({
    where: EMPLOYEE_ROLE_FILTER,
    select: { department: true, id: true },
  });

  const deptMap = new Map<string, string[]>();
  for (const u of users) {
    const arr = deptMap.get(u.department) ?? [];
    arr.push(u.id);
    deptMap.set(u.department, arr);
  }

  const result = await Promise.all(
    Array.from(deptMap.entries()).map(async ([dept, ids]) => {
      const tasks = await prisma.task.count({ where: { assigneeId: { in: ids } } });
      const done = await prisma.task.count({ where: { assigneeId: { in: ids }, status: 'done' } });
      const score = tasks > 0 ? Math.round((done / tasks) * 100) : 0;
      return { department: dept, score };
    })
  );

  res.json(result.sort((a, b) => b.score - a.score));
});

// GET /api/dashboard/attendance-breakdown
router.get('/attendance-breakdown', async (req: AuthRequest, res: Response) => {
  const period = (req.query.period as string) || 'today';
  const { start, end } = getPeriodRange(period);

  const attendances = await prisma.attendance.findMany({
    where: { date: { gte: start, lte: end }, user: EMPLOYEE_ROLE_FILTER },
    select: { status: true },
  });

  const breakdown = { present: 0, late: 0, absent: 0, leave: 0 };
  for (const a of attendances) {
    if (a.status in breakdown) breakdown[a.status as keyof typeof breakdown]++;
  }
  res.json(breakdown);
});

// GET /api/dashboard/employees
router.get('/employees', async (req: AuthRequest, res: Response) => {
  const department = (req.query.department as string) || 'all';
  const status = req.query.status as string | undefined;
  const page = parseInt((req.query.page as string) || '1', 10);
  const limit = parseInt((req.query.limit as string) || '20', 10);
  const skip = (page - 1) * limit;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);

  const userWhere = { ...EMPLOYEE_ROLE_FILTER, ...(department !== 'all' ? { department } : {}) };

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where: userWhere,
      skip,
      take: limit,
      include: {
        attendances: {
          where: { date: { gte: today, lte: todayEnd } },
          select: { status: true },
          take: 1,
        },
        projectMembers: {
          include: {
            project: {
              include: { tasks: { select: { status: true } } },
            },
          },
        },
      },
    }),
    prisma.user.count({ where: userWhere }),
  ]);

  const employees = users
    .map(u => {
      const todayStatus = u.attendances[0]?.status ?? 'absent';
      const allTasks = u.projectMembers.flatMap(pm => pm.project.tasks);
      const remainingTasks = allTasks.filter((t: { status: string }) => t.status !== 'done').length;
      const doneTasks = allTasks.filter((t: { status: string }) => t.status === 'done').length;
      const performanceScore = allTasks.length > 0 ? Math.round((doneTasks / allTasks.length) * 100) : 0;
      return { id: u.id, name: u.name, department: u.department, avatarUrl: u.avatarUrl, position: u.position, todayStatus, remainingTasks, performanceScore };
    })
    .filter(e => !status || e.todayStatus === status);

  res.json({ data: employees, total, page, limit, totalPages: Math.ceil(total / limit) });
});

export default router;
