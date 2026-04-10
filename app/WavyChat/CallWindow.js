'use client';
import { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';

export default function CallWindow({ currentUser, activeCall, onEnd }) {
    const [status, setStatus] = useState("Инициализация...");
    const [participants, setParticipants] = useState([]);
    const [isMicMuted, setIsMicMuted] = useState(false);
    const [isCamOff, setIsCamOff] = useState(false);
    const [peerError, setPeerError] = useState(null);
    const [isScreenSharing, setIsScreenSharing] = useState(false);
    const screenStreamRef = useRef(null);
    const peerRef = useRef(null);
    const localStreamRef = useRef(null);
    const connectionsRef = useRef(new Map()); 
    const callsRef = useRef(new Map());        
    const videoRefs = useRef({});

    const isHost = currentUser === activeCall.caller;

    useEffect(() => {
        if (peerRef.current) return;

        // ИСПРАВЛЕНИЕ ОШИБКИ ID: Генерируем более длинный и уникальный суффикс
        const myPeerId = isHost 
            ? currentUser 
            : `${currentUser}_${Math.random().toString(36).substring(2, 9)}`;
        
        const peer = new Peer(myPeerId, {
            config: { 'iceServers': [{ 'urls': 'stun:stun.l.google.com:19302' }] },
            debug: 1
        });
        peerRef.current = peer;

        peer.on('open', async (id) => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
                localStreamRef.current = stream;
                if (videoRefs.current['me']) videoRefs.current['me'].srcObject = stream;

                if (!isHost) {
                    const conn = peer.connect(activeCall.caller);
                    setupDataChannel(conn);
                    const call = peer.call(activeCall.caller, stream);
                    handleMediaCall(call);
                }
                setStatus(isHost ? "Организатор конференции" : "Подключено");
            } catch (e) { 
                setStatus("Ошибка доступа к камере/микрофону"); 
                console.error(e);
            }
        });

        // Обработка ошибки занятого ID (если хост обновил страницу и ID еще висит)
        peer.on('error', (err) => {
            console.error('PeerJS Error:', err);
            if (err.type === 'unavailable-id') {
                setStatus("Ошибка: ID занят. Переподключение...");
                setPeerError("Сессия еще активна в другой вкладке или зависла. Подождите 10 секунд и обновите страницу.");
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
    const toggleScreenShare = async () => {
    try {
        if (!isScreenSharing) {
            // Запрашиваем поток экрана
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            screenStreamRef.current = stream;
            const screenTrack = stream.getVideoTracks()[0];

            // Заменяем трек для всех активных звонков
            callsRef.current.forEach(call => {
                const sender = call.peerConnection.getSenders().find(s => s.track.kind === 'video');
                if (sender) sender.replaceTrack(screenTrack);
            });

            // Обновляем свое превью
            if (videoRefs.current['me']) videoRefs.current['me'].srcObject = stream;

            // Обработка нажатия кнопки "Остановить показ" в браузере
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

        // Возвращаем камеру всем участникам
        callsRef.current.forEach(call => {
            const sender = call.peerConnection.getSenders().find(s => s.track.kind === 'video');
            if (sender) sender.replaceTrack(videoTrack);
        });

        // Возвращаем камеру себе
        if (videoRefs.current['me']) videoRefs.current['me'].srcObject = localStreamRef.current;

        // Останавливаем поток экрана
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
            connectionsRef.current.forEach(conn => {
                if (conn.open) conn.send({ type: 'DIE' });
            });
            setTimeout(() => {
                onEnd();
                window.location.reload(); 
            }, 300);
        } else {
            connectionsRef.current.forEach(conn => {
                if (conn.open) conn.send({ type: 'BYE', userId: peerRef.current.id });
            });
            setTimeout(() => {
                window.location.reload(); 
            }, 300);
        }
    };

    const toggleMic = () => {
        const t = localStreamRef.current?.getAudioTracks()[0];
        if (t) { 
            t.enabled = !t.enabled; 
            setIsMicMuted(!t.enabled); 
        }
    };

    const toggleCam = () => {
        const t = localStreamRef.current?.getVideoTracks()[0];
        if (t) { 
            t.enabled = !t.enabled; 
            setIsCamOff(!t.enabled); 
        }
    };

    // Определение сетки в зависимости от количества людей
    const totalUsers = participants.length + 1;
    let gridClass = "grid-multi";
    if (totalUsers === 1) gridClass = "grid-single";
    else if (totalUsers === 2) gridClass = "grid-double";

    return (
        <div className="call-ui">
            {/* Верхняя панель со статусом */}
            <div className="top-bar">
                <div className="status-badge">
                    <span className="pulse-dot"></span>
                    {status}
                </div>
                <div className="room-info">Вызов: {activeCall.title || 'WavyChat'}</div>
            </div>

            {peerError && (
                <div className="error-banner">{peerError}</div>
            )}

            {/* Сетка с видео */}
            <div className={`video-container ${gridClass}`}>
                <div className="v-card">
                    {isCamOff ? (
                        <div className="avatar-placeholder">{currentUser[0].toUpperCase()}</div>
                    ) : (
                        <video 
                            ref={el => videoRefs.current['me'] = el} 
                            autoPlay 
                            playsInline 
                            muted 
                            className={!isScreenSharing ? "mirror" : ""} 
                        />
                    )}
                    <div className="user-label">
                        Вы {isMicMuted && <span className="muted-icon">🔇</span>}
                    </div>
                </div>

                {participants.map(id => (
                    <div key={id} className="v-card">
                        <video ref={el => videoRefs.current[id] = el} autoPlay playsInline />
                        <div className="user-label">{id.split('_')[0]}</div>
                    </div>
                ))}
            </div>

            {/* Плавающая нижняя панель управления */}
            <div className="controls-wrapper">
                <div className="controls-glass">
                    <button onClick={toggleMic} className={`ctrl-btn ${isMicMuted ? 'danger' : ''}`} title="Микрофон">
                        {isMicMuted ? '🔇' : '🎙️'}
                    </button>
                    <button onClick={toggleCam} className={`ctrl-btn ${isCamOff ? 'danger' : ''}`} title="Камера">
                        {isCamOff ? '🚫' : '📹'}
                    </button>
                    <button 
                        onClick={toggleScreenShare} 
                        className={`ctrl-btn ${isScreenSharing ? 'active' : ''}`} 
                        title="Демонстрация экрана"
                    >
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
                    position: fixed; inset: 0; background: #0a0a0c; z-index: 10000;
                    display: flex; flex-direction: column; font-family: 'Segoe UI', system-ui, sans-serif;
                }

                /* Верхняя панель */
                .top-bar {
                    position: absolute; top: 0; left: 0; width: 100%; padding: 20px;
                    display: flex; justify-content: space-between; align-items: center;
                    z-index: 10; pointer-events: none;
                }
                .status-badge {
                    background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); border: 1px solid rgba(255,255,255,0.1);
                    padding: 8px 16px; border-radius: 20px; color: #fff; font-size: 13px;
                    display: flex; align-items: center; gap: 8px; font-weight: 500;
                }
                .pulse-dot {
                    width: 8px; height: 8px; background: #00ff95; border-radius: 50%;
                    box-shadow: 0 0 10px #00ff95; animation: pulse 2s infinite;
                }
                .room-info { color: rgba(255,255,255,0.6); font-size: 14px; font-weight: bold; background: rgba(0,0,0,0.4); padding: 5px 15px; border-radius: 12px; }

                @keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }

                .error-banner {
                    position: absolute; top: 70px; left: 50%; transform: translateX(-50%);
                    background: #ea4335; color: white; padding: 10px 20px; border-radius: 8px;
                    z-index: 20; font-size: 13px; box-shadow: 0 4px 15px rgba(234, 67, 53, 0.4);
                }

                /* Контейнер видео */
                .video-container {
                    flex: 1; padding: 80px 20px 100px 20px; display: grid; gap: 15px;
                    height: 100vh; overflow-y: auto; align-content: center;
                }

                /* Динамическая сетка */
                .grid-single { grid-template-columns: 1fr; max-width: 900px; margin: 0 auto; width: 100%; height: 80vh; }
                .grid-double { grid-template-columns: repeat(2, 1fr); max-width: 1200px; margin: 0 auto; height: 70vh; }
                .grid-multi { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
                /* Зеркалим только если это камера, а не экран */
                .mirror-self {
                    transform: ${isScreenSharing ? 'scaleX(1)' : 'scaleX(-1)'};
                }
                .v-card {
                    background: #111; border-radius: 20px; position: relative; overflow: hidden;
                    border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 10px 30px rgba(0,0,0,0.5);
                    display: flex; align-items: center; justify-content: center;
                    aspect-ratio: 16/9; width: 100%; height: 100%;
                }
                video { width: 100%; height: 100%; object-fit: cover; }
                

                .avatar-placeholder {
                    width: 100px; height: 100px; border-radius: 50%;
                    background: linear-gradient(135deg, #0070f3, #00c6ff);
                    display: flex; align-items: center; justify-content: center;
                    font-size: 40px; font-weight: bold; color: white; box-shadow: 0 4px 20px rgba(0, 112, 243, 0.4);
                }

                .user-label {
                    position: absolute; bottom: 15px; left: 15px;
                    background: rgba(0,0,0,0.6); backdrop-filter: blur(5px);
                    padding: 6px 14px; border-radius: 10px; font-size: 13px; color: #fff;
                    display: flex; align-items: center; gap: 6px; font-weight: 500;
                    border: 1px solid rgba(255,255,255,0.1);
                }
                .muted-icon { color: #ff4d4d; }

                /* Панель управления */
                .controls-wrapper {
                    position: absolute; bottom: 30px; left: 0; width: 100%;
                    display: flex; justify-content: center; pointer-events: none;
                }
                .controls-glass {
                    background: rgba(30, 30, 35, 0.75); backdrop-filter: blur(15px);
                    border: 1px solid rgba(255,255,255,0.1); padding: 10px 20px;
                    border-radius: 25px; display: flex; gap: 15px; align-items: center;
                    pointer-events: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.5);
                }
                .ctrl-btn {
                    width: 50px; height: 50px; border-radius: 50%; border: none;
                    background: rgba(255,255,255,0.1); color: #fff; font-size: 20px;
                    cursor: pointer; transition: all 0.2s ease; display: flex;
                    align-items: center; justify-content: center;
                }
                .ctrl-btn:hover { background: rgba(255,255,255,0.2); transform: translateY(-2px); }
                .ctrl-btn.danger { background: #ea4335; color: white; }
                .ctrl-btn.danger:hover { background: #ff5252; box-shadow: 0 0 15px rgba(234, 67, 53, 0.4); }
                
                .divider { width: 1px; height: 30px; background: rgba(255,255,255,0.1); }
                
                .ctrl-btn.exit {
                    width: auto; padding: 0 25px; border-radius: 25px;
                    background: #ea4335; font-size: 14px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase;
                }
                .ctrl-btn.exit:hover { background: #ff5252; box-shadow: 0 0 20px rgba(234, 67, 53, 0.5); }

                /* МОБИЛЬНАЯ АДАПТАЦИЯ */
                @media (max-width: 768px) {
                    .top-bar { padding: 15px; flex-direction: column; align-items: flex-start; gap: 10px; }
                    .room-info { display: none; } /* Скрываем название комнаты на мобилках для экономии места */
                    
                    .video-container { padding: 70px 10px 90px 10px; gap: 10px; }
                    
                    /* На мобилках карточки становятся вертикальными, если людей двое */
                    .grid-double { grid-template-columns: 1fr; grid-template-rows: repeat(2, 1fr); height: 100%; }
                    .grid-multi { grid-template-columns: repeat(2, 1fr); }
                    
                    .v-card { border-radius: 15px; }
                    .controls-wrapper { bottom: 15px; }
                    .controls-glass { padding: 8px 15px; gap: 10px; border-radius: 20px; }
                    .ctrl-btn { width: 45px; height: 45px; font-size: 18px; }
                    .ctrl-btn.exit { padding: 0 15px; font-size: 12px; }
                }
                video { 
                    width: 100%; 
                    height: 100%; 
                    object-fit: cover; 
                    transform: scaleX(-1); /* Отражение по горизонтали */
                }
            `}</style>
        </div>
    );
}