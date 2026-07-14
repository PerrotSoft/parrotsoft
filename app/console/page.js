'use client';

import { useState, useTransition } from 'react';
import { addSearchItem } from '../actions';
import { useRouter } from 'next/navigation';

export default function ConsolePage() {
    const [form, setForm] = useState({ name: '', url: '', desc: '' });
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    const currentUserID = "2";

    const handleSubmit = (e) => {
        e.preventDefault();
        startTransition(async () => {
            await addSearchItem(currentUserID, form);
            router.push('/search');
        });
    };

    return (
        <div className="console-page">
            <form onSubmit={handleSubmit} className="modal-box">
                <h3>New entry</h3>
                <input 
                    placeholder="Project name" 
                    required 
                    value={form.name} 
                    onChange={e => setForm({...form, name: e.target.value})} 
                />
                <input 
                    placeholder="URL" 
                    required 
                    value={form.url} 
                    onChange={e => setForm({...form, url: e.target.value})} 
                />
                <textarea 
                    placeholder="Description" 
                    value={form.desc} 
                    onChange={e => setForm({...form, desc: e.target.value})} 
                />
                <div className="modal-btns">
                    <button type="button" className="cancel" onClick={() => router.push('/search')}>Cancel</button>
                    <button type="submit" className="save" disabled={isPending}>
                        {isPending ? 'Saving...' : 'Save'}
                    </button>
                </div>
            </form>

            <style>{`
                .console-page { min-height: 100vh; background: #000; color: #fff; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 20px; }
                .modal-box { background: #202124; padding: 24px; border-radius: 16px; width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 12px; border: 1px solid #3c4043; }
                .modal-box h3 { margin: 0 0 8px 0; }
                .modal-box input, .modal-box textarea { background: #303134; border: 1px solid #5f6368; color: #fff; padding: 12px; border-radius: 8px; outline: none; font-size: 1rem; }
                .modal-box textarea { min-height: 80px; resize: vertical; }
                .modal-btns { display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px; }
                .modal-btns button { padding: 10px 20px; border-radius: 8px; cursor: pointer; font-weight: 600; border: none; }
                .cancel { background: transparent; color: #8ab4f8; }
                .save { background: #8ab4f8; color: #000; }
                .save:disabled { opacity: 0.5; cursor: not-allowed; }
            `}</style>
        </div>
    );
}