# Employee Tracking Dashboard — Technical Specification

## 1. ภาพรวมโครงการ (Overview)

ระบบแดชบอร์ดสำหรับผู้บริหาร/หัวหน้าทีม ใช้ติดตามภาพรวมการทำงานของพนักงานทั้งบริษัท (งาน, การเข้าออกงาน, ผลงาน) และสามารถคลิกเข้าไปดูรายละเอียดรายบุคคล ซึ่งแยกเป็นโปรเจกต์ละ 1 worksheet แบบ canvas อิสระ (วาดเส้น พิมพ์ข้อความ วางรูปภาพ) เพื่อใช้บันทึกข้อมูลประกอบการประชุม และเก็บเป็นประวัติการประชุมตลอดไป

**Design priority:** ความเร็ว (perceived performance) + ธีม modern tech (dark-friendly, flat, minimal)

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, React Router, TypeScript |
| State management | Zustand หรือ React Query (server state) |
| Canvas/Worksheet | Konva.js (react-konva) — รองรับ drag, draw, text, image layers |
| Backend | Node.js + Express, TypeScript |
| Database | PostgreSQL 15+ |
| ORM | Prisma |
| File storage | S3-compatible object storage (AWS S3 หรือ MinIO สำหรับ self-host) — เก็บเฉพาะ URL ใน DB |
| Auth | JWT (access + refresh token) |
| Realtime (optional, phase 2) | WebSocket (Socket.io) สำหรับ auto-save indicator |

**เหตุผลเรื่อง storage:** เก็บไฟล์รูปจริงใน object storage แล้วอ้างอิงด้วย URL ใน JSONB ของ canvas data — เบากว่า base64 มาก ทั้งด้าน DB size, query speed, backup, และ load time ของ canvas

---

## 3. Database Schema (Prisma-style)

```prisma
model User {
  id            String   @id @default(uuid())
  name          String
  email         String   @unique
  avatarUrl     String?
  department    String
  role          String   // "admin" | "manager" | "employee"
  position      String?  // ตำแหน่งงาน
  createdAt     DateTime @default(now())

  attendances   Attendance[]
  projectMembers ProjectMember[]
  meetingNotes  MeetingNote[]
}

model Attendance {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  date      DateTime
  checkIn   DateTime?
  checkOut  DateTime?
  status    String   // "present" | "late" | "absent" | "leave"
}

model Project {
  id          String   @id @default(uuid())
  name        String
  description String?
  status      String   // "active" | "completed" | "on_hold"
  startDate   DateTime
  dueDate     DateTime?
  createdAt   DateTime @default(now())

  members     ProjectMember[]
  tasks       Task[]
  worksheets  Worksheet[]
}

model ProjectMember {
  id        String   @id @default(uuid())
  projectId String
  project   Project  @relation(fields: [projectId], references: [id])
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  roleInProject String? // "owner" | "contributor"
}

model Task {
  id          String   @id @default(uuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id])
  assigneeId  String?
  title       String
  status      String   // "todo" | "in_progress" | "done" | "overdue"
  dueDate     DateTime?
  completedAt DateTime?
}

// 1 โปรเจกต์ = 1 worksheet ต่อ user (กรณีหลาย user อยู่โปรเจกต์เดียวกัน อาจแยก worksheet ต่อคน หรือใช้ worksheet ร่วม — ดู section 5.3)
model Worksheet {
  id          String   @id @default(uuid())
  projectId   String
  project     Project  @relation(fields: [projectId], references: [id])
  userId      String   // owner ของ worksheet นี้ (มุมมองรายบุคคล)
  canvasData  Json     // โครงสร้าง JSON ของ shapes/text/images ทั้งหมด (ดู section 5.2)
  thumbnailUrl String? // preview เล็กๆ สำหรับโชว์ใน list
  updatedAt   DateTime @updatedAt
  createdAt   DateTime @default(now())

  meetingNotes MeetingNote[]
}

// History การประชุม — เก็บแบบ snapshot ทุกครั้งที่บันทึก เพื่อย้อนดูได้
model MeetingNote {
  id          String   @id @default(uuid())
  worksheetId String
  worksheet   Worksheet @relation(fields: [worksheetId], references: [id])
  userId      String   // ผู้บันทึก
  user        User     @relation(fields: [userId], references: [id])
  meetingDate DateTime
  canvasSnapshot Json  // snapshot ของ canvasData ณ เวลานั้น (immutable history)
  createdAt   DateTime @default(now())
}
```

