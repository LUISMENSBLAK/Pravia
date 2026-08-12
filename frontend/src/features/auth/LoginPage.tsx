import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, LockKeyhole, Mail } from 'lucide-react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { BrandLogo } from '../../components/layout/BrandLogo';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { useAuth } from './AuthProvider';
import { AuthSplash } from './AuthSplash';
import styles from './LoginPage.module.css';

type LocationState = { from?: { pathname?: string } };

export function LoginPage() {
  const { status, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');

  const destination = (location.state as LocationState | null)?.from?.pathname ?? '/mi-dia';

  useEffect(() => {
    if (error) setError('');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email, password]);

  if (status === 'checking') return <AuthSplash />;
  if (status === 'authenticated') return <Navigate to={destination} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const validEmail = /^\S+@\S+\.\S+$/.test(email);
    setEmailError(validEmail ? '' : 'Escribe un correo electrónico válido.');
    if (!validEmail || !password) return;

    setSubmitting(true);
    setError('');
    try {
      await login({ email: email.trim(), password, remember });
      navigate(destination, { replace: true });
    } catch {
      setError('No pudimos iniciar sesión con esos datos. Verifica tu correo y contraseña.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.brandPanel} aria-label="PRAVIA OS">
        <div className={styles.brandContent}>
          <BrandLogo className={styles.brandLogo} />
          <div className={styles.brandCopy}>
            <span className={styles.eyebrow}>PLATAFORMA NOTARIAL</span>
            <h1>Sistema operativo notarial.</h1>
            <p>Operación segura, ordenada y profesional para tu notaría.</p>
          </div>
        </div>
        <span className={styles.brandFooter}>PRAVIA OS</span>
      </section>

      <section className={styles.formPanel}>
        <div className={styles.mobileBrand}><BrandLogo /></div>
        <form className={styles.form} onSubmit={submit} noValidate>
          <header className={styles.heading}>
            <span className={styles.icon}><LockKeyhole size={20} aria-hidden="true" /></span>
            <h2>Bienvenido a PRAVIA OS</h2>
            <p>Ingresa tus credenciales para continuar.</p>
          </header>

          {error && <div className={styles.alert} role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}

          <div className={styles.fields}>
            <Input
              id="email"
              name="email"
              type="email"
              label="Correo electrónico"
              placeholder="nombre@notaria.mx"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              leadingIcon={<Mail size={18} />}
              error={emailError}
              disabled={submitting}
              required
            />
            <PasswordInput
              id="password"
              name="password"
              label="Contraseña"
              placeholder="Ingresa tu contraseña"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              disabled={submitting}
              required
            />
          </div>

          <label className={styles.remember}>
            <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} disabled={submitting} />
            <span aria-hidden="true" />
            Mantener sesión en este dispositivo
          </label>

          <Button type="submit" fullWidth disabled={submitting || !email || !password}>
            {submitting ? <><span className={styles.spinner} aria-hidden="true" />Iniciando sesión…</> : 'Iniciar sesión'}
          </Button>

          <p className={styles.security}>Acceso exclusivo para usuarios autorizados.</p>
        </form>
      </section>
    </main>
  );
}
