'use client';
import { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';

export default function CallWindow({ currentUser, activeCall, onEnd }) {
    const [status, setStatus] = useState("Инициализация...");
    const [participants, setParticipants] = useState([]);
    const [isMicMuted, setIsMicMuted] = useState(false);
    const [isCamOff, setIsCamOff] = useState(false);
    const [peerError, setPeerError] = useState(null);
    const [permissionError, setPermissionError] = useState("");
    
    const [audioDevices, setAudioDevices] = useState([]);
    const [videoDevices, setVideoDevices] = useState([]);
    const [showMicMenu, setShowMicMenu] = useState(false);
    const [showCamMenu, setShowCamMenu] = useState(false);
    const [activeAudioId, setActiveAudioId] = useState(null);
    const [activeVideoId, setActiveVideoId] = useState(null);

    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const screenStreamRef = useRef(null);
    const peerRef = useRef(null);
    const localStreamRef = useRef(null);
    const connectionsRef = useRef(new Map()); 
    const callsRef = useRef(new Map());        
    const videoRefs = useRef({});

    const isHost = currentUser === activeCall.caller;

    const createDummyStream = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 640; canvas.height = 480;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, 640, 480);
        const videoTrack = canvas.captureStream(1).getVideoTracks()[0];
        videoTrack.enabled = false;

        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const dest = audioCtx.createMediaStreamDestination();
        const audioTrack = dest.stream.getAudioTracks()[0];
        audioTrack.enabled = false;

        return new MediaStream([videoTrack, audioTrack]);
    };

    const getDevices = async () => {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
            setVideoDevices(devices.filter(d => d.kind === 'videoinput'));
        } catch (e) {
            console.error("Ошибка получения списка устройств", e);
        }
    };

    const initMedia = async (audioId = null, videoId = null) => {
        try {
            const constraints = {
                audio: audioId ? { deviceId: { exact: audioId } } : true,
                video: videoId ? { deviceId: { exact: videoId } } : true
            };
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            setPermissionError("");
            return stream;
        } catch (e) {
            console.warn("Нет доступа к камере/микрофону, используем заглушку", e);
            setPermissionError("Доступ к устройствам ограничен. Разрешите в настройках браузера!");
            setIsMicMuted(true);
            setIsCamOff(true);
            return createDummyStream();
        }
    };

    useEffect(() => {
        if (peerRef.current) return;

        const safeUser = currentUser.replace(/[^a-zA-Z0-9_-]/g, '');

        const myPeerId = isHost 
            ? safeUser 
            : `${safeUser}_${Math.random().toString(36).substring(2, 9)}`;
        
        const peer = new Peer(myPeerId, {
            config: { 'iceServers': [{ 'urls': 'stun:stun.l.google.com:19302' }] },
            debug: 1
        });
        peerRef.current = peer;

        peer.on('open', async (id) => {
            if (peer.destroyed) return;
            try {
                await navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(() => {});
                await getDevices();

                const stream = await initMedia();
                localStreamRef.current = stream;

                const aTrack = stream.getAudioTracks()[0];
                const vTrack = stream.getVideoTracks()[0];
                if (aTrack && aTrack.getSettings().deviceId) setActiveAudioId(aTrack.getSettings().deviceId);
                if (vTrack && vTrack.getSettings().deviceId) setActiveVideoId(vTrack.getSettings().deviceId);

                if (videoRefs.current['me']) {
                    videoRefs.current['me'].srcObject = stream;
                    videoRefs.current['me'].muted = true;
                }

                if (!isHost) {
                    const conn = peer.connect(activeCall.caller);
                    setupDataChannel(conn);
                    const call = peer.call(activeCall.caller, stream);
                    handleMediaCall(call);
                }
                setStatus(isHost ? "Организатор конференции" : "Подключено");
            } catch (e) { 
                setStatus("Критическая ошибка инициализации"); 
            }
        });

        peer.on('error', (err) => {
            if (err.type === 'unavailable-id') {
                setStatus("Ошибка: ID занят.");
                setPeerError("Сессия активна в другой вкладке. Подождите 5 секунд и обновите.");
            }
        });

        peer.on('connection', (conn) => setupDataChannel(conn));
        peer.on('call', (call) => {
            call.answer(localStreamRef.current);
            handleMediaCall(call);
        });

        const handleUnload = () => {
            if (peerRef.current) {
                connectionsRef.current.forEach(conn => {
                    if (conn.open) conn.send({ type: 'BYE', userId: peerRef.current.id });
                });
                peerRef.current.destroy();
            }
        };
        window.addEventListener('beforeunload', handleUnload);

        return () => {
            window.removeEventListener('beforeunload', handleUnload);
            if (peerRef.current) peerRef.current.destroy();
            localStreamRef.current?.getTracks().forEach(t => t.stop());
            peerRef.current = null;
        };
    }, []);

    const switchDevice = async (kind, deviceId) => {
        try {
            const constraints = kind === 'audio' 
                ? { audio: { deviceId: { exact: deviceId } } } 
                : { video: { deviceId: { exact: deviceId } } };
            
            const newStream = await navigator.mediaDevices.getUserMedia(constraints);
            const newTrack = kind === 'audio' ? newStream.getAudioTracks()[0] : newStream.getVideoTracks()[0];
            const oldTrack = kind === 'audio' ? localStreamRef.current.getAudioTracks()[0] : localStreamRef.current.getVideoTracks()[0];

            if (oldTrack) {
                localStreamRef.current.removeTrack(oldTrack);
                oldTrack.stop();
            }
            localStreamRef.current.addTrack(newTrack);

            callsRef.current.forEach(call => {
                const sender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === kind);
                if (sender) sender.replaceTrack(newTrack);
            });

            if (kind === 'audio') {
                setActiveAudioId(deviceId);
                setIsMicMuted(!newTrack.enabled);
                setShowMicMenu(false);
            } else {
                setActiveVideoId(deviceId);
                setIsCamOff(!newTrack.enabled);
                setShowCamMenu(false);
                if (videoRefs.current['me']) videoRefs.current['me'].srcObject = localStreamRef.current;
            }
            setPermissionError("");
        } catch (e) {
            console.error("Ошибка переключения устройства", e);
            setPermissionError("Не удалось переключить устройство. Проверьте разрешения.");
        }
    };

    const toggleScreenShare = async () => {
        try {
            if (!isScreenSharing) {
                const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
                screenStreamRef.current = stream;
                const screenTrack = stream.getVideoTracks()[0];

                callsRef.current.forEach(call => {
                    const sender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
                    if (sender) sender.replaceTrack(screenTrack);
                });

                if (videoRefs.current['me']) videoRefs.current['me'].srcObject = stream;
                screenTrack.onended = () => stopScreenShare();
                setIsScreenSharing(true);
            } else {
                stopScreenShare();
            }
        } catch (e) {
            console.error("Ошибка захвата экрана:", e);
        }
    };

    const stopScreenShare = () => {
        if (!localStreamRef.current) return;
        const videoTrack = localStreamRef.current.getVideoTracks()[0];

        callsRef.current.forEach(call => {
            const sender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) sender.replaceTrack(videoTrack);
        });

        if (videoRefs.current['me']) videoRefs.current['me'].srcObject = localStreamRef.current;
        screenStreamRef.current?.getTracks().forEach(t => t.stop());
        setIsScreenSharing(false);
    };

    const setupDataChannel = (conn) => {
        connectionsRef.current.set(conn.peer, conn);
        conn.on('data', (data) => {
            if (data.type === 'DIE') onEnd(); 
            if (data.type === 'BYE') removePeer(data.userId); 
            
            if (!isHost && data.type === 'PEER_LIST') {
                data.peers.forEach(id => {
                    if (id !== peerRef.current.id && !callsRef.current.has(id)) {
                        const call = peerRef.current.call(id, localStreamRef.current);
                        handleMediaCall(call);
                    }
                });
            }
        });

        if (isHost) {
            const allIds = [...Array.from(connectionsRef.current.keys()), peerRef.current.id];
            connectionsRef.current.forEach(c => c.open && c.send({ type: 'PEER_LIST', peers: allIds }));
        }
    };

    const handleMediaCall = (call) => {
        if (callsRef.current.has(call.peer)) return;
        callsRef.current.set(call.peer, call);
        
        call.on('stream', (remoteStream) => {
            setParticipants(prev => prev.includes(call.peer) ? prev : [...prev, call.peer]);
            setTimeout(() => {
                if (videoRefs.current[call.peer]) videoRefs.current[call.peer].srcObject = remoteStream;
            }, 500);
        });
        call.on('close', () => removePeer(call.peer));
    };

    const removePeer = (id) => {
        setParticipants(prev => prev.filter(p => p !== id));
        callsRef.current.delete(id);
        connectionsRef.current.delete(id);
    };

    const handleSmartExit = () => {
        if (isHost) {
            connectionsRef.current.forEach(conn => { if (conn.open) conn.send({ type: 'DIE' }); });
        } else {
            connectionsRef.current.forEach(conn => { if (conn.open) conn.send({ type: 'BYE', userId: peerRef.current.id }); });
        }
        
        if (peerRef.current) {
            peerRef.current.destroy();
        }
        
        setTimeout(() => { window.location.reload(); }, 300);
    };

    const toggleMic = async () => {
        let track = localStreamRef.current?.getAudioTracks()[0];
        if (!track || track.readyState === 'ended' || track.label === '') {
            await initMedia(activeAudioId, activeVideoId);
            track = localStreamRef.current?.getAudioTracks()[0];
        }
        if (track) { 
            track.enabled = !track.enabled; 
            setIsMicMuted(!track.enabled); 
        }
    };

    const toggleCam = async () => {
        let track = localStreamRef.current?.getVideoTracks()[0];
        if (!track || track.readyState === 'ended' || track.label === '') {
            await initMedia(activeAudioId, activeVideoId);
            track = localStreamRef.current?.getVideoTracks()[0];
        }
        if (track) { 
            track.enabled = !track.enabled; 
            setIsCamOff(!track.enabled); 
        }
    };

    const totalUsers = participants.length + 1;
    let gridClass = "grid-multi";
    if (totalUsers === 1) gridClass = "grid-single";
    else if (totalUsers === 2) gridClass = "grid-double";

    return (
        <div className="call-ui">
            <div className="top-bar">
                <div className="status-badge">
                    <span className="pulse-dot"></span>
                    {status}
                </div>
                <div className="room-info">Вызов: {activeCall.title || 'WavyChat'}</div>
            </div>

            {peerError && <div className="error-banner">{peerError}</div>}
            {permissionError && <div className="error-banner permission-warn">{permissionError}</div>}

            <div className={`video-container ${gridClass}`}>
                <div className="v-card">
                    {isCamOff ? (
                        <div className="avatar-placeholder">{currentUser[0].toUpperCase()}</div>
                    ) : (
                        <video 
                            ref={el => videoRefs.current['me'] = el} 
                            autoPlay playsInline muted 
                            style={{ transform: isScreenSharing ? 'scaleX(1)' : 'scaleX(-1)' }}
                        />
                    )}
                    <div className="user-label">Вы {isMicMuted && <span className="muted-icon">🔇</span>}</div>
                </div>

                {participants.map(id => (
                    <div key={id} className="v-card">
                        <video ref={el => videoRefs.current[id] = el} autoPlay playsInline />
                        <div className="user-label">{id.split('_')[0]}</div>
                    </div>
                ))}
            </div>

            <div className="controls-wrapper">
                <div className="controls-glass">
                    
                    {/* Кнопка Микрофона с меню */}
                    <div className="btn-group">
                        <button onClick={toggleMic} className={`ctrl-btn ${isMicMuted ? 'danger' : ''}`} title="Микрофон">
                            {isMicMuted ? '🔇' : '🎙️'}
                        </button>
                        <button className="ctrl-arrow" onClick={() => { setShowMicMenu(!showMicMenu); setShowCamMenu(false); getDevices(); }}>
                            ^
                        </button>
                        {showMicMenu && (
                            <div className="device-menu">
                                <div className="menu-title">Микрофон</div>
                                {audioDevices.length > 0 ? audioDevices.map(d => (
                                    <div key={d.deviceId} className={`menu-item ${activeAudioId === d.deviceId ? 'active' : ''}`} onClick={() => switchDevice('audio', d.deviceId)}>
                                        {d.label || `Микрофон ${d.deviceId.slice(0, 5)}...`}
                                    </div>
                                )) : <div className="menu-item disabled">Устройства не найдены</div>}
                            </div>
                        )}
                    </div>

                    {/* Кнопка Камеры с меню */}
                    <div className="btn-group">
                        <button onClick={toggleCam} className={`ctrl-btn ${isCamOff ? 'danger' : ''}`} title="Камера">
                            {isCamOff ? '🚫' : '📹'}
                        </button>
                        <button className="ctrl-arrow" onClick={() => { setShowCamMenu(!showCamMenu); setShowMicMenu(false); getDevices(); }}>
                            ^
                        </button>
                        {showCamMenu && (
                            <div className="device-menu">
                                <div className="menu-title">Камера</div>
                                {videoDevices.length > 0 ? videoDevices.map(d => (
                                    <div key={d.deviceId} className={`menu-item ${activeVideoId === d.deviceId ? 'active' : ''}`} onClick={() => switchDevice('video', d.deviceId)}>
                                        {d.label || `Камера ${d.deviceId.slice(0, 5)}...`}
                                    </div>
                                )) : <div className="menu-item disabled">Устройства не найдены</div>}
                            </div>
                        )}
                    </div>

                    <button onClick={toggleScreenShare} className={`ctrl-btn screen-btn ${isScreenSharing ? 'active' : ''}`} title="Демонстрация экрана">
                        {isScreenSharing ? '⏹️' : '🖥️'}
                    </button>
                    
                    <div className="divider"></div>
                    <button onClick={handleSmartExit} className="ctrl-btn exit" title="Завершить">
                        {isHost ? "Завершить" : "Выйти"}
                    </button>
                </div>
            </div>

            <style jsx>{`
                .call-ui {
                    position: fixed; inset: 0; background: #050505; z-index: 10000;
                    display: flex; flex-direction: column; font-family: 'Segoe UI', system-ui, sans-serif;
                }
                .top-bar {
                    position: absolute; top: 0; left: 0; width: 100%; padding: 20px;
                    display: flex; justify-content: space-between; align-items: center;
                    z-index: 10; pointer-events: none;
                }
                .status-badge {
                    background: rgba(20, 20, 25, 0.8); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.05);
                    padding: 8px 16px; border-radius: 20px; color: #fff; font-size: 13px;
                    display: flex; align-items: center; gap: 8px; font-weight: 500;
                }
                .pulse-dot {
                    width: 8px; height: 8px; background: #00ff95; border-radius: 50%;
                    box-shadow: 0 0 10px #00ff95; animation: pulse 2s infinite;
                }
                .room-info { color: rgba(255,255,255,0.6); font-size: 14px; font-weight: bold; background: rgba(20,20,25,0.8); padding: 5px 15px; border-radius: 12px; }

                @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }

                .error-banner {
                    position: absolute; top: 70px; left: 50%; transform: translateX(-50%);
                    background: #ea4335; color: white; padding: 10px 20px; border-radius: 8px;
                    z-index: 20; font-size: 13px; box-shadow: 0 4px 15px rgba(234, 67, 53, 0.4); text-align: center;
                }
                .permission-warn { background: #fbbc04; color: #000; box-shadow: 0 4px 15px rgba(251, 188, 4, 0.4); }

                .video-container {
                    flex: 1; padding: 80px 20px 100px 20px; display: grid; gap: 15px;
                    height: 100vh; overflow-y: auto; align-content: center;
                }
                .grid-single { grid-template-columns: 1fr; max-width: 900px; margin: 0 auto; width: 100%; height: 80vh; }
                .grid-double { grid-template-columns: repeat(2, 1fr); max-width: 1200px; margin: 0 auto; height: 70vh; }
                .grid-multi { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
                
                .v-card {
                    background: #111; border-radius: 16px; position: relative; overflow: hidden;
                    border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                    display: flex; align-items: center; justify-content: center;
                    aspect-ratio: 16/9; width: 100%; height: 100%;
                }
                video { width: 100%; height: 100%; object-fit: cover; }

                .avatar-placeholder {
                    width: 100px; height: 100px; border-radius: 50%;
                    background: linear-gradient(135deg, #333, #555);
                    display: flex; align-items: center; justify-content: center;
                    font-size: 40px; font-weight: bold; color: white; 
                }

                .user-label {
                    position: absolute; bottom: 15px; left: 15px;
                    background: rgba(0,0,0,0.7); backdrop-filter: blur(5px);
                    padding: 6px 14px; border-radius: 10px; font-size: 13px; color: #fff;
                    display: flex; align-items: center; gap: 6px; font-weight: 500;
                }
                .muted-icon { color: #ff4d4d; }

                /* Панель управления (Google Meet Style) */
                .controls-wrapper {
                    position: absolute; bottom: 30px; left: 0; width: 100%;
                    display: flex; justify-content: center; pointer-events: none; z-index: 50;
                }
                .controls-glass {
                    background: #202124; 
                    padding: 10px 20px; border-radius: 30px; display: flex; gap: 10px; align-items: center;
                    pointer-events: auto; box-shadow: 0 4px 15px rgba(0,0,0,0.5);
                }
                
                .btn-group { display: flex; align-items: center; position: relative; background: #3c4043; border-radius: 25px; margin: 0 5px;}
                
                .ctrl-btn {
                    width: 45px; height: 45px; border: none; border-radius: 50%;
                    background: transparent; color: #fff; font-size: 18px;
                    cursor: pointer; transition: all 0.2s ease; display: flex;
                    align-items: center; justify-content: center;
                }
                .ctrl-btn:hover { background: rgba(255,255,255,0.1); }
                .ctrl-btn.danger { background: #ea4335; color: white; }
                .ctrl-btn.danger:hover { background: #ff5252; }
                .ctrl-btn.screen-btn { background: #3c4043; margin: 0 5px; }
                .ctrl-btn.screen-btn.active { background: #8ab4f8; color: #202124; }

                .ctrl-arrow {
                    background: transparent; border: none; color: white; 
                    padding: 0 10px 0 5px; cursor: pointer; border-radius: 0 25px 25px 0;
                    height: 45px; display: flex; align-items: center; opacity: 0.7;
                }
                .ctrl-arrow:hover { opacity: 1; background: rgba(255,255,255,0.1); }

                /* Выпадающее меню устройств */
                .device-menu {
                    position: absolute; bottom: 60px; left: 50%; transform: translateX(-50%);
                    background: #28292c; border-radius: 8px; padding: 10px 0;
                    min-width: 200px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); border: 1px solid #3c4043;
                }
                .menu-title { padding: 5px 15px; font-size: 12px; color: #9aa0a6; text-transform: uppercase; font-weight: bold; margin-bottom: 5px; }
                .menu-item { padding: 10px 15px; color: white; font-size: 14px; cursor: pointer; transition: 0.2s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;}
                .menu-item:hover { background: #3c4043; }
                .menu-item.active { color: #8ab4f8; font-weight: bold; }
                .menu-item.disabled { color: #5f6368; cursor: default; }
                .menu-item.disabled:hover { background: transparent; }

                .divider { width: 1px; height: 30px; background: rgba(255,255,255,0.2); margin: 0 10px; }
                
                .ctrl-btn.exit {
                    width: auto; padding: 0 20px; border-radius: 25px;
                    background: #ea4335; font-size: 14px; font-weight: bold;
                }
                .ctrl-btn.exit:hover { background: #ff5252; box-shadow: 0 0 20px rgba(234, 67, 53, 0.5); }

                @media (max-width: 768px) {
                    .top-bar { padding: 15px; flex-direction: column; align-items: flex-start; gap: 10px; }
                    .room-info { display: none; }
                    .video-container { padding: 70px 10px 90px 10px; gap: 10px; }
                    .grid-double { grid-template-columns: 1fr; grid-template-rows: repeat(2, 1fr); height: 100%; }
                    .grid-multi { grid-template-columns: repeat(2, 1fr); }
                    .controls-wrapper { bottom: 15px; }
                    .controls-glass { padding: 5px 10px; gap: 5px; }
                    .btn-group { margin: 0; }
                    .ctrl-btn { width: 40px; height: 40px; font-size: 16px; }
                    .ctrl-btn.exit { padding: 0 15px; font-size: 12px; height: 40px; }
                }
            `}</style>
        </div>
    );
}