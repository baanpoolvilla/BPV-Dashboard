import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const departments = ['Engineering', 'Design', 'Marketing', 'Product', 'Finance'];
const positions = {
  Engineering: ['Senior Engineer', 'Junior Engineer', 'DevOps Engineer', 'QA Engineer'],
  Design: ['UI/UX Designer', 'Graphic Designer', 'Motion Designer'],
  Marketing: ['Marketing Manager', 'Content Creator', 'SEO Specialist'],
  Product: ['Product Manager', 'Business Analyst', 'Scrum Master'],
  Finance: ['Financial Analyst', 'Accountant', 'Controller'],
};

const employeeNames = [
  'สมชาย วงศ์สุวรรณ', 'สมหญิง พันธ์ดี', 'วิชัย อินทรสิทธิ์', 'นภา ศรีสง่า',
  'อนุชิต เพชรรัตน์', 'กานดา ทองคำ', 'ธนพล สุขสวัสดิ์', 'รัตนา บุญมา',
  'ประสิทธิ์ แก้วมณี', 'สุภาพ จันทร์เพ็ญ', 'วันดี ลาภมา', 'มนัส พลอยงาม',
  'อัญชลี สว่างใจ', 'ชาตรี วิลาวัลย์', 'พรทิพย์ ศรีธรรม', 'นิรันดร์ เจริญสุข',
  'กัลยา ฤทธิ์ไกร', 'สิทธิพร นิลสวัสดิ์', 'อาทิตย์ ดาวเรือง', 'ปิยะดา มีชัย',
];

const projectNames = [
  'BPV Core Platform v2', 'Mobile App Redesign', 'Data Analytics Dashboard',
  'Customer Portal', 'Payment Gateway Integration', 'HR Automation System',
  'API Gateway Migration', 'Brand Identity Refresh',
];

const taskTitles = [
  'Design system components', 'API integration', 'Unit testing', 'Code review',
  'Database optimization', 'UI/UX wireframes', 'Performance tuning', 'Documentation',
  'Security audit', 'Deployment pipeline', 'Load testing', 'Feature implementation',
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

async function main() {
  console.log('Seeding database...');

  await prisma.meetingNote.deleteMany();
  await prisma.worksheet.deleteMany();
  await prisma.task.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.user.deleteMany();

  const hashedPassword = await bcrypt.hash('password123', 10);

  // Admin user
  const admin = await prisma.user.create({
    data: {
      name: 'Admin User',
      email: 'admin@bpv.com',
      password: hashedPassword,
      department: 'Engineering',
      role: 'admin',
      position: 'CTO',
      avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=admin`,
    },
  });

  // Employees
  const employees = await Promise.all(
    employeeNames.map((name, i) => {
      const dept = departments[i % departments.length];
      return prisma.user.create({
        data: {
          name,
          email: `emp${i + 1}@bpv.com`,
          password: hashedPassword,
          department: dept,
          role: 'employee',
          position: randomItem(positions[dept as keyof typeof positions]),
          avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
        },
      });
    })
  );

  // Attendance for last 30 days
  const statuses = ['present', 'present', 'present', 'present', 'late', 'absent', 'leave'];
  for (const emp of employees) {
    for (let day = 0; day < 30; day++) {
      const date = daysAgo(day);
      const dow = date.getDay();
      if (dow === 0 || dow === 6) continue; // skip weekends
      const status = randomItem(statuses);
      let checkIn: Date | null = null;
      let checkOut: Date | null = null;
      if (status === 'present') {
        checkIn = new Date(date); checkIn.setHours(8, Math.floor(Math.random() * 30), 0);
        checkOut = new Date(date); checkOut.setHours(17, Math.floor(Math.random() * 60), 0);
      } else if (status === 'late') {
        checkIn = new Date(date); checkIn.setHours(9, 15 + Math.floor(Math.random() * 45), 0);
        checkOut = new Date(date); checkOut.setHours(18, Math.floor(Math.random() * 60), 0);
      }
      await prisma.attendance.create({ data: { userId: emp.id, date, status, checkIn, checkOut } });
    }
  }

  // Projects
  const projects = await Promise.all(
    projectNames.map((name, i) =>
      prisma.project.create({
        data: {
          name,
          description: `${name} — โปรเจกต์หลักของบริษัท`,
          status: i < 6 ? 'active' : i === 6 ? 'completed' : 'on_hold',
          startDate: daysAgo(60 + i * 5),
          dueDate: new Date(Date.now() + (30 + i * 10) * 86400000),
        },
      })
    )
  );

  // Project members (3-5 employees per project)
  for (const project of projects) {
    const memberCount = 3 + Math.floor(Math.random() * 3);
    const shuffled = [...employees].sort(() => Math.random() - 0.5).slice(0, memberCount);
    for (let i = 0; i < shuffled.length; i++) {
      const emp = shuffled[i];
      await prisma.projectMember.create({
        data: {
          projectId: project.id,
          userId: emp.id,
          roleInProject: i === 0 ? 'owner' : 'contributor',
        },
      });

      // Tasks per member per project
      const taskCount = 3 + Math.floor(Math.random() * 4);
      const taskStatuses = ['todo', 'in_progress', 'done', 'done', 'done', 'overdue'];
      for (let t = 0; t < taskCount; t++) {
        await prisma.task.create({
          data: {
            projectId: project.id,
            assigneeId: emp.id,
            title: randomItem(taskTitles),
            status: randomItem(taskStatuses),
            dueDate: new Date(Date.now() + (Math.random() * 60 - 10) * 86400000),
          },
        });
      }

      // Worksheet per member per project
      const ws = await prisma.worksheet.create({
        data: {
          projectId: project.id,
          userId: emp.id,
          canvasData: {
            version: 1,
            elements: [
              { id: 'el1', type: 'text', x: 100, y: 80, text: `สรุปงาน: ${project.name}`, fontSize: 20, color: '#e2e8f0' },
              { id: 'el2', type: 'rect', x: 80, y: 60, width: 400, height: 50, fill: 'transparent', stroke: '#378ADD', strokeWidth: 1 },
            ],
          },
        },
      });

      // 1-2 meeting notes per worksheet
      const noteCount = 1 + Math.floor(Math.random() * 2);
      for (let n = 0; n < noteCount; n++) {
        await prisma.meetingNote.create({
          data: {
            worksheetId: ws.id,
            userId: emp.id,
            meetingDate: daysAgo(n * 7 + 1),
            canvasSnapshot: {
              version: 1,
              elements: [
                { id: 'snap1', type: 'text', x: 100, y: 80, text: `บันทึกประชุม ${n + 1}`, fontSize: 18, color: '#94a3b8' },
              ],
            },
          },
        });
      }
    }
  }

  console.log(`Seeded: 1 admin + ${employees.length} employees, ${projects.length} projects`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