**Index ที่ควรมี:** `Attendance(userId, date)`, `Task(projectId, status)`, `Worksheet(projectId, userId)`, `MeetingNote(worksheetId, meetingDate)`

---

## 4. API Endpoints

### Dashboard ภาพรวม
```
GET  /api/dashboard/summary?period=today|week|month&department=all
     → { totalEmployees, attendanceRate, onTimeTaskRate, overdueCount }

GET  /api/dashboard/department-performance?period=...
     → [{ department, score }]

GET  /api/dashboard/attendance-breakdown?period=...
     → { present, late, absent, leave }

GET  /api/dashboard/employees?department=&status=&page=&limit=
     → [{ id, name, department, todayStatus, remainingTasks, performanceScore }]
```

### Employee Profile
```
GET  /api/users/:userId
     → { id, name, email, avatarUrl, department, position }

GET  /api/users/:userId/projects
     → [{ id, name, status, taskCount, worksheetId, thumbnailUrl, lastUpdated }]

GET  /api/users/:userId/attendance-history?from=&to=
     → [{ date, status, checkIn, checkOut }]
```

### Worksheet (Canvas)
```
GET  /api/worksheets/:worksheetId
     → { id, projectId, userId, canvasData, updatedAt }

PUT  /api/worksheets/:worksheetId
     body: { canvasData }
     → บันทึก autosave (debounce 2-3 วินาทีฝั่ง frontend)

POST /api/worksheets/:worksheetId/upload-image
     multipart/form-data: file
     → { url }   // อัปโหลดเข้า S3/MinIO แล้วคืน URL มาแทรกใน canvasData
```

### Meeting Notes (History)
```
POST /api/worksheets/:worksheetId/meeting-notes
     body: { meetingDate }
     → สร้าง snapshot ของ canvasData ปัจจุบัน เก็บเป็น history (ไม่ลบของเดิม)

GET  /api/worksheets/:worksheetId/meeting-notes
     → [{ id, meetingDate, createdAt, user }]   // list history

GET  /api/meeting-notes/:noteId
     → { id, meetingDate, canvasSnapshot, user }  // ดู snapshot ย้อนหลัง (read-only)
```

---

## 5. Frontend Structure

### 5.1 Routes
```
/                              → Dashboard ภาพรวม
/employees/:userId             → Employee profile (list โปรเจกต์)
/employees/:userId/projects/:projectId/worksheet  → Canvas worksheet
```

### 5.2 Canvas Data Structure (เก็บใน Worksheet.canvasData เป็น JSONB)
```json
{
  "version": 1,
  "elements": [
    { "id": "el1", "type": "text", "x": 100, "y": 50, "text": "สรุปความคืบหน้า", "fontSize": 16, "color": "#1a1a1a" },
    { "id": "el2", "type": "image", "x": 200, "y": 150, "width": 300, "height": 200, "url": "https://storage.../img123.png" },
    { "id": "el3", "type": "freedraw", "points": [10,20, 15,25, 20,30], "stroke": "#e24b4a", "strokeWidth": 3 },
    { "id": "el4", "type": "rect", "x": 50, "y": 50, "width": 100, "height": 60, "fill": "#378ADD" }
  ]
}
```

### 5.3 หน้า Dashboard ภาพรวม (`/`)
- Filter bar: ช่วงเวลา, แผนก
- Metric cards: จำนวนพนักงาน, % เข้างาน, % งานตามกำหนด, งานล่าช้า
- Chart: bar chart ผลงานตามแผนก, donut chart attendance
- ตารางพนักงาน — **แต่ละแถวคลิกได้ทั้งแถว** → นำทางไป `/employees/:userId`
  - Hover state: เปลี่ยนพื้นหลังแถวเป็น `var(--surface-1)`, cursor pointer
  - คอลัมน์: avatar+ชื่อ, แผนก, สถานะวันนี้ (badge), งานคงเหลือ, performance score

### 5.4 หน้า Employee Profile (`/employees/:userId`)
- Header: avatar, ชื่อ, ตำแหน่ง, แผนก, ปุ่มกลับ
- Tab/section: สรุปการเข้างาน (mini calendar heatmap), สรุปผลงาน
- **รายการโปรเจกต์แบบ card grid** — แต่ละ card แสดง: ชื่อโปรเจกต์, สถานะ, thumbnail ของ worksheet ล่าสุด, จำนวน task, วันที่อัปเดตล่าสุด
  - คลิก card → ไปหน้า worksheet ของโปรเจกต์นั้น (`/employees/:userId/projects/:projectId/worksheet`)

