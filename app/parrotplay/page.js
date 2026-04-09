'use client';
import { useState, useEffect } from 'react';
import { getMarketItems, uploadApp, deleteApp, addReview,addBalance, getReviews, buyApp, getBalance, checkOwnership } from '../actions';

export default function ParrotPlay() {
  const [apps, setApps] = useState([]);
  const [user, setUser] = useState("Guest"); 
  const [balance, setBalanceState] = useState(0);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [selectedApp, setSelectedApp] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [reviewForm, setReviewForm] = useState({ rating: 5, comment: '' });
  const [form, setForm] = useState({ name: '', pkg: '', desc: '', type: 'App', icon: '', price: 0, custom_ui: '', versions: [] });
  const [curV, setCurV] = useState({ id: '', name: '', os: 'ParrotOS', arch: 'x64', link: '', isPrimary: false });
  const [ownedApps, setOwnedApps] = useState([]);

  useEffect(() => { 
      const localUser = localStorage.getItem('p_user') || "Developer";
      setUser(localUser);
      refresh(localUser); 
  }, []);

  async function refresh(currentUser = user) { 
      setApps(await getMarketItems()); 
      setBalanceState(await getBalance(currentUser));
  }

  const handleIcon = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onloadend = () => setForm({...form, icon: reader.result});
    reader.readAsDataURL(file);
  };

  const openApp = async (app) => {
      setSelectedApp(app);
      setReviews(await getReviews(app.pkg_name));
  };

  const submitReview = async () => {
      if (!reviewForm.comment) return;
      await addReview(selectedApp.pkg_name, user, reviewForm.rating, reviewForm.comment);
      setReviewForm({ rating: 5, comment: '' });
      openApp(selectedApp);
      refresh();
  };

  const handleInstallOrBuy = async (version) => {
      if (!version || !version.link) return alert("Link missing.");
      const isOwned = await checkOwnership(user, selectedApp.pkg_name);
      const isAuthor = selectedApp.author === user;

      if (selectedApp.price > 0 && !isAuthor && !isOwned) {
          const confirmBuy = window.confirm(`Купить за ${selectedApp.price} PC?`);
          if (!confirmBuy) return;
          await buyApp(selectedApp.pkg_name, user, selectedApp.author, selectedApp.price);
          alert("Успешно куплено!");
          refresh();
      } else {
          window.open(version.link);
      }
  };

  const openEditMode = () => {
      setForm({
          name: selectedApp.display_name,
          pkg: selectedApp.pkg_name,
          desc: selectedApp.description || '',
          type: selectedApp.type,
          icon: selectedApp.icon,
          price: selectedApp.price || 0,
          custom_ui: selectedApp.custom_ui || '',
          versions: selectedApp.os_versions || []
      });
      setSelectedApp(null);
      setIsAddOpen(true);
  };

  return (
    <div style={st.container}>
      <aside style={st.sidebar}>
        <div style={st.sideBtn}>🏠</div>
        <div style={st.sideBtn} onClick={() => refresh()}>🔄</div>
        <div style={{...st.sideBtn, marginTop: 'auto', background: '#0078d4'}} onClick={() => {
            setForm({ name: '', pkg: '', desc: '', type: 'App', icon: '', price: 0, custom_ui: '', versions: [] });
            setIsAddOpen(true);
        }}>+</div>
      </aside>

      <main style={st.main}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 25 }}>
            <h1 style={{fontWeight: 600, fontSize: 24, margin: 0}}>Store</h1>
            <div style={{ background: '#111', padding: '8px 15px', borderRadius: 20, border: '1px solid #333', fontSize: 14 }}>
                💎 {balance} PC
            </div>
        </div>
        
        <div style={st.grid}>
          {apps.map(app => (
            <div key={app.pkg_name} style={st.card} onClick={() => openApp(app)}>
              <div style={st.iconBox}>{app.icon ? <img src={app.icon} style={st.img}/> : '📦'}</div>
              <div style={{flex: 1}}>
                <div style={{fontWeight: 600}}>{app.display_name}</div>
                <div style={{fontSize: 11, opacity: 0.5}}>{app.author}</div>
                <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 4}}>
                    <span style={{color: '#ffb900', fontSize: 11}}>★ {app.rating.toFixed(1)}</span>
                    <span style={{color: '#0078d4', fontSize: 11, fontWeight: 'bold'}}>{app.price > 0 ? `${app.price} PC` : 'Бесплатно'}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
      {selectedApp && (
        <div style={st.overlay} onClick={() => setSelectedApp(null)}>
          <div style={st.appPage} onClick={e => e.stopPropagation()}>
            {selectedApp.custom_ui ? (
                <div dangerouslySetInnerHTML={{ __html: selectedApp.custom_ui }} />
            ) : (
                <div style={{display: 'flex', gap: 20}}>
                  <div style={st.largeIcon}>{selectedApp.icon ? <img src={selectedApp.icon} style={st.img}/> : '📦'}</div>
                  <div style={{flex: 1}}>
                    <h2 style={{margin: 0}}>{selectedApp.display_name}</h2>
                    <div style={{color: '#0078d4', fontSize: 12}}>{selectedApp.pkg_name}</div>
                    <div style={{display: 'flex', gap: 15, margin: '10px 0', fontSize: 12, opacity: 0.8}}>
                        <span>Installations: {selectedApp.installs || 0}</span>
                        <span style={{color: '#ffb900'}}>★ {selectedApp.rating.toFixed(1)} ({selectedApp.rev_count})</span>
                    </div>
                    <p style={{fontSize: 14, opacity: 0.8}}>{selectedApp.description || 'Description missing.'}</p>
                    
                    {selectedApp.os_versions.filter(v => v.isPrimary).map((v, i) => (
                        <button key={i} style={st.installBtnMain} onClick={() => handleInstallOrBuy(v)}>
                            {selectedApp.price > 0 && selectedApp.author !== user ? `Buy for ${selectedApp.price} PC` : 'Install'} ({v.os})
                        </button>
                    ))}
                  </div>
                </div>
            )}
            {selectedApp.author === user && (
                <div style={{display: 'flex', gap: 10, marginTop: 15, padding: 10, background: '#111', borderRadius: 8}}>
                    <button style={st.btnSec} onClick={openEditMode}>✏️ Edit</button>
                    <button style={{...st.btnSec, color: '#ff4d4d'}} onClick={() => deleteApp(selectedApp.pkg_name, user).then(() => {setSelectedApp(null); refresh();})}>🗑 Delete</button>
                </div>
            )}
            <hr style={{borderColor: '#222', margin: '20px 0'}} />
            <h4>All Versions`1`:</h4>
            <div style={st.verList}>
              {selectedApp.os_versions.map((v, i) => (
                <div key={i} style={st.verItem}>
                  <span>{v.name || `Build ${i+1}`} ({v.os}) {v.isPrimary && '⭐'}</span>
                  <button style={st.installBtn} onClick={() => handleInstallOrBuy(v)}>Download</button>
                </div>
              ))}
            </div>
            <hr style={{borderColor: '#222', margin: '20px 0'}} />
            <h4>Reviews:</h4>
            <div style={{display: 'flex', gap: 10, marginBottom: 15}}>
                <select style={{...st.input, width: '80px', marginBottom: 0}} value={reviewForm.rating} onChange={e => setReviewForm({...reviewForm, rating: Number(e.target.value)})}>
                    <option value="5">5 ★</option><option value="4">4 ★</option><option value="3">3 ★</option><option value="2">2 ★</option><option value="1">1 ★</option>
                </select>
                <input placeholder="Your comment..." style={{...st.input, marginBottom: 0}} value={reviewForm.comment} onChange={e => setReviewForm({...reviewForm, comment: e.target.value})} />
                <button style={st.btnMain} onClick={submitReview}>Submit</button>
            </div>
            <div style={{maxHeight: 150, overflowY: 'auto'}}>
                {reviews.map(r => (
                    <div key={r.id} style={{background: '#111', padding: 10, borderRadius: 8, marginBottom: 5, fontSize: 12}}>
                        <div style={{display: 'flex', justifyContent: 'space-between', color: '#888', marginBottom: 5}}>
                            <span>{r.username}</span><span style={{color: '#ffb900'}}>{'★'.repeat(r.rating)}</span>
                        </div>
                        <div>{r.comment}</div>
                    </div>
                ))}
            </div>

          </div>
        </div>
      )}
      {isAddOpen && (
        <div style={st.overlay}>
          <div style={st.modal}>
            <h3>{form.pkg ? 'Edit' : 'Publish'}</h3>
            <div style={{display: 'flex', gap: 10, marginBottom: 15}}>
              <label style={st.iconLabel}>
                {form.icon ? <img src={form.icon} style={st.img}/> : '+'}
                <input type="file" hidden onChange={handleIcon} />
              </label>
              <div style={{flex: 1}}>
                <input placeholder="Name" value={form.name} style={st.input} onChange={e => setForm({...form, name: e.target.value})} />
                <input placeholder="ID (com.xxx.yyy)" disabled={!!selectedApp} value={form.pkg} style={st.input} onChange={e => setForm({...form, pkg: e.target.value})} />
              </div>
            </div>
            
            <div style={{display: 'flex', gap: 10}}>
                <input type="number" placeholder="Price (PC)" value={form.price} style={{...st.input, flex: 1}} onChange={e => setForm({...form, price: Number(e.target.value)})} />
                <select style={{...st.input, flex: 1}} value={form.type} onChange={e => setForm({...form, type: e.target.value})}>
                    <option>App</option><option>Game</option><option>Tool</option>
                </select>
            </div>

            <textarea placeholder="Description..." value={form.desc} style={{...st.input, height: 60}} onChange={e => setForm({...form, desc: e.target.value})} />
            <textarea placeholder="Custom UI Code (HTML/CSS) - Optional" value={form.custom_ui} style={{...st.input, height: 60, fontFamily: 'monospace', fontSize: 10}} onChange={e => setForm({...form, custom_ui: e.target.value})} />

            <div style={st.buildCreator}>
              <div style={{display: 'flex', gap: 5}}>
                <input placeholder="Version Name" style={st.miniInp} value={curV.name} onChange={e => setCurV({...curV, name: e.target.value})} />
                <select style={st.miniInp} value={curV.os} onChange={e => setCurV({...curV, os: e.target.value})}>
                  <option>ParrotOS</option><option>PS-Dos</option><option>Web</option><option>Windows 7</option><option>Windows 10/11</option><option>Windows XP</option><option>Windows old/9x</option>
                  <option>Android 16</option><option>Android 12</option><option>Android 10</option><option>Android 8</option><option>Android 6</option><option>Android 5</option><option>Android Old</option>
                  <option>Linux Ubuntu 22.04</option><option>Linux Ubuntu 18.04</option><option>Linux Ubuntu 25.04</option><option>Linux Ubuntu old</option><option>Linux Debian 13</option><option>Linux Debian 10</option>
                  <option>Linux Debian 12</option><option>Linux Debian 10</option><option>Linux Debian old</option><option>Linux old</option><option>Windows 10/11 arm</option><option>Windows ubuntu arm</option>
                  <option>Windows Debian arm</option><option>Linux 2</option><option>Linux 3</option><option>Linux 4</option><option>Linux 5</option><option>Linux 6</option>
                </select>
                <input placeholder="Link" style={st.miniInp} value={curV.link} onChange={e => setCurV({...curV, link: e.target.value})} />
              </div>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 5}}>
                  <label style={{fontSize: 10}}><input type="checkbox" checked={curV.isPrimary} onChange={e => setCurV({...curV, isPrimary: e.target.checked})} /> Make Primary (Main Button)</label>
                  <button style={st.addBtn} onClick={() => {
                    if(!curV.link) return;
                    setForm({...form, versions: [...form.versions, {...curV, id: Date.now()}]});
                    setCurV({id:'', name:'', os:'ParrotOS', arch:'x64', link:'', isPrimary: false});
                  }}>Добавить билд</button>
              </div>
              
              <div style={st.buildStack}>
                {form.versions.map(v => (
                  <div key={v.id} style={st.stackItem}>
                    <span>{v.name} ({v.os}) {v.isPrimary && '⭐'}</span>
                    <span style={{color: 'red', cursor: 'pointer'}} onClick={() => setForm({...form, versions: form.versions.filter(x => x.id !== v.id)})}>✖</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{display: 'flex', gap: 10, marginTop: 20}}>
              <button style={st.btnMain} onClick={() => uploadApp({...form, author: user}).then(() => {setIsAddOpen(false); refresh();})}>Сохранить</button>
              <button style={st.btnSec} onClick={() => setIsAddOpen(false)}>Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const st = {
  container: { display: 'flex', background: '#000', color: '#fff', height: '100vh', fontFamily: 'Segoe UI, system-ui', overflow: 'hidden' },
  sidebar: { width: 68, background: '#0a0a0a', borderRight: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0', zIndex: 10 },
  sideBtn: { width: 42, height: 42, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', marginBottom: 15, background: '#111' },
  main: { flex: 1, padding: '40px', overflowY: 'auto' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 },
  card: { background: '#0f0f0f', padding: 15, borderRadius: 12, border: '1px solid #1a1a1a', display: 'flex', gap: 15, cursor: 'pointer' },
  iconBox: { width: 50, height: 50, background: '#1a1a1a', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, overflow: 'hidden' },
  img: { width: '100%', height: '100%', objectFit: 'cover' },
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 100 },
  modal: { background: '#111', padding: 25, borderRadius: 12, width: 450, border: '1px solid #333', maxHeight: '90vh', overflowY: 'auto' },
  appPage: { background: '#0a0a0a', padding: 40, borderRadius: 16, width: 650, border: '1px solid #222', maxHeight: '90vh', overflowY: 'auto' },
  largeIcon: { width: 100, height: 100, background: '#111', borderRadius: 20, border: '1px solid #333', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 },
  input: { width: '100%', background: '#1a1a1a', border: '1px solid #333', color: '#fff', padding: 10, borderRadius: 6, marginBottom: 8, fontSize: 13 },
  buildCreator: { background: '#070707', padding: 10, borderRadius: 8, border: '1px solid #222' },
  miniInp: { background: '#111', border: '1px solid #333', color: '#fff', fontSize: 11, padding: 6, flex: 1, borderRadius: 4 },
  addBtn: { background: '#333', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontSize: 10 },
  buildStack: { marginTop: 10, maxHeight: 100, overflowY: 'auto' },
  stackItem: { display: 'flex', justifyContent: 'space-between', fontSize: 11, background: '#1a1a1a', padding: '5px 10px', borderRadius: 4, marginBottom: 3 },
  btnMain: { flex: 1, background: '#fff', color: '#000', border: 'none', padding: 12, borderRadius: 6, fontWeight: 'bold', cursor: 'pointer' },
  btnSec: { flex: 1, background: '#222', color: '#fff', border: 'none', padding: 12, borderRadius: 6, cursor: 'pointer' },
  installBtnMain: { background: '#0078d4', color: '#fff', border: 'none', padding: '10px 20px', borderRadius: 8, fontSize: 13, fontWeight: 'bold', cursor: 'pointer', marginTop: 15, display: 'block' },
  verList: { background: '#111', borderRadius: 10, padding: 10 },
  verItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #222', fontSize: 12 },
  installBtn: { background: '#333', color: '#fff', border: 'none', padding: '4px 15px', borderRadius: 15, fontSize: 11, fontWeight: 'bold', cursor: 'pointer' },
  iconLabel: { width: 70, height: 70, background: '#1a1a1a', border: '1px dashed #333', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden' }
};