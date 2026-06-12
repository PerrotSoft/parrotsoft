'use client';
import { useState, useEffect, useRef } from 'react';
import * as actions from '../actions';
import CallWindow from './CallWindow';
const ALL_EMOJIS = [
  "💻", "🖥️", "⌨️", "🖱️", "💾", "💿", "📀", "📡", "🔋", "🔌", "⚙️", "🔧", "🔨", "🔩", "🏗️", "🧱",
  "📦", "📂", "📁", "📄", "📃", "📑", "📊", "📈", "📉", "🔍", "🔎", "🔐", "🔓", "🔑", "🛡️", "🧬",
  "🤖", "👾", "👽", "🚀", "🛸", "🛰️", "🚠", "🚥", "🚦", "⚠️", "🚫", "✅", "❌", "💯", "🆙", "🆕",
  "💬", "💭", "🗯️", "🗨️", "🗨️", "👋", "🤝", "👑", "👤", "👥", "🗣️", "📢", "📣", "🔔", "🔕",
  "⭐", "🌟", "✨", "🔥", "☄️", "💥", "⚡", "🌈", "☀️", "🌙", "❄️", "💧", "🌊", "🍃", "🌵",
  "🎉", "🎊", "🎈", "🎂", "🎁", "🏅", "🏆", "🎮", "🕹️", "🎰", "🎲", "🎯", "🎨", "🎭", "🎼",
  "🦜", "🐦", "🕊️", "🦅", "🦉", "🦆", "🦢", "🦋", "🐛", "🐝", "🐞", "🐾", "🐕", "🐈", "🐠",
  "😀", "😃", "😄", "😁", "😆", "😅", "😂", "🤣", "😊", "😇", "🙂", "🙃", "😉", "😌", "😍",
  "🥰", "😘", "😗", "😙", "😚", "😋", "😛", "😝", "😜", "🤪", "🤨", "🧐", "🤓", "😎", "🤩",
  "🥳", "😏", "😒", "😞", "😔", "😟", "😕", "🙁", "☹️", "😣", "😖", "😫", "😩", "🥺", "😢",
  "😭", "😤", "😠", "😡", "🤬", "🤯", "😳", "🥵", "🥶", "😱", "😨", "😰", "😥", "😓", "🤔"
];
export default function WevyChat() {
    const [active, setActive] = useState(null);
    const [msgs, setMsgs] = useState([]);
    const [text, setText] = useState("");
    const [pendingFiles, setPendingFiles] = useState([]); 
    const [selected, setSelected] = useState([]); 
    const [showEmoji, setShowEmoji] = useState(false);
    const [loading, setLoading] = useState(false);
    const [currentUser, setCurrentUser] = useState(null);
    const [searchResults, setSearchResults] = useState([]);
    const [myChats, setMyChats] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [isRecording, setIsRecording] = useState(false);
    const [recorder, setRecorder] = useState(null);
    const fileRef = useRef(null);
    const scrollRef = useRef(null);
    const [targetChatId, setTargetChatId] = useState(null);
    const groupIconRef = useRef(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [isSidebarVisible, setIsSidebarVisible] = useState(true);
    const [inCall, setInCall] = useState(false);
    const [activeCallInfo, setActiveCallInfo] = useState(null);
    const [isCalling, setIsCalling] = useState(false); // Для исходящего вызова
    const [newChatData, setNewChatData] = useState({
        title: "",
        type: "group",
        privacy: "public",
        password: "",
        icon: null
    });
    const handleIconUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setNewChatData({...newChatData, icon: reader.result});
            };
            reader.readAsDataURL(file);
        }
    };
    useEffect(() => {
        let saved = localStorage.getItem('p_user');;
        setCurrentUser(saved);
        loadMyChats(saved);
    }, []);
    // Проверка, идет ли сейчас звонок в этом чате
    useEffect(() => {
        const checkCalls = async () => {
            if (!active) return;
            try {
                const call = await actions.checkActiveCall(active.id);
                setActiveCallInfo(call);
            } catch (e) {
                console.error("Call check error:", e);
            }
        };

        checkCalls();
        const interval = setInterval(checkCalls, 5000); // Проверяем раз в 5 секунд
        return () => clearInterval(interval);
    }, [active]);
    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [msgs]);
    useEffect(() => {
        let interval;
        
        const updateMsgs = async () => {
            if (active) {
                const newMsgs = await actions.getMsgs(active.id);
                setMsgs(prev => prev.length !== newMsgs.length ? newMsgs : prev);
            }
        };

        updateMsgs();
        interval = setInterval(updateMsgs, 3000);

        return () => clearInterval(interval);
    }, [active]);
    const handleCreateChat = async () => {
        if (!newChatData.title.trim()) return alert("Enter chat name");
        if (newChatData.privacy === 'private' && !newChatData.password.trim()) {
            return alert("Password is required for private chat!");
        }

        setLoading(true);
        try {
            await actions.createChat(
                newChatData.title, 
                currentUser, 
                newChatData.type, 
                newChatData.privacy,
                newChatData.icon,    
                newChatData.password 
            );
            
            setShowCreateModal(false);
            setNewChatData({ title: "", type: "group", privacy: "public", password: "", icon: null });
            await loadMyChats(currentUser);
        } catch (e) {
            alert("Error during creation: " + e.message);
        } finally {
            setLoading(false);
        }
    };
    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mediaRecorder = new MediaRecorder(stream);
            const chunks = [];

            mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
            mediaRecorder.onstop = async () => {
                const blob = new Blob(chunks, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(blob);
                reader.onloadend = () => {
                    const base64Audio = reader.result;
                    setPendingFiles(prev => [...prev, { 
                        name: `Voice_${new Date().toLocaleTimeString()}.webm`, 
                        data: base64Audio, 
                        type: 'audio/webm' 
                    }]);
                };
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            setRecorder(mediaRecorder);
            setIsRecording(true);
        } catch (err) {
            alert("Microphone not available: " + err);
        }
    };

    const stopRecording = () => {
        if (recorder) {
            recorder.stop();
            setIsRecording(false);
        }
    };
    const loadMyChats = async (username) => {
        if (!username) return;
        const res = await actions.getMyChats(username);
        setMyChats(res);
    };

    const onFileChange = (e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            const reader = new FileReader();
            reader.onloadend = () => {
                setPendingFiles(prev => [...prev, {
                    name: file.name,
                    type: file.type,
                    data: reader.result
                }]);
            };
            reader.readAsDataURL(file);
        });
        e.target.value = "";
    };

    const onSend = async () => {
        if ((!text.trim() && pendingFiles.length === 0) || !active || !currentUser) return;
        
        setLoading(true);
        try {
            await actions.sendMsg(active.id, currentUser, text, pendingFiles);
            
            setText(""); 
            setPendingFiles([]); 

            const updatedMsgs = await actions.getMsgs(active.id);
            setMsgs(updatedMsgs);
        } catch (e) {
            alert("Sending error: " + e.message);
        } finally {
            setLoading(false);
        }
    };
    const handleJoinChat = async (chat) => {
        try {
            let password = null;
            if (chat.privacy === 'private') {
                password = prompt("Enter password:");
                if (!password) return;
                await actions.checkChatAccess(chat.id, password);
            }

            setLoading(true);
            await actions.joinChat(chat.id, currentUser);
            setMyChats(prev => {
                if (prev.find(c => c.id === chat.id)) return prev;
                return [...prev, chat];
            });
            setActive(chat);
            setSearchQuery("");
            setSearchResults([]);
            
        } catch (e) {
            alert("Error: " + e.message);
        } finally {
            setLoading(false);
        }
    };
    const toggleSelect = (id) => {
        setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    };
    const addEmoji = (emoji) => {
        setText(prev => prev + emoji);
    };
    const deleteSelected = async () => {
        if (!confirm(`Delete ${selected.length} messages?`)) return;
        await actions.deleteMsgs(selected);
        setSelected([]);
        const updatedMsgs = await actions.getMsgs(active.id);
        setMsgs(updatedMsgs);
    };
    const handleStartCall = async () => {
        if (!active || !currentUser) return;
        await actions.startCallNotification(active.id, currentUser);
        setInCall(true);
    };

    const handleJoinCall = () => {
        setInCall(true);
    };
    
    const handleEndCall = async () => {
        if (active) {
            await actions.endCallNotification(active.id);
        }
        setInCall(false);
    };
    const onIconChange = async (e, chatId) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onloadend = async () => {
            await actions.updateChatIcon(chatId, reader.result); 
            loadMyChats(currentUser);
        };
        reader.readAsDataURL(file);
    };
    return (
        <div className="app">
            <button className={`toggle-sidebar-btn ${isSidebarVisible ? "" : "collapsed"}`} onClick={() => setIsSidebarVisible(!isSidebarVisible)}>
                {isSidebarVisible ? "◀" : "▶"}
            </button>

            <aside className={`sidebar ${isSidebarVisible ? "" : "hidden"}`}>
                <div className="user-card">WavyChat</div>
                
                <div className="sidebar-tools">
                    <input 
                        className="search-input"
                        placeholder="Search groups..." 
                        value={searchQuery}
                        onChange={async (e) => {
                            setSearchQuery(e.target.value);
                            if(e.target.value.length > 0) {
                                const res = await actions.searchGlobal(e.target.value);
                                setSearchResults(res);
                            } else {
                                setSearchResults([]);
                            }
                        }}
                    />
                    <button className="create-btn" onClick={() => setShowCreateModal(true)}>+</button>
                </div>

                <div className="chat-list">
                    {searchResults.map(c => (
                        <div key={c.id} className="search-item">
                            <div className="avatar">
                                {c.icon ? (
                                    <img src={c.icon} alt="" className="avatar-img" />
                                ) : (
                                    <span className="avatar-letter">💬</span>
                                )}
                            </div>
                            <div className="info">
                                <strong className="chat-title">{c.title}</strong>
                                <button className="join-action" onClick={() => handleJoinChat(c)}>Join</button>
                            </div>
                        </div>
                    ))}

                    <small className="section-title">My Chats</small>
                    {myChats.map(c => (
                        <div key={c.id} className={`chat-item ${active?.id === c.id ? 'active' : ''}`} 
                            onClick={() => { setActive(c); actions.getMsgs(c.id).then(setMsgs); }}>
                            <div className="avatar">
                                {c.icon ? (
                                    <img src={c.icon} alt="" className="avatar-img" />
                                ) : (
                                    <span className="avatar-letter">{c.title[0]}</span>
                                )}
                            </div>

                            <div className="info">
                                <strong>{c.title}</strong>
                                <div className="admin-controls">
                                    {c.admin === currentUser && (
                                        <>
                                            <button onClick={(e) => { 
                                                e.stopPropagation(); 
                                                const n = prompt("New name:", c.title);
                                                if(n) actions.renameChat(c.id, n).then(() => loadMyChats(currentUser));
                                            }}>✏️</button>
                                            
                                            <button onClick={(e) => {
                                                e.stopPropagation();
                                                if(confirm("Delete group permanently?")) 
                                                    actions.deleteChat(c.id).then(() => { setActive(null); loadMyChats(currentUser); });
                                            }}>🗑️</button>

                                           <button onClick={(e) => {
                                                e.stopPropagation();
                                                setTargetChatId(c.id); 
                                                groupIconRef.current.click(); 
                                            }}>🖼️</button>
                                            
                                        </>
                                    )}
                                    <button onClick={async (e) => {
                                        e.stopPropagation();
                                        if(confirm(`Leave group "${c.title}"?`)) {
                                            await actions.leaveChat(c.id, currentUser);
                                            if (active?.id === c.id) setActive(null);
                                            loadMyChats(currentUser);
                                        }
                                    }}>🚪 Leave</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </aside>
            {showCreateModal && (
                <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <h3 style={{color: '#0070f3', marginBottom: '15px'}}>Create Chat</h3>
                        
                        <div className="form-item">
                            <input 
                                className="modal-input"
                                placeholder="Name..." 
                                value={newChatData.title}
                                onChange={e => setNewChatData({...newChatData, title: e.target.value})}
                            />
                        </div>
                        <div className="form-item">
                            <label className="file-label">
                                {newChatData.icon ? "✅ Icon selected" : "📁 Choose icon"}
                                <input type="file" accept="image/*" onChange={handleIconUpload} style={{display: 'none'}} />
                            </label>
                        </div>
                        {newChatData.privacy === 'private' && (
                            <input 
                                className="modal-input"
                                type="password"
                                placeholder="Create a password for private chat..." 
                                value={newChatData.password}
                                onChange={e => setNewChatData({...newChatData, password: e.target.value})}
                            />
                        )}
                        <div style={{display: 'flex', gap: '10px', marginBottom: '15px'}}>
                            <select className="modal-select" value={newChatData.type} onChange={e => setNewChatData({...newChatData, type: e.target.value})}>
                                <option value="group">Group</option>
                                <option value="channel">Channel</option>
                            </select>
                            <select className="modal-select" value={newChatData.privacy} onChange={e => setNewChatData({...newChatData, privacy: e.target.value})}>
                                <option value="public">Public</option>
                                <option value="private">Private</option>
                            </select>
                        </div>

                        <div style={{display: 'flex', gap: '10px'}}>
                            <button className="cancel-btn" style={{flex: 1}} onClick={() => setShowCreateModal(false)}>Cancel</button>
                            <button className="confirm-btn" style={{flex: 1, background: '#0070f3', border: 'none', color: '#fff', borderRadius: '8px', cursor: 'pointer'}} onClick={handleCreateChat}>Create</button>
                        </div>
                    </div>
                </div>
            )}
            <main className="chat-area">
                {active ? (
                    <>
                        <header className="chat-header">
                            <div className="header-info">
                                <strong>{active.title}</strong>
                                <span> {msgs.length} messages</span>
                                <div className="call-controls" style={{ display: 'flex', gap: '10px' }}>
                                    {!inCall && !activeCallInfo && (
                                        <button onClick={handleStartCall} className="call-btn start">📞</button>
                                    )}

                                    {!inCall && activeCallInfo && (
                                        <button onClick={handleJoinCall} className="call-btn join">📞 Join</button>
                                    )}
                                </div>
                            </div>

                            {selected.length > 0 && (
                                <div className="batch-actions">
                                    <button onClick={deleteSelected} className="del-btn">Delete ({selected.length})</button>
                                    <button onClick={() => setSelected([])} className="cancel-btn">Cancel</button>
                                </div>
                            )}
                        </header>

                        <div className="messages" ref={scrollRef}>
                            {msgs.map(m => {
                                const files = typeof m.media === 'string' ? JSON.parse(m.media) : [];

                                return (
                                    <div key={m.id} 
                                         className={`msg-wrapper ${m.sender === currentUser ? 'me' : ''} ${selected.includes(m.id) ? 'selected' : ''}`}
                                         onClick={() => toggleSelect(m.id)}>
                                        
                                        <div className="bubble">
                                            <div className="sender">{m.sender}</div>
                                            
                                            {files.length > 0 && (
                                                <div className="attachment-grid">
                                                    {files.map((file, idx) => (
                                                        <div key={idx} className="file-item">
                                                            {file.type.startsWith('image/') ? (
                                                                <img src={file.data} alt="" onClick={(e) => { e.stopPropagation(); window.open(file.data); }} />
                                                            ) : file.type.startsWith('video/') ? (
                                                                <video src={file.data} controls onClick={e => e.stopPropagation()} />
                                                            ) : file.type.startsWith('audio/') ? (
                                                                <audio src={file.data} controls onClick={e => e.stopPropagation()} />
                                                            ): (
                                                                <a href={file.data} download={file.name} className="doc-file" onClick={e => e.stopPropagation()}>
                                                                    📦 <span>{file.name}</span>
                                                                    <small>Download</small>
                                                                </a>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}

                                            {m.text && <div className="text">{m.text}</div>}
                                            <div className="time">{new Date(m.time).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="input-panel">
                            {pendingFiles.length > 0 && (
                                <div className="attachment-preview">
                                    {pendingFiles.map((f, i) => (
                                        <div key={i} className="chip">
                                            {f.name.slice(0,10)}... <button onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}>×</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                            
                            <div className="input-row">
                                <button className="tool-btn" onClick={() => setShowEmoji(!showEmoji)}>😊</button>
                                <button className="tool-btn" onClick={() => fileRef.current.click()}>📎</button>
                                <button 
                                        className={`voice-btn ${isRecording ? 'recording' : ''}`}
                                        onMouseDown={startRecording}
                                        onMouseUp={stopRecording}
                                        onTouchStart={startRecording}
                                        onTouchEnd={stopRecording}
                                        title="Hold to record voice"
                                    >
                                        {isRecording ? '🛑' : '🎤'}
                                    </button>
                                <input 
                                    value={text} 
                                    onChange={e => setText(e.target.value)} 
                                    onKeyDown={e => e.key === 'Enter' && onSend()}
                                    placeholder="Message..."
                                />
                                
                                <button className="send-btn" onClick={onSend} disabled={loading}>
                                    {loading ? '...' : '➤'}
                                </button>
                            </div>

                            {showEmoji && (
                                <div className="emoji-picker">
                                    <div className="emoji-grid">
                                        {ALL_EMOJIS.map((emoji, index) => (
                                        <span 
                                            key={index} 
                                            className="emoji-item" 
                                            onClick={() => addEmoji(emoji)}
                                        >
                                            {emoji}
                                        </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                            <input type="file" ref={fileRef} multiple hidden onChange={onFileChange} />
                        </div>
                    </>
                ) : <div className="empty">Select a chat to start communicating</div>}
            </main>
                <input 
                type="file" 
                ref={groupIconRef} 
                hidden 
                accept="image/*"
                onChange={(e) => {
                    if (targetChatId) {
                        onIconChange(e, targetChatId);
                        e.target.value = ""; 
                        setTargetChatId(null);
                    }
                }} 
            />
            {inCall && activeCallInfo && (
                <CallWindow 
                    currentUser={currentUser} 
                    activeCall={activeCallInfo} 
                    onEnd={handleEndCall} 
                />
            )}
            <style jsx>{`
                .app { display: flex; height: 100vh; background: #000; color: #fff; font-family: 'Segoe UI', sans-serif; overflow: hidden; }
                .sidebar { width: 320px; border-right: 1px solid #111; background: #050505; display: flex; flex-direction: column; }
                .user-card { padding: 20px; border-bottom: 1px solid #111; color: #0070f3; font-weight: bold; }
                .chat-list { flex: 1; overflow-y: auto; }
                .chat-item { display: flex; gap: 15px; padding: 15px; cursor: pointer; transition: 0.2s; align-items: center; }
                .chat-item:hover { background: #0f0f0f; }
                .chat-item.active { background: #111; border-left: 3px solid #0070f3; }
                .avatar {
                    width: 45px;   
                    height: 45px;
                    background: #222;  
                    border-radius: 50%;  
                    display: flex;
                    align-items: center; 
                    justify-content: center;
                    overflow: hidden;
                    position: relative;
                }
                .call-btn {
                    border: none;
                    border-radius: 8px;
                    padding: 8px 15px;
                    cursor: pointer;
                    font-weight: bold;
                    transition: 0.3s;
                }
                .call-btn.start { background: #222; color: #0070f3; }
                .call-btn.join { 
                    background: #0070f3; 
                    color: white; 
                    animation: pulse-blue 2s infinite; 
                }

                @keyframes pulse-blue {
                    0% { box-shadow: 0 0 0 0 rgba(0, 112, 243, 0.4); }
                    70% { box-shadow: 0 0 0 10px rgba(0, 112, 243, 0); }
                    100% { box-shadow: 0 0 0 0 rgba(0, 112, 243, 0); }
                }
                .search-item {
                    display: flex;
                    align-items: center;
                    padding: 10px;
                    gap: 12px;
                }
                .avatar img { width: 60%;height: 60%;object-fit: contain; border-radius: 4px;display: block; }
                .chat-area { flex: 1; display: flex; flex-direction: column; background: #000; position: relative; }
                .chat-header { padding: 15px 25px; border-bottom: 1px solid #111; display: flex; justify-content: space-between; align-items: center; }
                .del-btn { background: #ff4d4d; border: none; color: white; padding: 8px 15px; border-radius: 8px; cursor: pointer; font-weight: bold; margin-right: 10px; }
                .cancel-btn { background: #333; border: none; color: white; padding: 8px 15px; border-radius: 8px; cursor: pointer; }
                .sidebar-tools { padding: 10px; display: flex; gap: 8px; border-bottom: 1px solid #111; }
                .search-input { flex: 1; background: #111; border: 1px solid #222; border-radius: 8px; padding: 8px 12px; color: #fff; font-size: 13px; outline: none; }
                .create-btn { background: #0070f3; border: none; color: white; width: 34px; height: 34px; border-radius: 8px; cursor: pointer; font-size: 20px; }
                .section-title { padding: 10px 15px; display: block; opacity: 0.5; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
                .join-action { background: #0070f3; border: none; color: white; padding: 4px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; margin-top: 5px; }
                .messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 10px; }
                .msg-wrapper { max-width: 75%; align-self: flex-start; cursor: pointer; transition: 0.2s; }
                .msg-wrapper.me { align-self: flex-end; }
                .bubble { background: #111; padding: 10px 15px; border-radius: 18px; position: relative; }
                .me .bubble { background: #0070f3; color: white; }
                .sender { font-size: 11px; opacity: 0.6; margin-bottom: 4px; }
                .time { font-size: 10px; opacity: 0.4; text-align: right; margin-top: 5px; }
                .attachment-grid { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 5px; }
                .file-item img { max-width: 200px; border-radius: 10px; display: block; }
                .file-item video { max-width: 250px; border-radius: 10px; }
                .doc-file { background: rgba(255,255,255,0.1); padding: 10px; border-radius: 12px; display: flex; flex-direction: column; text-decoration: none; color: #fff; }
                .input-panel { padding: 20px; border-top: 1px solid #111; }
                .input-row { display: flex; gap: 15px; align-items: center; }
                .input-row input { flex: 1; background: #111; border: 1px solid #222; padding: 12px 20px; border-radius: 25px; color: #fff; outline: none; }
                .tool-btn { background: none; border: none; font-size: 20px; cursor: pointer; }
                .send-btn { background: none; border: none; color: #0070f3; font-size: 24px; cursor: pointer; }
                .emoji-picker {
                    position: absolute;
                    bottom: 80px;
                    left: 20px;
                    width: 300px;         
                    height: 200px;        
                    background: #1e1e2e; 
                    border: 1px solid #333;
                    border-radius: 12px;
                    padding: 10px;
                    box-shadow: 0 8px 25px rgba(0,0,0,0.7);
                    display: flex;
                    z-index: 100;
                }
                .emoji-grid {
                    display: grid;
                    grid-template-columns: repeat(6, 1fr);
                    gap: 8px;
                    width: 100%;
                    overflow-y: auto;
                    padding-right: 5px;
                }
                .emoji-item {
                    font-size: 20px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 5px;
                    transition: transform 0.1s, background 0.2s;
                    border-radius: 5px;
                }
                .emoji-item:hover {
                    background: #313244;  
                    transform: scale(1.2); 
                }
                .emoji-grid::-webkit-scrollbar {
                    width: 6px;
                }
                .emoji-grid::-webkit-scrollbar-track {
                    background: #181825;
                    border-radius: 10px;
                }
                .emoji-grid::-webkit-scrollbar-thumb {
                    background: #45475a;
                    border-radius: 10px;
                }
                .emoji-grid::-webkit-scrollbar-thumb:hover {
                    background: #585b70;
                }
                .attachment-preview { display: flex; gap: 10px; margin-bottom: 10px; }
                .chip { background: #111; border: 1px solid #0070f3; padding: 5px 10px; border-radius: 15px; font-size: 11px; }
                .empty { margin: auto; opacity: 0.2; font-size: 20px; font-weight: bold; }
                .voice-btn {
                    background: transparent;
                    border: none;
                    font-size: 20px;
                    cursor: pointer;
                    transition: transform 0.2s, color 0.2s;
                    user-select: none; 
                }

                .voice-btn.recording {
                    color: #ff4d4d;
                    transform: scale(1.3);
                    animation: pulse-red 1.5s infinite;
                }

                @keyframes pulse-red {
                    0% { filter: drop-shadow(0 0 2px rgba(255, 77, 77, 0.7)); }
                    50% { filter: drop-shadow(0 0 15px rgba(255, 77, 77, 0.9)); }
                    100% { filter: drop-shadow(0 0 2px rgba(255, 77, 77, 0.7)); }
                }
                    .admin-controls {
                    display: flex;
                    gap: 5px;
                    margin-top: 5px;
                    opacity: 0;
                    transition: 0.2s;
                }
                .chat-item:hover .admin-controls {
                    opacity: 1;
                }
                .admin-controls button {
                    background: #222;
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    font-size: 10px;
                    padding: 2px 5px;
                }
                .admin-controls button:hover {
                    background: #333;
                }
                .modal-overlay {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0,0,0,0.8);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                }
                .modal-content {
                    background: #111;
                    padding: 20px;
                    border-radius: 15px;
                    width: 300px;
                    border: 1px solid #333;
                }
                .modal-input, .modal-select {
                    width: 100%;
                    background: #050505;
                    border: 1px solid #222;
                    color: white;
                    padding: 8px;
                    border-radius: 8px;
                    outline: none;
                }
                .info {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    overflow: hidden;
                }

                .chat-title {
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis; 
                }

                .join-action {
                    width: fit-content;
                    padding: 4px 12px;
                    background: #0070f3;
                    border: none;
                    border-radius: 6px;
                    color: white;
                    cursor: pointer;
                    font-size: 12px;
                }
                /* Внутри <style jsx> */
                .batch-actions {
                    display: flex; /* Делаем контейнер флексовым */
                    gap: 15px;      /* Увеличиваем расстояние между кнопками "Удалить" и "Отмена" */
                    right: 140px;   /* Увеличьте это значение (было 125px), чтобы сдвинуть весь блок влево */
                    position: relative; /* Убедитесь, что позиционирование работает корректно */
                }
                .modal-select { flex: 1; }
                .toggle-sidebar-btn {
                    position: fixed;
                    left: ${isSidebarVisible ? '320px' : '0px'};
                    top: 20px;
                    z-index: 1001;
                    background: #050505;
                    border: 1px solid #111;
                    border-left: none;
                    color: #0070f3;
                    width: 30px;
                    height: 40px;
                    border-radius: 0 8px 8px 0;
                    cursor: pointer;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 5px 0 15px rgba(0,0,0,0.5);
                }

                .toggle-sidebar-btn:hover {
                    color: #fff;
                    background: #0070f3;
                }
                .sidebar {
                    width: 320px;
                    min-width: 320px;
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                    overflow-x: hidden;
                    white-space: nowrap;
                }

                .sidebar.hidden {
                    width: 0;
                    min-width: 0;
                    border-right: none;
                    opacity: 0;
                }

                .chat-item {
                    margin: 5px 10px;
                    border-radius: 12px;
                    transition: background 0.2s, transform 0.1s;
                }

                .chat-item:active {
                    transform: scale(0.98);
                }

                .chat-item.active {
                    background: rgba(0, 112, 243, 0.15);
                    border-left: none; 
                    box-shadow: inset 0 0 0 1px #0070f3;
                }
                .search-input {
                    border: 1px solid #222;
                    transition: all 0.2s;
                }

                .search-input:focus {
                    border-color: #0070f3;
                    background: #111;
                }
                    /* Мобильные стили */
                @media (max-width: 768px) {
                    .sidebar {
                        /* Делаем сайдбар перекрывающим контент, когда он открыт */
                        position: fixed;
                        z-index: 1000;
                        height: 100%;
                        width: 85%; /* Оставляем кусочек чата видимым сбоку */
                        min-width: 85%;
                    }

                    .sidebar.hidden {
                        width: 0;
                        min-width: 0;
                        transform: translateX(-100%); /* Прячем за экран */
                    }

                    .toggle-sidebar-btn {
                        /* Сдвигаем кнопку переключателя, чтобы она всегда была под рукой */
                        left: ${isSidebarVisible ? '85%' : '0px'};
                        width: 40px;
                        height: 50px;
                        top: 10px;
                    }

                    .chat-area {
                        width: 100%;
                    }

                    .chat-header {
                        padding: 10px 15px;
                        flex-direction: column; /* Заголовок и кнопки в две строки */
                        align-items: flex-start;
                        gap: 10px;
                    }

                    .batch-actions {
                        position: static; /* Возвращаем в общий поток */
                        width: 100%;
                        justify-content: flex-end;
                    }

                    .msg-wrapper {
                        max-width: 90%; /* Сообщения пошире на узком экране */
                    }

                    .input-panel {
                        padding: 10px;
                    }

                    .input-row {
                        gap: 8px;
                    }

                    .input-row input {
                        padding: 10px 15px;
                        font-size: 14px;
                    }

                    .tool-btn, .voice-btn, .send-btn {
                        font-size: 18px; /* Немного уменьшаем кнопки управления */
                    }

                    .emoji-picker {
                        width: 90%;
                        left: 5%;
                        right: 5%;
                        bottom: 70px;
                    }

                    .file-item img {
                        max-width: 100%; /* Картинки на всю ширину сообщения */
                    }
                }
            `}</style>
            
        </div>
    );
}