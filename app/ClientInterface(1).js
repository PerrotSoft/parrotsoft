'use client';
import { useState, useEffect, useRef } from 'react';
import { onSync, setWcAvatar as setGlobalAvatar, getWcAvatar as getGlobalAvatar, setupTotp, enableTotp, disableTotp, getTotpStatus, enableTotpOnly, sendSupportMessage, getMySupportMessages } from './actions';
import { makeAvatar360 } from './lib/fileStore';
import { GUEST_MODE_ENABLED, TOTP_ENABLED } from './lib/siteConfig';

const DEFAULT_BOOKMARKS = [
    { id: '1', name: 'Search', icon: '🔍', url: '/' },
    { id: '2', name: 'Settings', icon: '⚙️', url: 'sys:settings' },
    { id: '3', name: 'Drive', icon: '📂', url: '/drive' },
    { id: '4', name: 'DataPedia', icon: '📄', url: '/datapedia' },
    { id: '5', name: 'WavyChat', icon: '💬', url: '/WavyChat' },
    { id: '6', name: 'Web-PStudio', icon: '💻', url: 'https://pstudio-nine.vercel.app/' },
    { id: '7', name: 'ParrotOS Installer', icon: '💻', url: '/installer' },
    { id: '8', name: 'ParrotOS Pley', icon: '💻', url: '/parrotplay' },
    { id: '9', name: 'ParrotOS DB Manager', icon: '📂', url: '/db-manager' },
    { id: '10', name: 'WavyTube', icon: '📺', url: '/WavyTube' },
    { id: '11', name: 'ADS Dashboard', icon: '📊', url: '/ads' },
    { id: '12', name: 'ParrotOS News', icon: '📖', url: '/news' },
    { id: '13', name: 'WavyMusic', icon: '🎵', url: '/WavyMusic' },
];

