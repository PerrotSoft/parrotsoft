'use client';
import { useEffect, useRef, useState } from 'react';
import Peer from 'peerjs';

export default function CallWindow({ currentUser, activeCall, onEnd }) {
    const [status, setStatus] = useState("Инициализация...");
    const [participants, setParticipants] = useState([]);
    const [isMicMuted, setIsMicMuted] = useState(false);
    const [isCamOff, setIsCamOff] = useState(false);
    
    const peerRef = useRef(null);
    const localStreamRef = useRef(null);
    const connectionsRef = useRef(new Map()); 
    const callsRef = useRef(new Map());        
    const videoRefs = useRef({});

    const isHost = currentUser === activeCall.caller;

    useEffect(() => {
        if (peerRef.current) return;

        const myPeerId = isHost ? currentUser : `${currentUser}_${Math.random().toString(36).substr(2, 4)}`;
        
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
                setStatus(isHost ? "CONFERENCE (HOST)" : "CONNECTED");
            } catch (e) { setStatus("CAMERA ERROR"); }
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
            peer.destroy();
            localStreamRef.current?.getTracks().forEach(t => t.stop());
            peerRef.current = null;
        };
    }, []);

    const setupDataChannel = (conn) => {
        connectionsRef.current.set(conn.peer, conn);
        
        conn.on('data', (data) => {
            if (data.type === 'DIE') onEnd(); // Команда хоста: всем выйти
            if (data.type === 'BYE') removePeer(data.userId); // Кто-то ушел сам
            
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
        const t = localStreamRef.current.getAudioTracks()[0];
        if (t) { t.enabled = !t.enabled; setIsMicMuted(!t.enabled); }
    };

    const toggleCam = () => {
        const t = localStreamRef.current.getVideoTracks()[0];
        if (t) { t.enabled = !t.enabled; setIsCamOff(!t.enabled); }
    };

    return (
        <div className="call-ui">
            <div className="status-label">{status}</div>
            <div className="video-grid">
                <div className={`v-card ${isCamOff ? 'off' : ''}`}>
                    <video ref={el => videoRefs.current['me'] = el} autoPlay playsInline muted />
                    <div className="name">ВЫ {isMicMuted && '🔇'}</div>
                </div>
                {participants.map(id => (
                    <div key={id} className="v-card">
                        <video ref={el => videoRefs.current[id] = el} autoPlay playsInline />
                        <div className="name">{id.split('_')[0]}</div>
                    </div>
                ))}
            </div>

            <div className="footer">
                <button onClick={toggleMic} className={isMicMuted ? 'active' : ''}>
                    {isMicMuted ? '🎤 ON' : '🎙️ MUTE'}
                </button>
                <button onClick={toggleCam} className={isCamOff ? 'active' : ''}>
                    {isCamOff ? '📹 ON' : '🚫 OFF'}
                </button>
                <button onClick={handleSmartExit} className="exit-btn">
                    {isHost ? "END" : "EXIT"}
                </button>
            </div>

            <style jsx>{`
                .call-ui { position: fixed; inset: 0; background: #080808; z-index: 10000; display: flex; flex-direction: column; font-family: system-ui; }
                .status-label { text-align: center; padding: 10px; color: #333; font-size: 11px; }
                .video-grid { flex: 1; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 15px; padding: 20px; }
                .v-card { background: #000; border-radius: 12px; position: relative; overflow: hidden; border: 1px solid #1a1a1a; aspect-ratio: 16/9; }
                .v-card.off video { opacity: 0; }
                video { width: 100%; height: 100%; object-fit: cover; }
                .name { position: absolute; bottom: 10px; left: 10px; background: rgba(0,0,0,0.5); padding: 4px 10px; border-radius: 6px; font-size: 12px; color: #fff; }
                .footer { height: 100px; background: #111; display: flex; justify-content: center; align-items: center; gap: 15px; }
                button { padding: 12px 20px; border-radius: 10px; border: none; background: #222; color: #fff; cursor: pointer; min-width: 100px; }
                button.active { background: #ff4d4d; }
                .exit-btn { background: #ea4335; margin-left: 30px; font-weight: bold; }
            `}</style>
        </div>
    );
}