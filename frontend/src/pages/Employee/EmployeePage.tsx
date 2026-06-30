import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet } from '../../api/client';
import type { User, ProjectCard, AttendanceRecord } from '../../api/types';
import AppShell from '../../components/AppShell';
import styles from './EmployeePage.module.css';

function AttendanceHeatmap({ records }: { records: AttendanceRecord[] }) {
  const colorMap: Record<string, string> = {
    present: 'var(--green)', late: 'var(--yellow)', absent: 'var(--red)', leave: 'var(--accent-violet)',
  };
  const last30 = records.slice(0, 30).reverse();
  return (
    <div className={styles.heatmap}>
      {last30.map((r, i) => {
        const d = new Date(r.date);
        const label = `${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} — ${r.status}`;
        return (
          <div
            key={i}
            className={styles.heatCell}
            title={label}
            style={{ background: colorMap[r.status] ?? 'var(--surface-2)' }}
          />
        );
      })}
    </div>
  );
}

function ProjectStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = { active: 'กำลังดำเนินการ', completed: 'เสร็จแล้ว', on_hold: 'หยุดชั่วคราว' };
  return <span className={`badge badge-${status}`}>{map[status] ?? status}</span>;
}

function ProjectCardItem({ project, userId }: { project: ProjectCard; userId: string }) {
  const navigate = useNavigate();
  const updated = new Date(project.lastUpdated).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });

  return (
    <div
      className={styles.projectCard}
      onClick={() => project.worksheetId && navigate(`/employees/${userId}/projects/${project.id}/worksheet`)}
      style={{ cursor: project.worksheetId ? 'pointer' : 'default' }}
    >
      <div className={styles.projectThumb}>
        {project.thumbnailUrl
          ? <img src={project.thumbnailUrl} alt="" className={styles.thumbImg} />
          : <div className={styles.thumbPlaceholder}>
              <span>WS</span>
            </div>
        }
      </div>
      <div className={styles.projectInfo}>
        <div className={styles.projectName}>{project.name}</div>
        <div className={styles.projectMeta}>
          <ProjectStatusBadge status={project.status} />
          <span className={styles.taskCount}>{project.taskCount} งาน</span>
        </div>
        <div className={styles.projectUpdated}>อัปเดต {updated}</div>
      </div>
    </div>
  );
}

export default function EmployeePage() {
  const { userId } = useParams<{ userId: string }>();
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    Promise.all([
      apiGet<User>(`/users/${userId}`),
      apiGet<ProjectCard[]>(`/users/${userId}/projects`),
      apiGet<AttendanceRecord[]>(`/users/${userId}/attendance-history?from=${new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)}`),
    ])
      .then(([u, p, a]) => { setUser(u); setProjects(p); setAttendance(a); })
      .finally(() => setLoading(false));
  }, [userId]);

  const presentDays = attendance.filter(a => a.status === 'present').length;
  const lateDays = attendance.filter(a => a.status === 'late').length;
  const absentDays = attendance.filter(a => a.status === 'absent').length;

  return (
    <AppShell
      backTo="/"
      backLabel="Dashboard"
      title={user?.name ?? ''}
    >
      {loading ? (
        <div className={styles.skeletonPage}>
          <div className={styles.skeletonHeader}>
            <div className="skeleton" style={{ width: 64, height: 64, borderRadius: '50%' }} />
            <div>
              <div className="skeleton" style={{ width: 180, height: 20, marginBottom: 8 }} />
              <div className="skeleton" style={{ width: 120, height: 14 }} />
            </div>
          </div>
        </div>
      ) : user ? (
        <div className={styles.page}>
          {/* Profile header */}
          <div className={`card ${styles.profileHeader}`}>
            {user.avatarUrl
              ? <img src={user.avatarUrl} alt="" className={styles.avatar} />
              : <div className={styles.avatarFallback}>{user.name[0]}</div>
            }
            <div className={styles.profileInfo}>
              <h1 className={styles.name}>{user.name}</h1>
              <p className={styles.position}>{user.position ?? '—'}</p>
              <p className={styles.dept}>{user.department}</p>
            </div>
            <div className={styles.profileStats}>
              <div className={styles.stat}>
                <span className={styles.statVal}>{presentDays}</span>
                <span className={styles.statLabel}>วันมาทำงาน</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statVal} style={{ color: 'var(--yellow)' }}>{lateDays}</span>
                <span className={styles.statLabel}>วันมาสาย</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statVal} style={{ color: 'var(--red)' }}>{absentDays}</span>
                <span className={styles.statLabel}>วันขาด</span>
              </div>
              <div className={styles.stat}>
                <span className={styles.statVal}>{projects.length}</span>
                <span className={styles.statLabel}>โปรเจกต์</span>
              </div>
            </div>
          </div>

          {/* Attendance heatmap */}
          <div className="card">
            <p className={styles.sectionTitle}>ประวัติการเข้างาน (30 วันล่าสุด)</p>
            <AttendanceHeatmap records={attendance} />
            <div className={styles.heatLegend}>
              {[['present', 'มาทำงาน'], ['late', 'มาสาย'], ['absent', 'ขาดงาน'], ['leave', 'ลาหยุด']].map(([s, l]) => (
                <span key={s} className={styles.heatLegendItem}>
                  <span className={styles.heatLegendDot} style={{ background: s === 'present' ? 'var(--green)' : s === 'late' ? 'var(--yellow)' : s === 'absent' ? 'var(--red)' : 'var(--accent-violet)' }} />
                  {l}
                </span>
              ))}
            </div>
          </div>

          {/* Projects */}
          <div>
            <p className={styles.sectionTitle} style={{ marginBottom: 12 }}>โปรเจกต์ ({projects.length})</p>
            {projects.length === 0 ? (
              <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>ไม่มีโปรเจกต์</div>
            ) : (
              <div className={styles.projectGrid}>
                {projects.map(p => <ProjectCardItem key={p.id} project={p} userId={userId!} />)}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card" style={{ color: 'var(--red)', padding: 40, textAlign: 'center' }}>ไม่พบข้อมูลพนักงาน</div>
      )}
    </AppShell>
  );
}
