export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  avatarUrl?: string;
  position?: string;
}

export interface DashboardSummary {
  totalEmployees: number;
  attendanceRate: number;
  onTimeTaskRate: number;
  overdueCount: number;
}

export interface DeptPerformance {
  department: string;
  score: number;
}

export interface AttendanceBreakdown {
  present: number;
  late: number;
  absent: number;
  leave: number;
}

export interface EmployeeRow {
  id: string;
  name: string;
  department: string;
  avatarUrl?: string;
  position?: string;
  todayStatus: 'present' | 'late' | 'absent' | 'leave';
  remainingTasks: number;
  performanceScore: number;
}

export interface EmployeesResponse {
  data: EmployeeRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AttendanceRecord {
  date: string;
  status: string;
  checkIn?: string;
  checkOut?: string;
}

export interface ProjectCard {
  id: string;
  name: string;
  status: string;
  taskCount: number;
  worksheetId?: string;
  thumbnailUrl?: string;
  lastUpdated: string;
}

export interface CanvasElement {
  id: string;
  type: 'text' | 'image' | 'freedraw' | 'rect' | 'circle' | 'line' | 'table';
  x?: number;
  y?: number;
  text?: string;
  fontSize?: number;
  color?: string;
  url?: string;
  width?: number;
  height?: number;
  radiusX?: number;
  radiusY?: number;
  points?: number[];
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  dragging?: boolean;
  scaleX?: number;
  scaleY?: number;
  rows?: string[][];
  colWidths?: number[];
  rowHeight?: number;
}

export interface CanvasData {
  version: number;
  elements: CanvasElement[];
}

export interface Worksheet {
  id: string;
  projectId: string;
  userId: string;
  canvasData: CanvasData;
  updatedAt: string;
}

export interface MeetingNoteItem {
  id: string;
  meetingDate: string;
  createdAt: string;
  user: { id: string; name: string; avatarUrl?: string };
}

export interface MeetingNoteDetail extends MeetingNoteItem {
  canvasSnapshot: CanvasData;
}
