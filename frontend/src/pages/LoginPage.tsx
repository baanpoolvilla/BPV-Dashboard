import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import styles from './LoginPage.module.css';

export default function LoginPage() {
  const login = useAuthStore(s => s.login);
  const navigate = useNavigate();
  const [email, setEmail] = useState('admin@bpv.com');
  const [password, setPassword] = useState('password123');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch {
      setError('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <span className={styles.logoMark}>BPV</span>
          <span className={styles.logoSub}>Dashboard</span>
        </div>
        <h1 className={styles.title}>เข้าสู่ระบบ</h1>
        <p className={styles.sub}>ระบบติดตามพนักงาน สำหรับผู้บริหาร</p>

        <form onSubmit={handleSubmit} className={styles.form}>
          <label className={styles.label}>
            อีเมล
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label className={styles.label}>
            รหัสผ่าน
            <input
              className={styles.input}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </label>
          {error && <p className={styles.error}>{error}</p>}
          <button className={`btn btn-primary ${styles.submit}`} type="submit" disabled={loading}>
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ'}
          </button>
        </form>

        <p className={styles.hint}>Demo: admin@bpv.com / password123</p>
      </div>
    </div>
  );
}
