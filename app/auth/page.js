'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const router = useRouter();

  const handleAuth = (e) => {
    e.preventDefault();
    if (!login || !password) return alert('Please fill in all fields');

    if (isLogin) {
      // Simulate login
      const user = { login };
      localStorage.setItem('parrot_user', JSON.stringify(user));
      window.location.href = '/'; // Hard reload to update Layout
    } else {
      // Simulate registration
      alert('Account created! Now sign in.');
      setIsLogin(true);
    }
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh' }}>
      <form onSubmit={handleAuth} className="block-v1" style={{ padding: '40px', borderRadius: '25px', width: '350px' }}>
        <h2>{isLogin ? 'Sign In' : 'Create Account'}</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginTop: '20px' }}>
          <input className="inp-v1" placeholder="Login" value={login} onChange={(e)=>setLogin(e.target.value)} />
          <input className="inp-v1" type="password" placeholder="Password" value={password} onChange={(e)=>setPassword(e.target.value)} />
          <button type="submit" className="btn-v4" style={{padding: '12px'}}>{isLogin ? 'Sign In' : 'Create Account'}</button>
          <p onClick={() => setIsLogin(!isLogin)} style={{textAlign: 'center', fontSize: '13px', cursor: 'pointer', opacity: 0.7}}>
            {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
          </p>
        </div>
      </form>
    </div>
  );
}