// ── Компонент настроек TOTP (2FA), общий раздел аккаунта ─────────────────
// Перенесено сюда из WavyChat — 2FA это настройка аккаунта целиком, а не
// одного подсайта, так что ей место в общих настройках ParrotOS.
// QR-код рисуем через qrcode.js CDN — без npm-пакета.
function TotpSettings({ username }) {
  const [status, setStatus] = useState(null); // { enabled, totpOnly }
  const [step, setStep] = useState('idle'); // idle | setup
  const [secret, setSecret] = useState('');
  const [uri, setUri] = useState('');
  const [code, setCode] = useState('');
  const [disablePwd, setDisablePwd] = useState('');
  const [msg, setMsg] = useState('');
  const qrRef = useRef(null);

  useEffect(() => {
    if (!username) return;
    getTotpStatus(username).then(setStatus);
  }, [username]);

  useEffect(() => {
    if (step !== 'setup' || !uri || !qrRef.current) return;
    if (window.QRCode) {
      qrRef.current.innerHTML = '';
      new window.QRCode(qrRef.current, { text: uri, width: 180, height: 180, colorLight: '#fff', colorDark: '#000' });
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    s.onload = () => {
      if (!qrRef.current) return;
      qrRef.current.innerHTML = '';
      new window.QRCode(qrRef.current, { text: uri, width: 180, height: 180, colorLight: '#fff', colorDark: '#000' });
    };
    document.head.appendChild(s);
  }, [step, uri]);

  async function startSetup() {
    setMsg('');
    const res = await setupTotp(username);
    if (!res.success) { setMsg(res.error); return; }
    setSecret(res.secret);
    setUri(res.uri);
    setStep('setup');
  }

  async function confirmEnable() {
    setMsg('Проверяем код...');
    const res = await enableTotp(username, secret, code);
    if (!res.success) { setMsg(res.error); return; }
    setMsg('✅ 2FA включена!');
    setStep('idle');
    setCode('');
    setStatus(await getTotpStatus(username));
  }

  async function doDisable() {
    setMsg('Отключаем...');
    const res = await disableTotp(username, disablePwd);
    if (!res.success) { setMsg(res.error); return; }
    setMsg('2FA отключена.');
    setDisablePwd('');
    setStep('idle');
    setStatus(await getTotpStatus(username));
  }

  async function doEnableTotpOnly() {
    const pwd = prompt('Введите текущий пароль для подтверждения:');
    if (!pwd) return;
    const res = await enableTotpOnly(username, pwd);
    setMsg(res.success ? '✅ Режим «только код» включён' : res.error);
    setStatus(await getTotpStatus(username));
  }

  if (!status) return <p style={{fontSize:12,color:'var(--text)',opacity:0.6}}>Загрузка...</p>;

  const inputStyle = {width:'100%',background:'rgba(127,127,127,0.1)',border:'1px solid var(--border-light)',borderRadius:10,padding:'9px 12px',color:'var(--text)',fontSize:13,marginBottom:8,boxSizing:'border-box'};
  const btnPrimary = {width:'100%',background:'var(--accent)',border:'none',borderRadius:10,padding:'9px',color:'#fff',cursor:'pointer',fontWeight:600,marginBottom:6};
  const btnSecondary = {width:'100%',background:'rgba(127,127,127,0.15)',border:'none',borderRadius:10,padding:'9px',color:'var(--text)',cursor:'pointer',marginBottom:6};

  return (
    <div style={{fontSize:13}}>
      {msg && <p style={{color: msg.startsWith('✅') ? '#34c759' : '#ff6b6b', marginBottom:8}}>{msg}</p>}

      {step === 'idle' && !status.enabled && (
        <>
          <p style={{color:'var(--text)',opacity:0.7,marginBottom:10}}>2FA не включена — добавьте защиту через приложение-аутентификатор.</p>
          <button style={btnPrimary} onClick={startSetup}>Настроить 2FA</button>
        </>
      )}

      {step === 'setup' && (
        <>
          <p style={{color:'var(--text)',opacity:0.7,marginBottom:8}}>Отсканируйте QR в Google Authenticator / Yandex Key / Aegis:</p>
          <div ref={qrRef} style={{background:'#fff',borderRadius:10,padding:8,display:'inline-block',marginBottom:12}} />
          <p style={{color:'var(--text)',opacity:0.6,fontSize:11,wordBreak:'break-all',marginBottom:8}}>Или секрет вручную: <b style={{color:'var(--text)'}}>{secret}</b></p>
          <input style={inputStyle} placeholder="6-значный код" value={code} onChange={e=>setCode(e.target.value)} maxLength={6} inputMode="numeric" />
          <button style={btnPrimary} onClick={confirmEnable}>Подтвердить</button>
          <button style={btnSecondary} onClick={()=>{setStep('idle');setMsg('');}}>Отмена</button>
        </>
      )}

      {step === 'idle' && status.enabled && (
        <>
          <p style={{color:'#34c759',marginBottom:8}}>✅ 2FA включена {status.totpOnly ? '(только код)' : ''}</p>
          {!status.totpOnly && (
            <button style={btnSecondary} onClick={doEnableTotpOnly}>Вход только по коду (без пароля)</button>
          )}
          <input style={inputStyle} placeholder="Пароль для отключения" type="password" value={disablePwd} onChange={e=>setDisablePwd(e.target.value)} />
          <button style={{...btnSecondary, background:'rgba(255,60,60,0.15)',color:'#ff6b6b'}} onClick={doDisable}>Отключить 2FA</button>
        </>
      )}
    </div>
  );
}

export default function ClientInterface({ children, serverDB,  dbActions }) {
    const [user, setUser] = useState(null);
    const [isAuth, setIsAuth] = useState(false);
    const [loading, setLoading] = useState(true);
    const [launcherOpen, setLauncherOpen] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [view, setView] = useState('main');
    const [draggedIdx, setDraggedIdx] = useState(null);
    // 'expanded' — аватарка + имя + баланс всегда видны (по умолчанию на ПК).
    // 'semi' — видна только аватарка + кнопка-развёртка, имя/баланс скрыты
    // (по умолчанию на телефоне). Можно переключить вручную в настройках —
    // тогда сохранённый выбор побеждает автоопределение по ширине экрана.
    const [menuMode, setMenuMode] = useState('expanded');
    const [perfMode, setPerfMode] = useState('basic'); // 'basic' | 'fast' — fast отключает блюр/тени/анимации для слабых устройств
    const [themeMode, setThemeMode] = useState('light'); // 'light' | 'dark' — общая тёмная тема (см. globals.css [data-theme="dark"])
    const [settingsCategory, setSettingsCategory] = useState(null); // null на мобильном = список категорий, иначе выбранная категория

    // ── Поддержка ──
    const [supportText, setSupportText] = useState('');
    const [supportSending, setSupportSending] = useState(false);
    const [supportHistory, setSupportHistory] = useState(null); // null = ещё не грузили
    const loadSupportHistory = async () => {
        if (!user?.username) return;
        setSupportHistory(await getMySupportMessages(user.username));
    };
    useEffect(() => {
        if (settingsCategory === 'support' && supportHistory === null) {
            loadSupportHistory();
        }
    }, [settingsCategory]);
    const handleSendSupport = async () => {
        const text = supportText.trim();
        if (!text) return;
        setSupportSending(true);
        try {
            const res = await sendSupportMessage(user.username, text);
            if (res?.success === false) { alert('Не получилось отправить: ' + (res.error || 'неизвестная ошибка')); return; }
            setSupportText('');
            await loadSupportHistory();
        } finally {
            setSupportSending(false);
        }
    };
    const [globalLang, setGlobalLang] = useState('en'); // общий язык по умолчанию — читают отдельные страницы (WavyChat и т.д.) как стартовое значение
    const [bookmarksPickerOpen, setBookmarksPickerOpen] = useState(false);

    useEffect(() => {
        const savedMenuMode = localStorage.getItem('p_menu_mode');
        if (savedMenuMode) {
            setMenuMode(savedMenuMode);
        } else if (typeof window !== 'undefined') {
            setMenuMode(window.innerWidth < 768 ? 'semi' : 'expanded');
        }
        // Единый флаг "фаст" в localStorage — читается и на этой странице, и на
        // остальных (например WavyChat), чтобы быстрый режим был общим на весь сайт,
        // а не настраивался отдельно на каждой странице.
        const savedFast = localStorage.getItem('p_fast');
        if (savedFast !== null) setPerfMode(savedFast === '1' ? 'fast' : 'basic');
        const savedLang = localStorage.getItem('p_lang');
        if (savedLang) setGlobalLang(savedLang);
        const savedThemeMode = localStorage.getItem('p_theme_mode');
        if (savedThemeMode) setThemeMode(savedThemeMode); // атрибут на <html> уже выставлен инлайн-скриптом в layout.js — тут только синхронизируем React-состояние
    }, []);

    const changeThemeMode = (mode) => {
        setThemeMode(mode);
        localStorage.setItem('p_theme_mode', mode);
        if (mode === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
        else document.documentElement.removeAttribute('data-theme');
        // 'storage' event браузера НЕ срабатывает в той же вкладке, где
        // произошло изменение (только в других вкладках/окнах) — поэтому
        // страницы вроде installer/db-manager/mail, которые слушали именно
        // его, не видели смену темы без перезагрузки. Кастомное событие
        // работает и в своей вкладке тоже.
        window.dispatchEvent(new CustomEvent('parrot-theme-change', { detail: mode }));
    };

    const changeMenuMode = (mode) => {
        setMenuMode(mode);
        localStorage.setItem('p_menu_mode', mode);
    };

    const changePerfMode = (mode) => {
        setPerfMode(mode);
        localStorage.setItem('p_fast', mode === 'fast' ? '1' : '0');
    };

    const changeGlobalLang = (l) => {
        setGlobalLang(l);
        localStorage.setItem('p_lang', l);
    };

    const addBookmark = async (bm) => {
        const exists = (user.apps || []).some(a => a.url === bm.url);
        if (exists) return;
        const updated = { ...user, apps: [...(user.apps || []), { ...bm, id: Date.now().toString(36) }] };
        await sync(updated);
    };

    const removeBookmark = async (id) => {
        const updated = { ...user, apps: (user.apps || []).filter(a => a.id !== id) };
        await sync(updated);
    };

    const addAllMissingBookmarks = async () => {
        const have = new Set((user.apps || []).map(a => a.url));
        const missing = DEFAULT_BOOKMARKS.filter(b => !have.has(b.url)).map(b => ({ ...b, id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }));
        if (!missing.length) return;
        const updated = { ...user, apps: [...(user.apps || []), ...missing] };
        await sync(updated);
    };

    const handleAppReorder = async (dropIdx) => {
        if (draggedIdx === null || draggedIdx === dropIdx || !user?.apps) {
            setDraggedIdx(null);
            return;
        }
        const newApps = [...user.apps];
        const [moved] = newApps.splice(draggedIdx, 1);
        newApps.splice(dropIdx, 0, moved);
        setDraggedIdx(null);
        await sync({ ...user, apps: newApps });
    };
    const [authMode, setAuthMode] = useState('login');
    const [form, setForm] = useState({ username: '', pass: '', birthDate: '' });
    const [newApp, setNewApp] = useState({ name: '', icon: '🌐', url: '' });
    const [editForm, setEditForm] = useState({ pass: '', avatar: '', birthDate: '' });
    const [avatarUploading, setAvatarUploading] = useState(false);
    const [balance, setBalance] = useState(0);
    const [is18Confirmed, setIs18Confirmed] = useState(false);

    // Считаем возраст по дате рождения на клиенте — только для мгновенного отображения.
    // Официальный источник истины — возраст, посчитанный и сохранённый на сервере (setUserBirthDate).
    const calcAge = (birthDateStr) => {
        if (!birthDateStr) return null;
        const birth = new Date(birthDateStr);
        if (isNaN(birth.getTime())) return null;
        const now = new Date();
        let age = now.getFullYear() - birth.getFullYear();
        const m = now.getMonth() - birth.getMonth();
        if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
        return age >= 0 ? age : 0;
    };

    const cryptoAction = (key, input, mode = 'enc') => {
        try {
            if (mode === 'enc') {
                const str = JSON.stringify(input);
                const result = str.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ key.charCodeAt(i % key.length))).join('');
                return btoa(unescape(encodeURIComponent(result)));
            } else {
                const decoded = decodeURIComponent(escape(atob(input)));
                const result = decoded.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ key.charCodeAt(i % key.length))).join('');
                return JSON.parse(result);
            }
        } catch (e) { return null; }
    };

    const generateKey = async (password) => {
        const msgBuffer = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    };

    // Пока вкладка открыта и пользователь — гость, раз в минуту продлеваем
    // p_guest_last_active, чтобы 30-минутный таймаут отсчитывался от реальной
    // активности, а не только от момента входа.
    useEffect(() => {
        if (!user?.isGuest) return;
        const id = setInterval(() => touchGuestActivity(), 60 * 1000);
        return () => clearInterval(id);
    }, [user?.isGuest]);

    useEffect(() => {
        if (typeof window !== 'undefined' && dbActions) {
            window.syncDrive = dbActions.syncDrive;
            window.getUserFiles = dbActions.getUserFiles;
            window.cryptoAction = cryptoAction;
        }
    }, [dbActions]);
    useEffect(() => {
        const username = localStorage.getItem('p_user') || "poly";
        if (dbActions?.getBalance) {
            dbActions.getBalance(username).then(setBalance);
        }
    }, [user]);
    useEffect(() => {
        if (view === 'settings' && user) {
            setEditForm({ pass: '', avatar: user.avatar || '', birthDate: user.birthDate || '' });
            setIs18Confirmed(false);
        }
    }, [view, user]);
    useEffect(() => {
        const init = async () => {
            const savedName = localStorage.getItem('p_user');
            const savedToken = localStorage.getItem('p_token');

            // Восстановление гостевого аккаунта: он никогда не попадает в
            // serverDB (см. enterGuestMode), поэтому проверяем его отдельной
            // веткой — по флагу p_is_guest и локально сохранённым данным.
            if (savedName && savedName.startsWith(GUEST_PREFIX) && localStorage.getItem('p_is_guest') === '1') {
                const lastActive = Number(localStorage.getItem('p_guest_last_active') || 0);
                const isPermanent = localStorage.getItem('p_guest_permanent') === '1';
                const expired = !isPermanent && (Date.now() - lastActive > GUEST_TIMEOUT_MS);

                if (expired) {
                    // Не заходили больше 30 минут — гостевой аккаунт и все его
                    // данные удаляются, пользователя вернёт на экран входа.
                    clearGuestData();
                } else {
                    try {
                        const guestData = JSON.parse(localStorage.getItem('p_guest_data') || '{}');
                        setUser({ ...guestData, isGuest: true, username: savedName, token: savedToken });
                        setIsAuth(true);
                        touchGuestActivity();
                    } catch (e) {
                        clearGuestData();
                    }
                }
                return;
            }

            if (savedName && savedToken && serverDB[savedName]) {
                const entry = serverDB[savedName];
                let rawData = entry.data || entry;
                // ВАЖНО: раньше здесь был `await dbActions.getBalance(...)` перед первой
                // отрисовкой — на медленном 3G это блокировало весь интерфейс на секунды
                // (баланс и так отдельно подтягивается эффектом выше по [user]). Убрали
                // блокировку: расшифровка идёт из serverDB, который уже пришёл с сервера
                // при первом рендере страницы (SSR) — сети для этого не нужно вообще.
                try {
                    const parsed = JSON.parse(rawData);
                    if (parsed.os) rawData = parsed.os;
                } catch (e) {}

                const data = cryptoAction(savedToken, rawData, 'dec');
                if (data) {
                    setUser({ ...data, username: savedName, token: savedToken });
                    setIsAuth(true);
                    // Аватарка теперь хранится отдельно, не в зашифрованном блобе — тянем
                    // её из глобальной таблицы (не блокируя первую отрисовку).
                    getGlobalAvatar(savedName).then(av => {
                        if (av) setUser(prev => prev ? { ...prev, avatar: av } : prev);
                    });
                } else {
                    localStorage.clear();
                }
            }
            setLoading(false);
        };
        init();
    }, [serverDB]);
    const handleTopUp = async () => {
        const amount = 500; 
        const res = await dbActions.addBalance(user.username, amount);
        
        if (res.success && res.payUrl) {
            const payWin = window.open(res.payUrl, 'Payment', 'width=400,height=600');
            const timer = setInterval(async () => {
                if (payWin.closed) {
                    clearInterval(timer);
                    const newB = await dbActions.getBalance(user.username);
                    setBalance(newB);
                }
            }, 1000);
        }
    };
    const handlePaymentClick = async () => {
    const amount = 500;
    const res = await dbActions.addBalance(user.username, amount);

    if (res.success && res.payUrl) {
        const width = 450;
        const height = 600;
        const left = (window.screen.width / 2) - (width / 2);
        const top = (window.screen.height / 2) - (height / 2);

        const payWindow = window.open(
            res.payUrl, 
            'ParrotPaySystem', 
            `width=${width},height=${height},top=${top},left=${left},scrollbars=no,resizable=no`
        );

        if (!payWindow) {
            alert("The browser blocked the payment window! Allow pop-ups.");
        }
    }
};
const handleAuth = async (e) => {
    e.preventDefault();
    const token = await generateKey(form.pass);
    const name = form.username.trim();

    if (authMode === 'register') {
        if (serverDB[name]) return alert("Username taken!");
        if (!form.birthDate) return alert("Укажите дату рождения!");
        const newUser = {
            balance: balance,
            birthDate: form.birthDate,
            apps: [
                    { id: '1', name: 'Search', icon: '🔍', url: '/' },
                    { id: '2', name: 'Settings', icon: '⚙️', url: 'sys:settings' },
                    { id: '3', name: 'Drive', icon: '📂', url: '/drive' },
                    { id: '4', name: 'DataPedia', icon: '📄', url: '/datapedia' },
                    { id: '5', name: 'WavyChat', icon: '💬', url: '/WavyChat' },
                    { id: '6', name: 'Web-PStudio', icon: '💻', url: 'https://pstudio-nine.vercel.app/' },
                    { id: '7', name: 'ParrotOS Installer', icon: '💻', url: '/installer' },
                    { id: '8', name: 'ParrotOS Pley', icon: '💻', url: '/parrotplay' },
                    { id: '9', name: 'ParrotOS DB Manager', icon: '📂', url: '/db-manager' },
                    { id: '10', name: 'WavyTube', icon: '📺', url: '/WavyTube' },
                    { id: '11', name: 'ADS Dashboard', icon: '📊', url: '/ads' },
                    { id: '12', name: 'ParrotOS News', icon: '📖', url: '/news' },
                    { id: '13', name: 'WavyMusic', icon: '🎵', url: '/WavyMusic' },
                ],
            avatar: ""
        };
        
        await onSync(name, cryptoAction(token, newUser, 'enc'), form.birthDate);
        
        complete(name, token, newUser);
    } else {
        const entry = serverDB[name];
        if (!entry) return alert("User not found!");
        let rawData = entry.data || entry;
        try {
            const parsed = JSON.parse(rawData);
            if (parsed.os) rawData = parsed.os;
        } catch (e) {}
        const data = cryptoAction(token, rawData, 'dec');
        if (data) complete(name, token, data);
        else alert("Wrong password!");
    }
};

    const complete = (n, t, d) => {
        localStorage.setItem('p_user', n);
        localStorage.setItem('p_token', t);
        setUser({ ...d, username: n, token: t });
        setIsAuth(true);
    };

    // ── Гостевой режим ("Не входить") ────────────────────────────────────
    // Полностью локальный, нигде на сервере не регистрируется (onSync ни разу
    // не вызывается, имя гостя никогда не попадает в serverDB — так что
    // резервировать его для остальных пользователей не нужно и невозможно:
    // сервер про гостевые аккаунты просто ничего не знает).
    //
    // Данные аккаунта живут только в localStorage этого браузера/ПК:
    //   p_guest_data         — сам профиль (JSON)
    //   p_guest_last_active  — timestamp последней активности (для 30-мин. таймаута)
    //   p_guest_permanent    — '1', если пользователь нажал «Сохранить аккаунт навсегда»
    //
    // Если с последнего визита прошло больше GUEST_TIMEOUT_MS — при следующей
    // загрузке сайта аккаунт (и все его данные) стирается и предлагается
    // войти заново или создать новый гостевой аккаунт. Флаг p_guest_permanent
    // отключает эту очистку, но данные всё равно остаются только локально —
    // на сервер это никогда не отправляется.
    const GUEST_PREFIX = 'guest_';
    const GUEST_TIMEOUT_MS = 30 * 60 * 1000; // 30 минут

    const touchGuestActivity = () => {
        localStorage.setItem('p_guest_last_active', String(Date.now()));
    };

    const clearGuestData = () => {
        localStorage.removeItem('p_user');
        localStorage.removeItem('p_token');
        localStorage.removeItem('p_is_guest');
        localStorage.removeItem('p_guest_data');
        localStorage.removeItem('p_guest_last_active');
        localStorage.removeItem('p_guest_permanent');
    };

    const enterGuestMode = () => {
        const guestName = GUEST_PREFIX + Math.floor(100000 + Math.random() * 900000); // guest_483021
        const guestData = {
            balance: 0,
            birthDate: '',
            isGuest: true,
            apps: [
                { id: '1', name: 'Search', icon: '🔍', url: '/' },
                { id: '5', name: 'WavyChat', icon: '💬', url: '/WavyChat' },
                { id: '10', name: 'WavyTube', icon: '📺', url: '/WavyTube' },
            ],
            avatar: '',
        };
        localStorage.setItem('p_user', guestName);
        localStorage.setItem('p_token', 'guest'); // не настоящий крипто-токен — гостя не с чем сверять на сервере
        localStorage.setItem('p_is_guest', '1');
        localStorage.setItem('p_guest_data', JSON.stringify(guestData));
        localStorage.removeItem('p_guest_permanent');
        touchGuestActivity();
        setUser({ ...guestData, username: guestName, token: 'guest' });
        setIsAuth(true);
    };

    // Кнопка «Сохранить аккаунт навсегда» — просто отключает 30-минутную
    // чистку. Аккаунт как был локальным (только в этом браузере), так и
    // остаётся — на сервер ничего не уходит и не резервируется.
    const makeGuestPermanent = () => {
        localStorage.setItem('p_guest_permanent', '1');
        touchGuestActivity();
        alert('Готово — этот гостевой аккаунт больше не будет удаляться по таймауту. Но помни: он всё ещё хранится только в этом браузере/на этом устройстве, а не на сервере, так что скопировать его на другое устройство нельзя, и потерять при очистке данных браузера так же легко, как и украсть тому, у кого есть доступ к этому браузеру.');
    };

    const sync = async (updated) => {
        // Гостя на сервер никогда не отправляем — только перезаписываем
        // локальный p_guest_data и продлеваем активность.
        if (updated?.isGuest) {
            const { username, token, ...pure } = updated;
            localStorage.setItem('p_guest_data', JSON.stringify(pure));
            touchGuestActivity();
            setUser(updated);
            return;
        }
        const { username, token, ...pure } = updated;
        await onSync(username, cryptoAction(token, pure, 'enc'), updated.birthDate);
        setUser(updated);
    };

    const handleAvatarFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !user) return;
        setAvatarUploading(true);
        try {
            const reader = new FileReader();
            const raw = await new Promise((resolve, reject) => {
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const cropped = await makeAvatar360(raw);
            const res = await setGlobalAvatar(user.username, cropped);
            if (res?.success !== false) {
                setUser(prev => ({ ...prev, avatar: cropped }));
            } else {
                alert(res?.error || 'Не удалось сохранить аватарку');
            }
        } catch (err) {
            alert('Не удалось обработать картинку: ' + err.message);
        } finally {
            setAvatarUploading(false);
            e.target.value = '';
        }
    };
    if (loading) return (
        <div className="parrot-loader">
            <style>{`
                .parrot-loader {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    background: transparent;
                    color: var(--text);
                    font-family: 'Segoe UI Variable Text', sans-serif;
                    overflow: hidden;
                }

                .loader-box {
                    position: relative;
                    width: 120px;
                    height: 120px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .logo-p {
                    font-size: 60px;
                    font-weight: 800;
                    z-index: 2;
                }

                .ring {
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    border: 3px solid rgba(255, 255, 255, 0.1);
                    border-radius: 50%;
                }

                .ring-active {
                    position: absolute;
                    width: 100%;
                    height: 100%;
                    border: 3px solid transparent;
                    border-top: 3px solid #fff;
                    border-radius: 50%;
                    animation: spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
                }

                .loader-text {
                    margin-top: 40px;
                    text-align: center;
                }

                .os-title {
                    font-size: 18px;
                    font-weight: 600;
                    letter-spacing: 4px;
                    text-transform: uppercase;
                    margin-bottom: 10px;
                }

                .loading-dots {
                    font-size: 12px;
                    opacity: 0.5;
                    font-weight: 400;
                }

                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>

            <div className="loader-box">
                <div className="ring"></div>
                <div className="ring-active"></div>
                <div className="logo-p">P</div>
            </div>

            <div className="loader-text">
                <div className="os-title">Parrot Soft</div>
                <div className="loading-dots">Starting system...</div>
            </div>
        </div>
    );

    if (!isAuth) return (
        <div className="auth-page" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: "url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=1964&auto=format&fit=crop') center/cover" }}>
            <div className="block-v1 animate-in" style={{ width: '100%', maxWidth: '350px', padding: '40px', borderRadius: '30px', textAlign: 'center', color: 'white', border: '1px solid rgba(255,255,255,0.1)' }}>
                <div className="logo-sq" style={{ background: 'var(--accent)', width: '50px', height: '50px', borderRadius: '12px', margin: '0 auto 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>P</div>
                <h2 style={{ marginBottom: '25px' }}>{authMode === 'login' ? 'Login' : 'Create Account'}</h2>
                <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <input className="inp-v1" placeholder="Username" required onChange={e => setForm({...form, username: e.target.value})} style={{ background: 'rgba(255,255,255,0.05)', color: 'black' }} />
                    <input className="inp-v1" type="password" placeholder="Password" required onChange={e => setForm({...form, pass: e.target.value})} style={{ background: 'rgba(255,255,255,0.05)', color: 'black' }} />
                    {authMode === 'register' && (
                        <div style={{ textAlign: 'left' }}>
                            <label style={{ fontSize: 12, opacity: 0.6, display: 'block', marginBottom: 4 }}>Дата рождения</label>
                            <input
                                className="inp-v1"
                                type="date"
                                required
                                max={new Date().toISOString().split('T')[0]}
                                value={form.birthDate}
                                onChange={e => setForm({ ...form, birthDate: e.target.value })}
                                style={{ background: 'rgba(255,255,255,0.05)', color: 'black', width: '100%' }}
                            />
                            <p style={{ fontSize: 11, opacity: 0.5, margin: '4px 0 0' }}>
                                Нужна для возрастных ограничений контента. Если не указать, аккаунту по умолчанию будет присвоено 12 лет.
                            </p>
                        </div>
                    )}
                    <button type="submit" className="btn-v4" style={{ marginTop: '10px' }}>Sign In</button>
                </form>
                <p style={{ marginTop: '20px', fontSize: '12px', opacity: 0.5, cursor: 'pointer', textDecoration: 'underline', color: 'black' }} onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
                    {authMode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
                </p>
                <button type="button" onClick={enterGuestMode} style={{ marginTop: '14px', width: '100%', background: 'transparent', border: '1px solid rgba(0,0,0,0.15)', color: 'black', opacity: 0.6, padding: '10px', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', display: GUEST_MODE_ENABLED ? 'block' : 'none' }}>
                    Не входить (гостевой режим)
                </button>
            </div>
        </div>
    );

    return (
        <div className={`os-root ${perfMode === 'fast' ? 'perf-fast' : ''}`}>
            <style>{`
                .splash { height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #000; }
                .splash-logo { width: 80px; height: 80px; background: var(--accent); border-radius: 22px; display: flex; align-items: center; justify-content: center; font-size: 42px; font-weight: 900; color: white; animation: pulse 2s infinite; }
                @keyframes loading { 0% { width: 0%; left: 0%; } 50% { width: 100%; left: 0%; } 100% { width: 0%; left: 100%; } }
                @keyframes pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.05); opacity: 0.8; } }
                .island-nav { position: fixed; top: 15px; right: 15px; z-index: 1000; display: flex; align-items: center; gap: 12px; padding: 6px 15px; border-radius: 50px; }
                .launcher-grid { position: fixed; top: 75px; right: 15px; width: 300px; padding: 25px; border-radius: 25px; z-index: 999; }
                .app-card { display: flex; flex-direction: column; align-items: center; gap: 5px; position: relative; }
                .app-card span { color: var(--text); }
                .del-app { position: absolute; top: -5px; right: 5px; background: #ff4d4d; color: white; border: none; border-radius: 50%; width: 20px; height: 20px; font-size: 12px; cursor: pointer; opacity: 0; transition: 0.2s; z-index: 10; }
                .app-card:hover .del-app { opacity: 1; }
                .animate-in { animation: slideUp 0.4s cubic-bezier(0, 0.55, 0.45, 1); }

                /* Быстрый режим — для слабых устройств: без блюра, теней, анимаций.
                   backdrop-filter особенно тяжёлый на бюджетных телефонах. */
                .perf-fast * {
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                    box-shadow: none !important;
                    animation: none !important;
                    transition: none !important;
                }
                @keyframes slideUp { from { transform: translateY(20px); } to { transform: translateY(0); } }

                /* Категоризированные настройки — боковая навигация + панель контента */
                .settings-shell {
                    width: 100%; max-width: 760px; height: min(600px, 85vh);
                    border-radius: 30px; display: flex; overflow: hidden; padding: 0;
                }
                .settings-cats {
                    width: 220px; flex-shrink: 0; border-right: 1px solid var(--border-light);
                    padding: 20px 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;
                }
                .settings-title { margin: 0 8px 14px; font-size: 18px; }
                .settings-cat-btn {
                    display: flex; align-items: center; gap: 10px; background: none; border: none;
                    color: inherit; text-align: left; padding: 10px 10px; border-radius: 14px;
                    cursor: pointer; font-size: 13px; opacity: 0.75;
                }
                .settings-cat-btn:hover { background: rgba(255,255,255,0.06); opacity: 1; }
                .settings-cat-btn.active { background: var(--accent); color: #fff; opacity: 1; }
                .settings-cat-btn.back-only { margin-top: auto; opacity: 0.5; font-size: 12px; }
                .settings-content { flex: 1; padding: 30px; overflow-y: auto; text-align: center; position: relative; }
                .settings-pane h3 { margin-top: 0; text-align: left; }
                .settings-pane { text-align: center; }
                .settings-empty { opacity: 0.4; padding-top: 60px; }

                .support-pane { text-align: left; }
                .support-textarea { resize: vertical; min-height: 110px; font-family: inherit; margin-bottom: 14px; }
                .support-send-btn { width: 100%; margin-bottom: 28px; }
                .support-history-title { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.5; margin-bottom: 12px; }
                .support-history-item { background: var(--mica-low); border: 1px solid var(--border-light); border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
                .support-history-item-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; gap: 10px; }
                .support-history-item-date { font-size: 11px; opacity: 0.5; }
                .support-history-item-text { font-size: 13px; line-height: 1.5; color: var(--text); white-space: pre-wrap; word-break: break-word; }
                .support-status-pill { font-size: 11px; font-weight: 600; padding: 2px 9px; border-radius: 20px; background: rgba(0, 120, 212, 0.12); color: var(--accent); }
                .support-status-pill.resolved { background: rgba(0, 200, 130, 0.12); color: #00a86b; }
                .settings-mobile-back { display: none; }
                .settings-save-btn { width: 100%; margin-top: 10px; }

                @media (max-width: 700px) {
                    .settings-shell { flex-direction: column; height: 85vh; border-radius: 24px; }
                    .settings-cats { width: 100%; flex-direction: row; flex-wrap: wrap; border-right: none; border-bottom: 1px solid var(--border-light); }
                    .settings-content { display: none; }
                    .settings-shell.category-open .settings-cats { display: none; }
                    .settings-shell.category-open .settings-content { display: block; }
                    .settings-mobile-back { display: block; background: none; border: none; color: inherit; opacity: 0.6; font-size: 13px; margin-bottom: 14px; cursor: pointer; padding: 0; }
                }
.launcher-grid { 
    position: fixed; 
    top: 75px; 
    right: 15px; 
    width: 320px; 
    padding: 20px; 
    border-radius: 25px; 
    z-index: 999; 
    display: flex; 
    flex-direction: column;
    max-height: 85vh; 
    overflow: hidden;
}
.launcher-scroll-area {
    overflow-y: auto;
    padding-right: 5px;
    max-height: 475px; 
}
.launcher-scroll-area::-webkit-scrollbar {
    width: 4px;
}
.launcher-scroll-area::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 10px;
}
.launcher-scroll-area::-webkit-scrollbar-track {
    background: transparent;
}
            `}</style>

            <header className="island-nav block-v1" style={{ border: '1px solid var(--border-light)' }}>
                <div className="user-av" style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', cursor: 'pointer', overflow: 'hidden' }} onClick={() => menuMode === 'semi' ? setLauncherOpen(!launcherOpen) : setView('settings')}>
                    {user.avatar ? <img src={user.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : user.username[0].toUpperCase()}
                </div>
                {menuMode !== 'semi' && (
                    <div style={{ lineHeight: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 800 }}>{user.username}</div>
                        {!user.isGuest && <div style={{ fontSize: 10, opacity: 0.5 }}>{balance} pc</div>}
                    </div>
                )}
                <button className="btn-v6" style={{ fontSize: 22 }} onClick={() => setLauncherOpen(!launcherOpen)}>⠿</button>
            </header>

            {launcherOpen && (
                <div className="block-v1 launcher-grid animate-in" style={{ border: '1px solid var(--border-light)', boxShadow: 'var(--shadow-elevated)' }}>
                    <div className="launcher-scroll-area">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '15px' }}>
                            {user.apps.map((app, i) => (
                                <div key={app.id} className="app-card" draggable onDragStart={() => setDraggedIdx(i)} onDragEnd={() => setDraggedIdx(null)} onDragOver={e => e.preventDefault()} onDrop={() => handleAppReorder(i)}>
                                    <button className="del-app" onClick={(e) => { e.stopPropagation(); sync({...user, apps: user.apps.filter(a => a.id !== app.id)}); }}>×</button>
                                    <div className="app-icon" style={{ width: 60, height: 60, background: 'white', borderRadius: 16, display: 'flex', justifyContent: 'center', alignItems: 'center', fontSize: 26, boxShadow: 'var(--shadow-flat)', cursor: 'pointer' }} onClick={() => {
                                        if(app.url === 'sys:settings') setView('settings');
                                        else if (app.url) window.location.href = app.url;
                                        setLauncherOpen(false);
                                    }}>{app.icon}</div>
                                    <span style={{ fontSize: 10, fontWeight: 600, textAlign: 'center' }}>{app.name}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                        <button className="btn-v4" style={{ flex: 1, borderRadius: 12 }} onClick={() => { setModalOpen(true); setLauncherOpen(false); }}>+ Shortcut</button>
                        <button className="btn-v2" style={{ flex: 1, borderRadius: 12 }} onClick={() => { setBookmarksPickerOpen(true); setLauncherOpen(false); }}>📑 Базовые</button>
                    </div>
                </div>
            )}

            {modalOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(10px)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="block-v1 animate-in" style={{ width: 320, padding: 30, borderRadius: 30 }}>
                        <h3>New Item</h3>
                        <input className="inp-v1" placeholder="Name" value={newApp.name} onChange={e => setNewApp({...newApp, name: e.target.value})} style={{ marginBottom: 10 }} />
                        <input className="inp-v1" placeholder="URL" value={newApp.url} onChange={e => setNewApp({...newApp, url: e.target.value})} style={{ marginBottom: 15 }} />
                        <div style={{ 
                            display: 'grid', 
                            gridTemplateColumns: 'repeat(5, 1fr)', 
                            gap: '10px', 
                            marginBottom: 25, 
                            maxHeight: '120px', 
                            overflowY: 'auto',
                            padding: '10px',
                            background: '#050505',
                            borderRadius: '12px'
                        }}>
                            {["🏠", "💬", "👥", "📢", "📄", "📚", "📑", "🔍", "💻", "🛠️", "🧪", "🚀", "📂", "📦", "💾", "🌐", "🎮", "⚙️", "🔐", "📊", "📱", "📷", "🎥", "🎵", "🎨", "🎬", "🎤", "🎧", "🧩", "👾", "🌡️", "🔋", "🔌", "📡", "🧭", "☁️", "🛡️", "🔑", "💡", "🔔"].map(i => (
                                <span 
                                    key={i} 
                                    onClick={() => setNewApp({...newApp, icon: i})} 
                                    style={{ 
                                        cursor: 'pointer', 
                                        fontSize: '24px',
                                        textAlign: 'center',
                                        padding: '5px',
                                        borderRadius: '8px',
                                        background: newApp.icon === i ? 'rgba(0, 112, 243, 0.2)' : 'transparent',
                                        border: newApp.icon === i ? '1px solid #0070f3' : '1px solid transparent',
                                        transition: '0.2s'
                                    }}
                                >
                                    {i}
                                </span>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button className="btn-v4" style={{ flex: 1 }} onClick={() => {
                                if(!newApp.name || !newApp.url) return;
                                sync({...user, apps: [...user.apps, {...newApp, id: Date.now().toString()}]});
                                setModalOpen(false);
                            }}>Create</button>
                            <button className="btn-v5" style={{ flex: 1 }} onClick={() => setModalOpen(false)}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {bookmarksPickerOpen && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(10px)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div className="block-v1 animate-in" style={{ width: 340, padding: 25, borderRadius: 30 }}>
                        <h3 style={{ marginTop: 0 }}>Базовые закладки</h3>
                        <p style={{ fontSize: 12, opacity: 0.5, marginBottom: 14 }}>Все текущие подсайты ParrotOS — тапните, чтобы добавить.</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto', marginBottom: 15 }}>
                            {DEFAULT_BOOKMARKS.map(bm => {
                                const already = (user.apps || []).some(a => a.url === bm.url);
                                return (
                                    <button key={bm.id} className="btn-v2" disabled={already} style={{ display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', opacity: already ? 0.4 : 1 }} onClick={() => addBookmark(bm)}>
                                        <span style={{ fontSize: 18 }}>{bm.icon}</span> {bm.name} {already && <span style={{ marginLeft: 'auto', fontSize: 11 }}>добавлено</span>}
                                    </button>
                                );
                            })}
                        </div>
                        <button className="btn-v5" style={{ width: '100%' }} onClick={() => setBookmarksPickerOpen(false)}>Закрыть</button>
                    </div>
                </div>
            )}

            {view === 'settings' && (
                <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                    <div className={`block-v1 animate-in settings-shell ${settingsCategory ? 'category-open' : ''}`}>
                        <div className="settings-cats">
                            <h2 className="settings-title">Settings</h2>
                            {[
                                { id: 'personalization', icon: '🧑', label: 'Персонализация' },
                                { id: 'appearance', icon: '🎨', label: 'Внешний вид' },
                                { id: 'language', icon: '🌐', label: 'Язык' },
                                { id: 'account', icon: '🔐', label: 'Аккаунт и баланс' },
                                { id: 'bookmarks', icon: '📑', label: 'Закладки' },
                                { id: 'support', icon: '🛟', label: 'Поддержка' },
                            ].map(cat => (
                                <button key={cat.id} className={`settings-cat-btn ${settingsCategory === cat.id ? 'active' : ''}`} onClick={() => setSettingsCategory(cat.id)}>
                                    <span>{cat.icon}</span>{cat.label}
                                </button>
                            ))}
                            <button className="settings-cat-btn back-only" onClick={() => setView('main')}>
                                <span>←</span>Назад в ParrotSoft
                            </button>
                        </div>

                        <div className={`settings-content ${settingsCategory ? 'open' : ''}`}>
                            <button className="settings-mobile-back" onClick={() => setSettingsCategory(null)}>← Категории</button>

                            {settingsCategory === 'personalization' && (
                                <div className="settings-pane">
                                    <h3>Персонализация</h3>
                                    <div className="user-av" style={{ width: 80, height: 80, margin: '0 auto 12px', fontSize: 32, borderRadius: '50%', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: 'bold', overflow: 'hidden' }}>
                                        {user.avatar ? <img src={user.avatar} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : user.username[0].toUpperCase()}
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, marginBottom: 15 }}>
                                        <label className="btn-v2" style={{ flex: 1, textAlign: 'center', cursor: 'pointer' }}>
                                            {avatarUploading ? '...' : '📁 Загрузить фото'}
                                            <input type="file" accept="image/*" hidden onChange={handleAvatarFile} />
                                        </label>
                                    </div>
                                    <p style={{ fontSize: 11, opacity: 0.5, margin: '-10px 0 15px' }}>
                                        Аватарка хранится отдельно от остального профиля (не в зашифрованном виде) — так её могут показывать другие страницы вроде WavyChat.
                                    </p>
                                    <div style={{ textAlign: 'left', marginBottom: 15 }}>
                                        <label style={{ fontSize: 12, opacity: 0.6, display: 'block', marginBottom: 4 }}>Дата рождения</label>
                                        <input
                                            className="inp-v1"
                                            type="date"
                                            max={new Date().toISOString().split('T')[0]}
                                            value={editForm.birthDate}
                                            onChange={e => setEditForm({ ...editForm, birthDate: e.target.value })}
                                            style={{ width: '100%' }}
                                        />
                                        {editForm.birthDate && calcAge(editForm.birthDate) !== null && (
                                            <p style={{ fontSize: 11, opacity: 0.5, margin: '4px 0 0' }}>Возраст: {calcAge(editForm.birthDate)} лет</p>
                                        )}
                                        {calcAge(editForm.birthDate) >= 18 && calcAge(user.birthDate) < 18 && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '10px' }}>
                                                <input 
                                                    type="checkbox" 
                                                    id="confirm_18" 
                                                    checked={is18Confirmed} 
                                                    onChange={e => setIs18Confirmed(e.target.checked)} 
                                                />
                                                <label htmlFor="confirm_18" style={{ fontSize: 12, opacity: 0.8, cursor: 'pointer' }}>
                                                    Подтверждаю, что мне действительно есть 18 лет
                                                </label>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {settingsCategory === 'appearance' && (
                                <div className="settings-pane">
                                    <h3>Внешний вид</h3>
                                    <div style={{ textAlign: 'left', marginBottom: 15 }}>
                                        <label style={{ fontSize: 12, opacity: 0.6, display: 'block', marginBottom: 6 }}>Тема</label>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <button className={themeMode === 'light' ? 'btn-v4' : 'btn-v2'} style={{ flex: 1, fontSize: 12 }} onClick={() => changeThemeMode('light')}>☀️ Светлая</button>
                                            <button className={themeMode === 'dark' ? 'btn-v4' : 'btn-v2'} style={{ flex: 1, fontSize: 12 }} onClick={() => changeThemeMode('dark')}>🌙 Тёмная</button>
                                        </div>
                                        <p style={{ fontSize: 11, opacity: 0.5, margin: '4px 0 0' }}>Тёмная тема — общая для всего сайта, применяется и в WavyChat.</p>
                                    </div>

                                    <div style={{ textAlign: 'left', marginBottom: 15 }}>
                                        <label style={{ fontSize: 12, opacity: 0.6, display: 'block', marginBottom: 6 }}>Меню сверху</label>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <button className={menuMode === 'expanded' ? 'btn-v4' : 'btn-v2'} style={{ flex: 1, fontSize: 12 }} onClick={() => changeMenuMode('expanded')}>Развёрнутое</button>
                                            <button className={menuMode === 'semi' ? 'btn-v4' : 'btn-v2'} style={{ flex: 1, fontSize: 12 }} onClick={() => changeMenuMode('semi')}>Полускрытое</button>
                                        </div>
                                        <p style={{ fontSize: 11, opacity: 0.5, margin: '4px 0 0' }}>Полускрытое — только аватарка и кнопка, без имени и баланса.</p>
                                    </div>

                                    <div style={{ textAlign: 'left', marginBottom: 20 }}>
                                        <label style={{ fontSize: 12, opacity: 0.6, display: 'block', marginBottom: 6 }}>Производительность</label>
                                        <div style={{ display: 'flex', gap: 8 }}>
                                            <button className={perfMode === 'basic' ? 'btn-v4' : 'btn-v2'} style={{ flex: 1, fontSize: 12 }} onClick={() => changePerfMode('basic')}>Обычная</button>
                                            <button className={perfMode === 'fast' ? 'btn-v4' : 'btn-v2'} style={{ flex: 1, fontSize: 12 }} onClick={() => changePerfMode('fast')}>Быстрая</button>
                                        </div>
                                        <p style={{ fontSize: 11, opacity: 0.5, margin: '4px 0 0' }}>Быстрая отключает размытие, тени и анимации — заметно легче для старых телефонов.</p>
                                    </div>
                                </div>
                            )}

                            {settingsCategory === 'language' && (
                                <div className="settings-pane">
                                    <h3>Язык</h3>
                                    <p style={{ fontSize: 12, opacity: 0.6, marginBottom: 12 }}>Общий язык по умолчанию — отдельные приложения (например WavyChat) используют его при первом заходе, а дальше могут переключить свой независимо.</p>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <button className={globalLang === 'en' ? 'btn-v4' : 'btn-v2'} style={{ flex: 1 }} onClick={() => changeGlobalLang('en')}>English</button>
                                        <button className={globalLang === 'ru' ? 'btn-v4' : 'btn-v2'} style={{ flex: 1 }} onClick={() => changeGlobalLang('ru')}>Русский</button>
                                    </div>
                                </div>
                            )}

                            {settingsCategory === 'account' && (
                                <div className="settings-pane">
                                    <h3>Аккаунт и баланс</h3>
                                    {user?.isGuest && (
                                        <div style={{ background: 'rgba(255,180,0,0.12)', border: '1px solid rgba(255,180,0,0.3)', borderRadius: 14, padding: 14, marginBottom: 20 }}>
                                            <p style={{ fontSize: 13, margin: '0 0 10px' }}>
                                                Это гостевой аккаунт. Все его данные хранятся только в этом браузере/на этом устройстве, не на сервере.
                                                {localStorage.getItem('p_guest_permanent') === '1'
                                                    ? ' Автоудаление по таймауту отключено — аккаунт сохранён навсегда (но по-прежнему только локально).'
                                                    : ' Если не заходить на сайт 30 минут, аккаунт и все его данные будут удалены.'}
                                            </p>
                                            {localStorage.getItem('p_guest_permanent') !== '1' && (
                                                <button className="btn-v2" style={{ width: '100%' }} onClick={makeGuestPermanent}>
                                                    💾 Сохранить аккаунт навсегда (локально)
                                                </button>
                                            )}
                                        </div>
                                    )}
                                    <input className="inp-v1" type="password" placeholder="New Password" disabled={user?.isGuest} onChange={e => setEditForm({...editForm, pass: e.target.value})} style={{ marginBottom: 20 }} />
                                    {!user?.isGuest && (
                                    <div style={{ background: 'rgba(255,255,255,0.05)', padding: '15px', borderRadius: '20px', marginBottom: '20px' }}>
                                        <p style={{ fontSize: '14px', opacity: 0.7, marginBottom: '10px' }}>
                                            Current Balance: <b>{balance} pc</b>
                                        </p>
                                        <div style={{ display: 'flex', gap: '10px' }}>
                                            <input 
                                                className="inp-v1" 
                                                type="number" 
                                                placeholder="Amount..." 
                                                id="add_amount"
                                                style={{ flex: 1, marginBottom: 0 }} 
                                            />
                                            <button className="btn-v4" style={{ width: 'auto', padding: '0 20px' }} onClick={async () => {
                                                const amountInput = document.getElementById('add_amount');
                                                const amount = amountInput.value;
                                                if (!amount || amount <= 0) return alert("Please enter a valid amount!");
                                                const orderID = await dbActions.createPaySession(user.username, amount);
                                                if (orderID) {
                                                    const payUrl = `https://www.sandbox.paypal.com/checkoutnow?token=${orderID}`;
                                                    const payWin = window.open(payUrl, 'PayPal', 'width=450,height=600');
                                                    const timer = setInterval(async () => {
                                                        if (payWin.closed) {
                                                            clearInterval(timer);
                                                            const res = await dbActions.finalizeAndAddBalance(orderID, user.username);
                                                            if (res.success) {
                                                                setBalance(res.newBalance);
                                                                amountInput.value = '';
                                                                alert(`Balance updated! New balance: ${res.newBalance} pc`);
                                                            } else {
                                                                alert("The server could not confirm the payment from PayPal.");
                                                            }
                                                        }
                                                    }, 1000);
                                                } else {
                                                    alert("An error occurred while creating the payment session.");
                                                }
                                            }}>
                                                Add Pey Coins
                                            </button>
                                        </div>
                                    </div>
                                    )}
                                    {TOTP_ENABLED && (
                                      <>
                                        <h3 style={{ marginTop: 24, fontSize: 15 }}>🔐 Двухфакторная аутентификация</h3>
                                        <TotpSettings username={user?.username} />
                                      </>
                                    )}

                                    <button className="btn-v5" style={{ width: '100%', color: 'red', marginTop: 20 }} onClick={() => { localStorage.clear(); window.location.reload(); }}>Logout</button>
                                </div>
                            )}

                            {settingsCategory === 'bookmarks' && (
                                <div className="settings-pane">
                                    <h3>Закладки</h3>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto', marginBottom: 15, textAlign: 'left' }}>
                                        {(user.apps || []).map(a => (
                                            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'rgba(255,255,255,0.05)', borderRadius: 12 }}>
                                                <span style={{ fontSize: 18 }}>{a.icon}</span>
                                                <span style={{ flex: 1, fontSize: 13 }}>{a.name}</span>
                                                <button className="btn-v5" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => removeBookmark(a.id)}>✕</button>
                                            </div>
                                        ))}
                                        {!(user.apps || []).length && <p style={{ opacity: 0.5, fontSize: 12 }}>Закладок пока нет.</p>}
                                    </div>
                                    <button className="btn-v4" style={{ width: '100%' }} onClick={addAllMissingBookmarks}>📑 Добавить базовые закладки</button>
                                </div>
                            )}

                            {settingsCategory === 'support' && (
                                <div className="settings-pane support-pane">
                                    <h3>Поддержка</h3>
                                    <p style={{ opacity: 0.6, fontSize: 13, marginTop: -6, marginBottom: 18 }}>
                                        Опиши проблему или вопрос — сообщение увидит команда поддержки. Это открытое обращение, не зашифрованная переписка.
                                    </p>
                                    <textarea
                                        className="inp-v1 support-textarea"
                                        placeholder="Например: не получается загрузить видео на WavyTube — пишет ошибку на середине загрузки…"
                                        value={supportText}
                                        onChange={e => setSupportText(e.target.value)}
                                        rows={5}
                                    />
                                    <button
                                        className="btn-v4 support-send-btn"
                                        onClick={handleSendSupport}
                                        disabled={supportSending || !supportText.trim()}
                                    >
                                        {supportSending ? 'Отправляю…' : '🛟 Отправить в поддержку'}
                                    </button>

                                    <div className="support-history">
                                        <div className="support-history-title">Твои обращения</div>
                                        {supportHistory === null && <p style={{ opacity: 0.5, fontSize: 12 }}>Загрузка…</p>}
                                        {supportHistory?.length === 0 && <p style={{ opacity: 0.5, fontSize: 12 }}>Обращений пока не было.</p>}
                                        {supportHistory?.map(m => (
                                            <div key={m.id} className="support-history-item">
                                                <div className="support-history-item-top">
                                                    <span className={`support-status-pill ${m.status}`}>{m.status === 'resolved' ? '✅ решено' : '🕓 в очереди'}</span>
                                                    <span className="support-history-item-date">{new Date(Number(m.timestamp)).toLocaleString('ru-RU')}</span>
                                                </div>
                                                <div className="support-history-item-text">{m.text}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {!settingsCategory && (
                                <div className="settings-pane settings-empty">
                                    <p>Выберите раздел слева.</p>
                                </div>
                            )}

                            {settingsCategory && settingsCategory !== 'account' && settingsCategory !== 'bookmarks' && settingsCategory !== 'support' && (
                                <button className="btn-v4 settings-save-btn" onClick={async () => {
                                    let updated = { ...user };
                                    if (editForm.birthDate) {
                                        const newAge = calcAge(editForm.birthDate);
                                        const oldAge = calcAge(user.birthDate);
                                        if (newAge >= 18 && oldAge < 18 && !is18Confirmed) {
                                            return alert("Пожалуйста, подтвердите галочкой, что вам действительно есть 18 лет!");
                                        }
                                        updated.birthDate = editForm.birthDate;
                                        if (dbActions?.setUserBirthDate) {
                                            await dbActions.setUserBirthDate(user.username, editForm.birthDate);
                                        }
                                    }
                                    await sync(updated);
                                }}>Save</button>
                            )}
                            {settingsCategory === 'account' && (
                                <button className="btn-v4 settings-save-btn" onClick={async () => {
                                    let updated = { ...user };
                                    if (editForm.pass) {
                                        updated.token = await generateKey(editForm.pass);
                                        localStorage.setItem('p_token', updated.token);
                                    }
                                    await sync(updated);
                                }}>Save</button>
                            )}
                        </div>
                    </div>
                </div>
            )}
            <main>
                {children}
            </main>
        </div>
    );
}