### 5.5 หน้า Worksheet (Canvas) — หัวใจหลักของระบบ
**Layout:**
- Top bar: ชื่อโปรเจกต์ + ชื่อพนักงาน, ปุ่ม "บันทึกเป็นประวัติการประชุม" (สร้าง MeetingNote snapshot), ปุ่มดู history, สถานะ autosave ("บันทึกแล้ว" / "กำลังบันทึก...")
- Toolbar ด้านซ้ายหรือบน: 
  - Tool: Select, Text, Pen/Draw (พร้อม color picker + brush size), Upload image, Rectangle/shape พื้นฐาน, Eraser
  - Color palette: ใช้ ramp colors จาก design system
- Canvas area: เต็มพื้นที่ที่เหลือ ใช้ react-konva `<Stage>` + `<Layer>`
  - รองรับ: drag image ที่ลากวาง (drag-and-drop จากไฟล์ explorer หรือ paste), วาดเส้นฟรีด้วยเมาส์/touch, double-click เพื่อแก้ไข text
  - Zoom/pan ด้วย scroll wheel + space-drag
- Autosave: debounce 2-3 วิ หลังหยุดแก้ไข → PUT `/api/worksheets/:id`

**History panel (side drawer):**
- รายการ MeetingNote เรียงตามวันที่ ล่าสุดอยู่บนสุด
- คลิกแต่ละรายการ → เปิด read-only preview ของ snapshot นั้น (ไม่แก้ไขของเก่า)
- ปุ่ม "เริ่มประชุมใหม่" → สร้าง MeetingNote ใหม่จากสถานะปัจจุบันของ canvas

---

## 6. UI Theme Guidelines (Modern Tech, เน้นความเร็ว)

- **Color scheme:** Dark mode เป็น default, light mode เป็น option — โทนหลัก: พื้นหลังเทาเข้ม/ดำสนิท, accent สีฟ้า/ม่วง (electric blue `#378ADD`, violet `#7F77DD`)
- **Typography:** Sans-serif เท่านั้น (Inter, system-ui), ตัวเลขขนาดใหญ่ใน metric cards เพื่อความเร็วในการอ่าน
- **Motion:** transition สั้น (150-200ms), ไม่มี loading spinner ค้างนาน — ใช้ skeleton screen
- **Performance targets:**
  - Dashboard initial load < 1.5s (ใช้ pagination/virtualized list สำหรับพนักงาน 100+ คน)
  - Canvas ต้องลื่นที่ 60fps ขณะวาด (ใช้ Konva built-in caching, debounce re-render)
  - Lazy-load รูปภาพใน worksheet (ใช้ thumbnail ก่อน แล้วโหลด full-res เมื่อ zoom เข้า)
- **Component library:** ไม่ต้องใช้ heavy UI library — เขียน component เองแบบ flat minimal (border 1px, ไม่มี shadow/gradient หนัก) เพื่อความเร็วใน bundle size

---

## 7. Phase แนะนำสำหรับ Agent (ลำดับการพัฒนา)

1. **Backend foundation:** Prisma schema + migration, seed data ตัวอย่าง (พนักงาน 10-20 คน, โปรเจกต์ 5-10 โปรเจกต์)
2. **Auth + API:** JWT login, dashboard summary endpoints
3. **Frontend — Dashboard page:** ตาราง + กราฟ + filter (ใช้ mock data ก่อนได้ถ้า backend ยังไม่พร้อม)
4. **Frontend — Employee profile page:** project card grid
5. **Worksheet canvas:** เริ่มจาก text + shape ก่อน แล้วค่อยเพิ่ม freedraw + image upload
6. **Meeting history:** snapshot + history panel
7. **Polish:** dark theme, animation, performance tuning

---

## 8. Out of Scope (ไม่รวมในเฟสนี้ ถ้าไม่ระบุเพิ่ม)
- Real-time multi-user collaborative editing บน worksheet เดียวกัน
- Mobile native app (เน้น responsive web ก่อน)
- Notification/email alert system
- Advanced analytics/AI insights
