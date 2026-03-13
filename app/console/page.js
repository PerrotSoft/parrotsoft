'use client';
import { useState, useTransition } from 'react';
import { addSearchItem } from '../actions';
import { useRouter } from 'next/navigation';

export default function ConsolePage() {
    const [form, setForm] = useState({ name: '', url: '', desc: '' });
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    const save = (e) => {
        e.preventDefault();
        startTransition(async () => {
            await addSearchItem("2", form); // ID вашего пользователя
            router.push('/search'); // Перенаправление обратно после сохранения
        });
    };

    return (
        <div className="console-page">
            <form onSubmit={save} className="modal-box">
                <h3>Новая запись</h3>
                <input placeholder="Название" required onChange={e => setForm({...form, name: e.target.value})} />
                <input placeholder="URL" required onChange={e => setForm({...form, url: e.target.value})} />
                <textarea placeholder="Описание" onChange={e => setForm({...form, desc: e.target.value})} />
                <button type="submit" disabled={isPending}>
                    {isPending ? 'Сохранение...' : 'Добавить в поиск'}
                </button>
            </form>
            <style>{`
                .console-page { min-height: 100vh; background: #000; color: #fff; display: flex; align-items: center; justify-content: center; }
                .modal-box { background: #202124; padding: 24px; border-radius: 16px; display: flex; flex-direction: column; gap: 12px; width: 300px; }
                input, textarea { background: #303134; border: 1px solid #5f6368; color: #fff; padding: 10px; border-radius: 8px; }
                button { background: #8ab4f8; color: #000; padding: 10px; border-radius: 8px; border: none; cursor: pointer; }
            `}</style>
        </div>
    );
}