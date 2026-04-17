import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { updateProfile, uploadAvatar } from '../utils/api';
import styles from './Profile.module.css';

export default function Profile() {
  const { user, updateUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: user?.username || '', bio: user?.bio || '' });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const handle = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const save = async () => {
    setSaving(true); setMsg(''); setError('');
    try {
      const data = await updateProfile(form);
      updateUser(data.user);
      setMsg('Profile updated!');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update');
    } finally { setSaving(false); }
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const data = await uploadAvatar(file);
      updateUser(data.user);
      setMsg('Avatar updated!');
    } catch { setError('Avatar upload failed'); }
    finally { setUploading(false); fileRef.current.value = ''; }
  };

  const initials = (name) => name?.slice(0, 2).toUpperCase() || '??';

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <button className={styles.back} onClick={() => navigate('/')}>← Back to chat</button>

        <h1 className={styles.title}>Your Profile</h1>

        {msg && <div className={styles.success}>{msg}</div>}
        {error && <div className={styles.error}>{error}</div>}

        {/* Avatar */}
        <div className={styles.avatarSection}>
          <div className={styles.avatarBig}>
            {user?.avatar_url
              ? <img src={user.avatar_url} alt={user.username} />
              : initials(user?.username)}
          </div>
          <div>
            <input type="file" ref={fileRef} onChange={handleAvatarChange}
              accept="image/*" style={{display:'none'}} />
            <button className="btn btn-ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
              {uploading ? 'Uploading...' : 'Change avatar'}
            </button>
            <div className={styles.avatarHint}>JPG, PNG, GIF up to 10MB</div>
          </div>
        </div>

        {/* Form */}
        <div className={styles.form}>
          <div className={styles.field}>
            <label>Username</label>
            <input name="username" value={form.username} onChange={handle} />
          </div>
          <div className={styles.field}>
            <label>Email</label>
            <input value={user?.email} disabled className={styles.disabled} />
          </div>
          <div className={styles.field}>
            <label>Bio</label>
            <textarea name="bio" value={form.bio} onChange={handle}
              placeholder="Tell people about yourself..." rows={3}
              style={{resize:'vertical'}} />
          </div>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>

        {/* Info */}
        <div className={styles.info}>
          <div className={styles.infoRow}>
            <span>Member since</span>
            <span>{new Date(user?.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
