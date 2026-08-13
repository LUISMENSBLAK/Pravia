import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BrandLogo } from '../../components/layout/BrandLogo';
import { Button } from '../../components/ui/Button';
import { PasswordInput } from '../../components/ui/PasswordInput';
import { apiRequest, extractToken, tokenStore } from '../../services/api/client';
import { humanizeRole } from '../../lib/formatters';
import styles from './ActivationPage.module.css';

export function ActivationPage() {
  const [params] = useSearchParams(); const token = params.get('token') || ''; const navigate = useNavigate();
  const [invitation, setInvitation] = useState<any>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState('');
  useEffect(() => { apiRequest(`/auth/activation?token=${encodeURIComponent(token)}`, { retryOnUnauthorized: false }).then((data: any) => setInvitation(data.invitation)).catch((reason) => setError(reason instanceof Error ? reason.message : 'El enlace no es válido.')).finally(() => setLoading(false)); }, [token]);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (password !== confirmation) { setError('Las contraseñas no coinciden.'); return; } setError(''); try { const payload = await apiRequest<Record<string, unknown>>('/auth/activation', { method: 'POST', body: JSON.stringify({ token, password }), retryOnUnauthorized: false }); const access = extractToken(payload); if (access) tokenStore.set(access, true); navigate('/mi-dia', { replace: true }); window.location.reload(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'No fue posible activar la cuenta.'); } };
  return <main className={styles.page}><div className={styles.brand}><BrandLogo /></div><section className={styles.card}>{loading ? <p>Cargando invitación…</p> : invitation ? <><span className={styles.eyebrow}>ACTIVACIÓN SEGURA</span><h1>Bienvenido, {invitation.nombre}</h1><p>Activa la cuenta <strong>{invitation.email}</strong> como {humanizeRole(invitation.rol)}.</p><form onSubmit={submit}><PasswordInput label="Crea tu contraseña" value={password} onChange={(e) => setPassword(e.target.value)} /><PasswordInput label="Confirma tu contraseña" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /><small>Mínimo 12 caracteres con mayúscula, minúscula, número y símbolo.</small>{error && <p role="alert" className={styles.error}>{error}</p>}<Button fullWidth type="submit">Activar cuenta</Button></form></> : <><h1>Enlace no disponible</h1><p className={styles.error}>{error || 'La invitación expiró o ya fue utilizada.'}</p></>}</section></main>;
}
