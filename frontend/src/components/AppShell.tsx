import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import styles from './AppShell.module.css';

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
  backTo?: string;
  backLabel?: string;
  actions?: React.ReactNode;
}

export default function AppShell({ children, title, backTo, backLabel, actions }: AppShellProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  function handleLogout() {
    logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.logo} onClick={() => navigate('/')}>
            <span className={styles.logoMark}>BPV</span>
            <span className={styles.logoDash}>Dashboard</span>
          </span>
          {backTo && (
            <>
              <span className={styles.sep}>/</span>
              <button className={styles.back} onClick={() => navigate(backTo)}>
                {backLabel ?? 'กลับ'}
              </button>
            </>
          )}
          {title && <span className={styles.pageTitle}>{title}</span>}
        </div>
        <div className={styles.headerRight}>
          {actions}
          {user && (
            <div className={styles.userChip}>
              {user.avatarUrl && <img src={user.avatarUrl} alt="" className={styles.avatar} />}
              <span className={styles.userName}>{user.name}</span>
              <button className="btn btn-ghost" onClick={handleLogout} style={{ padding: '4px 10px', fontSize: 12 }}>
                ออกจากระบบ
              </button>
            </div>
          )}
        </div>
      </header>
      <main className={styles.main}>{children}</main>
    </div>
  );
}
