# BPV Employee Tracking Dashboard

ระบบแดชบอร์ดสำหรับผู้บริหาร/หัวหน้าทีม — React 18 + Vite + Express + Prisma + PostgreSQL

## Prerequisites

- Node.js 20+
- PostgreSQL 15+ (running on localhost:5432)
- MinIO หรือ AWS S3 (สำหรับ image upload, optional)

## Setup

### 1. Database

```bash
# สร้าง database ใน PostgreSQL
createdb bpv_dashboard

# หรือใช้ psql
psql -U postgres -c "CREATE DATABASE bpv_dashboard;"
```

### 2. Backend

```bash
cd backend

# แก้ .env ตั้งค่า DATABASE_URL ให้ถูกต้อง
# DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/bpv_dashboard"

npm install

# Run migrations
npx prisma migrate dev --name init

# Seed data (20 พนักงาน, 8 โปรเจกต์)
npm run db:seed

# Start dev server
npm run dev
# → http://localhost:3001
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

## Login

- Admin: `admin@bpv.com` / `password123`
- Employee: `emp1@bpv.com` / `password123`

## Features

- Dashboard ภาพรวม: metric cards, bar chart ผลงานตามแผนก, donut chart การเข้างาน, ตารางพนักงาน
- Employee Profile: heatmap การเข้างาน, รายการโปรเจกต์แบบ card grid
- Worksheet Canvas: วาดเส้น, เพิ่ม text/rect/image, zoom/pan, autosave, บันทึกประวัติการประชุม
