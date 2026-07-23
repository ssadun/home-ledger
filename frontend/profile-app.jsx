// profile-app.jsx — the signed-in user's own profile.
// ─────────────────────────────────────────────────────────────────────────────
// Account details (full name / username / email), password change, profile
// picture, theme and language. Everything here goes through /api/auth/me, which
// is scoped to the caller by the JWT — this page cannot edit another member, and
// cannot set role or active. Configuration → Members remains the admin screen.
(function () {
  const Icon = window.Icon;
  const StyledSelect = window.StyledSelect;
  const { Sidebar } = window.HL_NAV;
  const API = window.HL_PROFILE_API;

  // ── Avatar ────────────────────────────────────────────────────────────────
  // One renderer for both states: the uploaded picture when there is one, the
  // deterministic initials disc when there isn't.
  function Avatar({ profile, size, busy }) {
    const url = profile && profile.avatar_url;
    const px = size || 84;
    const style = { width: px, height: px };
    if (url) {
      return (
        <span className={'pf-avatar' + (busy ? ' busy' : '')} style={style}>
          <img src={url} alt="" className="pf-avatar-img" />
        </span>
      );
    }
    return (
      <span
        className={'pf-avatar pf-avatar-initials' + (busy ? ' busy' : '')}
        style={{ ...style, background: API.avatarColor(profile), fontSize: Math.round(px / 2.6) }}
      >
        {API.initials(profile)}
      </span>
    );
  }

  function Panel({ title, icon, children }) {
    return (
      <section className="pf-panel">
        <span className="pf-panel-title">
          {icon && <Icon name={icon} size={13} />}{title}
        </span>
        {children}
      </section>
    );
  }

  function Field({ label, hint, children }) {
    return (
      <label className="pf-field">
        <span className="pf-field-label">{label}</span>
        {children}
        {hint && <span className="pf-field-hint">{hint}</span>}
      </label>
    );
  }

  function App() {
    const [profile, setProfile] = React.useState(null);
    const [loadErr, setLoadErr] = React.useState('');

    // Account details form
    const [form, setForm] = React.useState({ full_name: '', username: '', email: '' });
    const [savingInfo, setSavingInfo] = React.useState(false);
    const [infoErr, setInfoErr] = React.useState('');

    // Password form
    const [pw, setPw] = React.useState({ current: '', next: '', confirm: '' });
    const [savingPw, setSavingPw] = React.useState(false);
    const [pwErr, setPwErr] = React.useState('');

    const [avatarBusy, setAvatarBusy] = React.useState(false);
    const [avatarErr, setAvatarErr] = React.useState('');
    const fileRef = React.useRef(null);

    const [theme, setTheme] = React.useState(
      () => (window.HL_THEME && window.HL_THEME.get()) || 'dark'
    );
    const [toast, setToast] = React.useState('');
    const toastTimer = React.useRef(null);

    const flash = (msg) => {
      setToast(msg);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(''), 3200);
    };

    const adopt = (p) => {
      setProfile(p);
      setForm({ full_name: p.full_name || '', username: p.username || '', email: p.email || '' });
      API.syncSession(p);
    };

    React.useEffect(() => {
      API.get().then(adopt).catch((e) => setLoadErr(e.message));
    }, []);

    // Mirror theme changes made from the sidebar toggle while this page is open.
    React.useEffect(() => {
      const onChange = (e) => setTheme(e.detail);
      window.addEventListener('hl-theme-change', onChange);
      return () => window.removeEventListener('hl-theme-change', onChange);
    }, []);

    const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

    const dirty = profile && (
      form.full_name !== (profile.full_name || '')
      || form.username !== (profile.username || '')
      || form.email !== (profile.email || '')
    );

    const saveInfo = async (e) => {
      e.preventDefault();
      if (!dirty || savingInfo) return;
      setSavingInfo(true);
      setInfoErr('');
      try {
        adopt(await API.update({
          full_name: form.full_name.trim(),
          username: form.username.trim(),
          email: form.email.trim(),
        }));
        flash('Profile saved.');
      } catch (err) {
        setInfoErr(err.message);
      }
      setSavingInfo(false);
    };

    const savePassword = async (e) => {
      e.preventDefault();
      if (savingPw) return;
      setPwErr('');
      if (pw.next.length < 6) { setPwErr('New password must be at least 6 characters.'); return; }
      if (pw.next !== pw.confirm) { setPwErr('The two new passwords do not match.'); return; }
      setSavingPw(true);
      try {
        await API.changePassword(pw.current, pw.next);
        setPw({ current: '', next: '', confirm: '' });
        flash('Password changed.');
      } catch (err) {
        setPwErr(err.message);
      }
      setSavingPw(false);
    };

    const pickAvatar = async (e) => {
      const file = e.target.files && e.target.files[0];
      // Reset the input so re-picking the SAME file still fires a change event.
      e.target.value = '';
      if (!file) return;
      setAvatarBusy(true);
      setAvatarErr('');
      try {
        adopt(await API.uploadAvatar(file));
        flash('Picture updated.');
      } catch (err) {
        setAvatarErr(err.message);
      }
      setAvatarBusy(false);
    };

    const removeAvatar = async () => {
      setAvatarBusy(true);
      setAvatarErr('');
      try {
        adopt(await API.deleteAvatar());
        flash('Picture removed.');
      } catch (err) {
        setAvatarErr(err.message);
      }
      setAvatarBusy(false);
    };

    const setLanguage = async (v) => {
      const prev = profile;
      setProfile((p) => ({ ...p, language: v }));   // optimistic
      try {
        adopt(await API.update({ language: v }));
        flash('Language preference saved.');
      } catch (err) {
        setProfile(prev);                            // roll back on failure
        setInfoErr(err.message);
      }
    };

    const toggleTheme = () => {
      if (window.HL_THEME) window.HL_THEME.toggle();
    };

    return (
      <div className="app">
        <Sidebar active="profile" />
        <div className="main">
          <header className="page-head">
            <div className="page-head-top">
              <div className="page-title-wrap cfg-detail-title-wrap">
                <div className="cfg-title-col">
                  <h1 className="page-title">Profile</h1>
                  <p className="page-subtitle">Your account details, sign-in password and app preferences</p>
                </div>
              </div>
            </div>
          </header>

          <div className="pf-scroll">
            <div className="pf-inner">
              {loadErr && <p className="pf-error" id="profile-load-error">{loadErr}</p>}
              {toast && <p className="pf-toast" id="profile-toast">{toast}</p>}

              {profile && (
                <React.Fragment>
                  {/* ── Preferences ── */}
                  <Panel title="Preferences" icon="settings-2">
                    <div className="pf-row">
                      <div className="pf-row-txt">
                        <span className="pf-row-label">Theme</span>
                        <span className="pf-row-desc">
                          Applies on every screen and is remembered on this device.
                        </span>
                      </div>
                      <button type="button" id="profile-theme-toggle-btn"
                        className="action-modal-btn lavender" onClick={toggleTheme}>
                        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={14} />
                        {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                      </button>
                    </div>

                    <div className="pf-row">
                      <div className="pf-row-txt">
                        <span className="pf-row-label">Language</span>
                        {/* Stated plainly rather than hidden: the column and the
                            control are real, the translation is not built yet. */}
                        <span className="pf-row-desc">
                          Saved to your account. The interface is English only for now —
                          translation is not built yet.
                        </span>
                      </div>
                      <div className="pf-select-field">
                        <div className="select-wrap">
                          <StyledSelect id="profile-language-select" className="sel"
                            value={profile.language || 'en'}
                            onChange={(e) => setLanguage(e.target.value)}>
                            {API.LANGUAGES.map((l) => (
                              <option key={l.value} value={l.value}>{l.label}</option>
                            ))}
                          </StyledSelect>
                        </div>
                      </div>
                    </div>
                  </Panel>

                  {/* ── Picture ── */}
                  <Panel title="Profile Picture" icon="image">
                    <div className="pf-avatar-row">
                      <Avatar profile={profile} size={84} busy={avatarBusy} />
                      <div className="pf-avatar-actions">
                        <p className="pf-field-hint">
                          PNG, JPG, GIF or WEBP, up to 4 MB. Without a picture your
                          initials are shown instead.
                        </p>
                        <div className="pf-btn-row">
                          <button type="button" id="profile-avatar-upload-btn"
                            className="action-modal-btn ok" disabled={avatarBusy}
                            onClick={() => fileRef.current && fileRef.current.click()}>
                            <Icon name="upload" size={14} />
                            {profile.avatar_url ? 'Replace' : 'Upload'}
                          </button>
                          {profile.avatar_url && (
                            <button type="button" id="profile-avatar-remove-btn"
                              className="action-modal-btn cancel" disabled={avatarBusy}
                              onClick={removeAvatar}>
                              <Icon name="trash-2" size={14} />Remove
                            </button>
                          )}
                        </div>
                        {avatarErr && <p className="pf-error">{avatarErr}</p>}
                      </div>
                    </div>
                    <input ref={fileRef} id="profile-avatar-input" type="file" accept="image/*"
                      style={{ display: 'none' }} onChange={pickAvatar} />
                  </Panel>

                  {/* ── Account details ── */}
                  <form onSubmit={saveInfo}>
                    <Panel title="Account Details" icon="user-round">
                      <Field label="Full Name">
                        <input id="profile-fullname-input" className="field-input" type="text"
                          value={form.full_name} onChange={(e) => set('full_name', e.target.value)}
                          placeholder="Your name" />
                      </Field>
                      <Field label="Username" hint="You can sign in with either your username or your email.">
                        <input id="profile-username-input" className="field-input" type="text"
                          value={form.username} onChange={(e) => set('username', e.target.value)}
                          placeholder="username" autoComplete="username" />
                      </Field>
                      <Field label="Email">
                        <input id="profile-email-input" className="field-input" type="email"
                          value={form.email} onChange={(e) => set('email', e.target.value)}
                          placeholder="you@example.com" autoComplete="email" />
                      </Field>
                      {infoErr && <p className="pf-error" id="profile-info-error">{infoErr}</p>}
                      <div className="pf-btn-row">
                        <button type="submit" id="profile-save-btn" className="action-modal-btn ok"
                          disabled={!dirty || savingInfo}>
                          <Icon name="save" size={14} />{savingInfo ? 'Saving…' : 'Save Changes'}
                        </button>
                      </div>
                    </Panel>
                  </form>

                  {/* ── Password ── */}
                  <form onSubmit={savePassword}>
                    <Panel title="Password" icon="lock">
                      <Field label="Current Password">
                        <input id="profile-current-password-input" className="field-input" type="password"
                          value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })}
                          autoComplete="current-password" />
                      </Field>
                      <Field label="New Password" hint="At least 6 characters.">
                        <input id="profile-new-password-input" className="field-input" type="password"
                          value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })}
                          autoComplete="new-password" />
                      </Field>
                      <Field label="Confirm New Password">
                        <input id="profile-confirm-password-input" className="field-input" type="password"
                          value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
                          autoComplete="new-password" />
                      </Field>
                      {pwErr && <p className="pf-error" id="profile-password-error">{pwErr}</p>}
                      <div className="pf-btn-row">
                        <button type="submit" id="profile-change-password-btn" className="action-modal-btn ok"
                          disabled={savingPw || !pw.current || !pw.next || !pw.confirm}>
                          <Icon name="check" size={14} />{savingPw ? 'Changing…' : 'Change Password'}
                        </button>
                      </div>
                    </Panel>
                  </form>

                </React.Fragment>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
})();
