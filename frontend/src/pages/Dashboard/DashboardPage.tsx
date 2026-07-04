import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { apiGet } from '../../api/client';
import type {
  DashboardSummary, DeptPerformance, AttendanceBreakdown, EmployeesResponse, EmployeeRow,
} from '../../api/types';
import AppShell from '../../components/AppShell';
import styles from './DashboardPage.module.css';

type Period = 'today' | 'week' | 'month';
const ATTENDANCE_COLORS = ['#22c55e', '#f59e0b', '#ef4444', '#7F77DD'];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = { present: 'มาทำงาน', late: 'มาสาย', absent: 'ขาดงาน', leave: 'ลาหยุด' };
  return <span className={`badge badge-${status}`}>{map[status] ?? status}</span>;
}

function MetricCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className={`card ${styles.metricCard}`}>
      <p className={styles.metricLabel}>{label}</p>
      <p className={`${styles.metricValue} ${accent ? styles.metricAccent : ''}`}>{value}</p>
      {sub && <p className={styles.metricSub}>{sub}</p>}
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr>
      {[60, 100, 80, 70, 60, 80].map((w, i) => (
        <td key={i}><div className="skeleton" style={{ height: 16, width: w }} /></td>
      ))}
    </tr>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('today');
  const [department, setDepartment] = useState('all');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [deptPerf, setDeptPerf] = useState<DeptPerformance[]>([]);
  const [breakdown, setBreakdown] = useState<AttendanceBreakdown | null>(null);
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [empTotal, setEmpTotal] = useState(0);
  const [empPage, setEmpPage] = useState(1);
  const [empLoading, setEmpLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const [s, d, b] = await Promise.all([
        apiGet<DashboardSummary>(`/dashboard/summary?period=${period}&department=${department}`),
        apiGet<DeptPerformance[]>(`/dashboard/department-performance?period=${period}`),
        apiGet<AttendanceBreakdown>(`/dashboard/attendance-breakdown?period=${period}`),
      ]);
      setSummary(s);
      setDeptPerf(d);
      setBreakdown(b);
      setLoadError(null);
    } catch (err) {
      console.error('Dashboard summary fetch failed:', err);
      setLoadError('โหลดข้อมูลไม่สำเร็จ อาจเกิดจากการเชื่อมต่อกับเซิร์ฟเวอร์ขัดข้อง หรือเซสชันหมดอายุ');
    } finally {
      setSummaryLoading(false);
    }
  }, [period, department]);

  const fetchEmployees = useCallback(async () => {
    setEmpLoading(true);
    try {
      const res = await apiGet<EmployeesResponse>(
        `/dashboard/employees?department=${department}&page=${empPage}&limit=15`
      );
      setEmployees(res.data);
      setEmpTotal(res.total);
      setLoadError(null);
    } catch (err) {
      console.error('Dashboard employees fetch failed:', err);
      setLoadError('โหลดข้อมูลไม่สำเร็จ อาจเกิดจากการเชื่อมต่อกับเซิร์ฟเวอร์ขัดข้อง หรือเซสชันหมดอายุ');
    } finally {
      setEmpLoading(false);
    }
  }, [department, empPage]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchEmployees(); }, [fetchEmployees]);

  const donutData = breakdown
    ? [
        { name: 'มาทำงาน', value: breakdown.present },
        { name: 'มาสาย', value: breakdown.late },
        { name: 'ขาดงาน', value: breakdown.absent },
        { name: 'ลาหยุด', value: breakdown.leave },
      ]
    : [];

  return (
    <AppShell>
      <div className={styles.page}>
        {/* Filter bar */}
        <div className={styles.filterBar}>
          <h2 className={styles.pageHeader}>ภาพรวมองค์กร</h2>
          <div className={styles.filters}>
            <div className={styles.segmented}>
              {(['today', 'week', 'month'] as Period[]).map(p => (
                <button
                  key={p}
                  className={`${styles.seg} ${period === p ? styles.segActive : ''}`}
                  onClick={() => { setPeriod(p); setEmpPage(1); }}
                >
                  {p === 'today' ? 'วันนี้' : p === 'week' ? 'สัปดาห์นี้' : 'เดือนนี้'}
                </button>
              ))}
            </div>
            <select
              className={styles.select}
              value={department}
              onChange={e => { setDepartment(e.target.value); setEmpPage(1); }}
            >
              <option value="all">ทุกแผนก</option>
              {['IT', 'Account', 'Admin', 'Marketing', 'Housekeeper'].map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>

        {loadError && (
          <div className={styles.errorBanner}>
            <span>{loadError}</span>
            <button className="btn btn-ghost" onClick={() => { fetchSummary(); fetchEmployees(); }}>ลองใหม่</button>
          </div>
        )}

        {/* Metric cards */}
        <div className={styles.metrics}>
          {summaryLoading ? (
            [1, 2, 3, 4].map(i => (
              <div key={i} className={`card ${styles.metricCard}`}>
                <div className="skeleton" style={{ height: 14, width: 100, marginBottom: 12 }} />
                <div className="skeleton" style={{ height: 36, width: 60 }} />
              </div>
            ))
          ) : summary ? (
            <>
              <MetricCard label="พนักงานทั้งหมด" value={summary.totalEmployees} sub="คน" />
              <MetricCard label="อัตราเข้างาน" value={`${summary.attendanceRate}%`} sub="ตามช่วงเวลา" accent={summary.attendanceRate >= 80} />
              <MetricCard label="งานเสร็จตามกำหนด" value={`${summary.onTimeTaskRate}%`} accent={summary.onTimeTaskRate >= 70} />
              <MetricCard label="งานล่าช้า" value={summary.overdueCount} sub="รายการ" />
            </>
          ) : null}
        </div>

        {/* Charts */}
        <div className={styles.charts}>
          <div className={`card ${styles.chartCard}`}>
            <p className={styles.chartTitle}>ผลงานตามแผนก</p>
            {summaryLoading ? (
              <div className="skeleton" style={{ height: 200 }} />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={deptPerf} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
                  <XAxis dataKey="department" tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#8892a4', fontSize: 11 }} axisLine={false} tickLine={false} domain={[0, 100]} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-0)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-primary)' }}
                    cursor={{ fill: 'rgba(55,138,221,0.06)' }}
                    formatter={(v) => [`${v}%`, 'คะแนน']}
                  />
                  <Bar dataKey="score" fill="#378ADD" radius={[4, 4, 0, 0]} maxBarSize={40} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>

          <div className={`card ${styles.chartCard}`}>
            <p className={styles.chartTitle}>สถิติการเข้างาน</p>
            {summaryLoading || !breakdown ? (
              <div className="skeleton" style={{ height: 200 }} />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                    {donutData.map((_, i) => (
                      <Cell key={i} fill={ATTENDANCE_COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-0)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--text-primary)' }}
                    formatter={(v, name) => [v, name]}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: '#8892a4' }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Employee table */}
        <div className={`card ${styles.tableCard}`}>
          <div className={styles.tableHeader}>
            <p className={styles.chartTitle}>รายชื่อพนักงาน</p>
            <span className={styles.totalCount}>{empTotal} คน</span>
          </div>
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>พนักงาน</th>
                  <th>แผนก</th>
                  <th>สถานะวันนี้</th>
                  <th>งานคงเหลือ</th>
                  <th>Performance</th>
                </tr>
              </thead>
              <tbody>
                {empLoading
                  ? Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} />)
                  : employees.map(emp => (
                    <tr key={emp.id} className={styles.empRow} onClick={() => navigate(`/employees/${emp.id}`)}>
                      <td>
                        <div className={styles.empCell}>
                          {emp.avatarUrl
                            ? <img src={emp.avatarUrl} alt="" className={styles.empAvatar} />
                            : <div className={styles.empAvatarFallback}>{emp.name[0]}</div>
                          }
                          <div>
                            <div className={styles.empName}>{emp.name}</div>
                            {emp.position && <div className={styles.empPos}>{emp.position}</div>}
                          </div>
                        </div>
                      </td>
                      <td className={styles.dept}>{emp.department}</td>
                      <td><StatusBadge status={emp.todayStatus} /></td>
                      <td className={styles.numCell}>{emp.remainingTasks}</td>
                      <td>
                        <div className={styles.scoreCell}>
                          <div className={styles.scoreBar}>
                            <div
                              className={styles.scoreFill}
                              style={{
                                width: `${emp.performanceScore}%`,
                                background: emp.performanceScore >= 70 ? 'var(--green)' : emp.performanceScore >= 40 ? 'var(--yellow)' : 'var(--red)',
                              }}
                            />
                          </div>
                          <span className={styles.scoreNum}>{emp.performanceScore}%</span>
                        </div>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {empTotal > 15 && (
            <div className={styles.pagination}>
              <button
                className="btn btn-ghost"
                disabled={empPage === 1}
                onClick={() => setEmpPage(p => p - 1)}
              >
                ← ก่อนหน้า
              </button>
              <span className={styles.pageInfo}>หน้า {empPage} / {Math.ceil(empTotal / 15)}</span>
              <button
                className="btn btn-ghost"
                disabled={empPage >= Math.ceil(empTotal / 15)}
                onClick={() => setEmpPage(p => p + 1)}
              >
                ถัดไป →
              </button>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
