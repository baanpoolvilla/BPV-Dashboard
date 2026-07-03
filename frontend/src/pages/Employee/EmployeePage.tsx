import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiGet, apiPost } from '../../api/client';
import type { User, ProjectCard, AttendanceRecord } from '../../api/types';
import { useAuthStore } from '../../store/auth';
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
          : <div className={styles.thumbPlaceholder}><span>WS</span></div>
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
  const navigate = useNavigate();
  const authUser = useAuthStore(s => s.user);
  const isCEO = authUser?.role === 'CEO';
  const isSelf = authUser?.id === userId;

  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<ProjectCard[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setError(false);
    const from = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    Promise.all([
      apiGet<User>(`/users/${userId}`),
      apiGet<ProjectCard[]>(`/users/${userId}/projects`),
      apiGet<AttendanceRecord[]>(`/users/${userId}/attendance-history?from=${from}`),
    ])
      .then(([u, p, a]) => { setUser(u); setProjects(p); setAttendance(a); })
      .catch(err => {
        if (err.message?.includes('403') && !isCEO && authUser?.id) {
          navigate(`/employees/${authUser.id}`, { replace: true });
        } else {
          setError(true);
        }
      })
      .finally(() => setLoading(false));
  }, [userId]);

  async function handleCreateProject() {
    if (!newProjectName.trim() || !userId) return;
    setCreating(true);
    try {
      await apiPost(`/users/${userId}/projects`, { name: newProjectName.trim() });
      setNewProjectName('');
      setShowCreateForm(false);
      const p = await apiGet<ProjectCard[]>(`/users/${userId}/projects`);
      setProjects(p);
    } catch {
      alert('ไม่สามารถสร้างโปรเจกต์ได้');
    } finally {
      setCreating(false);
    }
  }

  const presentDays = attendance.filter(a => a.status === 'present').length;
  const lateDays = attendance.filter(a => a.status === 'late').length;
  const absentDays = attendance.filter(a => a.status === 'absent').length;

  const canCreate = isCEO || isSelf;

  return (
    <AppShell
      backTo={isCEO ? '/' : undefined}
      backLabel={isCEO ? 'Dashboard' : undefined}
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
      ) : error ? (
        <div className="card" style={{ color: 'var(--red)', padding: 40, textAlign: 'center' }}>ไม่พบข้อมูล</div>
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
              {([['present', 'var(--green)', 'มาทำงาน'], ['late', 'var(--yellow)', 'มาสาย'], ['absent', 'var(--red)', 'ขาดงาน'], ['leave', 'var(--accent-violet)', 'ลาหยุด']] as const).map(([s, c, l]) => (
                <span key={s} className={styles.heatLegendItem}>
                  <span className={styles.heatLegendDot} style={{ background: c }} />
                  {l}
                </span>
              ))}
            </div>
          </div>

          {/* Projects */}
          <div>
            <div className={styles.sectionHeader}>
              <p className={styles.sectionTitle}>โปรเจกต์ ({projects.length})</p>
              {canCreate && (
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 13, padding: '6px 14px' }}
                  onClick={() => { setShowCreateForm(v => !v); setNewProjectName(''); }}
                >
                  {showCreateForm ? '✕ ยกเลิก' : '+ สร้างโปรเจกต์'}
                </button>
              )}
            </div>

            {showCreateForm && (
              <div className={`card ${styles.createForm}`}>
                <p className={styles.createFormTitle}>โปรเจกต์ใหม่</p>
                <input
                  className={styles.createInput}
                  type="text"
                  placeholder="ชื่อโปรเจกต์"
                  value={newProjectName}
                  onChange={e => setNewProjectName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateProject()}
                  autoFocus
                />
                <div className={styles.createFormActions}>
                  <button
                    className="btn btn-primary"
                    onClick={handleCreateProject}
                    disabled={!newProjectName.trim() || creating}
                  >
                    {creating ? 'กำลังสร้าง...' : 'สร้าง'}
                  </button>
                  <button className="btn btn-ghost" onClick={() => { setShowCreateForm(false); setNewProjectName(''); }}>
                    ยกเลิก
                  </button>
                </div>
              </div>
            )}

            {projects.length === 0 && !showCreateForm ? (
              <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>
                {canCreate ? 'ยังไม่มีโปรเจกต์ — กด "+ สร้างโปรเจกต์" เพื่อเริ่ม' : 'ไม่มีโปรเจกต์'}
              </div>
            ) : (
              <div className={styles.projectGrid}>
                {projects.map(p => <ProjectCardItem key={p.id} project={p} userId={userId!} />)}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </AppShell>
  );
}
