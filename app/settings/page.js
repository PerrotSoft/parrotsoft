'use client';
import { useState, useEffect } from 'react';

export default function SettingsPage() {
  const [token, setToken] = useState('');
  const [userInfo, setUserInfo] = useState(null);

  useEffect(() => {
    const sessionToken = localStorage.getItem('active_session_token');
    if (sessionToken) {
      setToken(sessionToken);
      const userAccounts = JSON.parse(localStorage.getItem('parrot_accounts') || '{}');
      setUserInfo(userAccounts[sessionToken]);
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('active_session_token');
    window.location.href = '/';
  };

  return (
    <div style={{ padding: '40px', maxWidth: '800px', margin: '0 auto' }}>
      <h1 className="block-v1" style={{ padding: '25px', borderRadius: '20px' }}>System Configuration</h1>
      
      <div className="block-v1" style={{ marginTop: '30px', padding: '30px', borderRadius: '20px' }}>
        <h3>Security and API</h3>
        <p style={{ opacity: 0.6 }}>Your unique access token (Token ID):</p>
        <div style={{ 
          background: 'rgba(0,0,0,0.1)', 
          padding: '15px', 
          borderRadius: '10px', 
          fontFamily: 'monospace',
          wordBreak: 'break-all',
          border: '1px solid var(--accent)'
        }}>
          {token || 'Key not generated'}
        </div>
        
        <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
          <button className="btn-v1" onClick={() => navigator.clipboard.writeText(token)}>Copy Token</button>
          <button className="btn-v5" onClick={handleLogout}>Logout</button>
        </div>
      </div>
    </div>
  );
}