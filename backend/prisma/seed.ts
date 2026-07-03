import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const USERS = [
  { name: 'Thunchanok',  email: 'thunchanok@baanpoolvilla.com',  role: 'CEO',      department: 'Management', position: 'CEO' },
  { name: 'Thanonchai',  email: 'thanonchai@baanpoolvilla.com',  role: 'CEO',      department: 'Management', position: 'CEO' },
  { name: 'Pacharapol',  email: 'pacharapol@baanpoolvilla.com',  role: 'employee', department: 'IT',         position: 'IT Staff' },
  { name: 'Katawut',     email: 'katawut@baanpoolcilla.com',     role: 'employee', department: 'IT',         position: 'IT Staff' },
  { name: 'Chayanun',    email: 'chayanun@baanpoolvilla.com',    role: 'employee', department: 'Account',    position: 'Accountant' },
  { name: 'Kanitha',     email: 'kanitha@baanpoolvilla.com',     role: 'employee', department: 'Account',    position: 'Accountant' },
  { name: 'Kanthita',    email: 'kanthita@baanpoolvilla.com',    role: 'employee', department: 'Admin',      position: 'Administrator' },
  { name: 'Kenika',      email: 'kenika@baanpoolvilla.com',      role: 'employee', department: 'Marketing',  position: 'Marketing Staff' },
  { name: 'Somporn',     email: 'somporn@baanpoolvilla.com',     role: 'employee', department: 'Marketing',  position: 'Marketing Staff' },
  { name: 'Soravee',     email: 'soravee@baanpoolvilla.com',     role: 'employee', department: 'Admin',      position: 'Administrator' },
  { name: 'Sujita',      email: 'sujita@baanpoolvilla.com',      role: 'employee', department: 'Housekeeper', position: 'Housekeeper' },
  { name: 'Waratta',     email: 'waratta@baanpoolvilla.com',     role: 'employee', department: 'Housekeeper', position: 'Housekeeper' },
];

async function main() {
  console.log('Clearing all data...');
  await prisma.meetingNote.deleteMany();
  await prisma.worksheet.deleteMany();
  await prisma.task.deleteMany();
  await prisma.projectMember.deleteMany();
  await prisma.project.deleteMany();
  await prisma.attendance.deleteMany();
  await prisma.user.deleteMany();

  const hash = await bcrypt.hash('00000000', 10);

  await Promise.all(
    USERS.map(u =>
      prisma.user.create({
        data: {
          name: u.name,
          email: u.email,
          password: hash,
          department: u.department,
          role: u.role,
          position: u.position,
        },
      })
    )
  );

  console.log(`Seeded ${USERS.length} users (2 CEO, 10 employees). Password for all: 00000000`);
  USERS.forEach(u => console.log(`  ${u.role.padEnd(8)} ${u.email}`));
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
