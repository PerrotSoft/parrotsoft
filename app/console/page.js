'use client';

import { useState, useTransition } from 'react';
import { addSearchItem } from '../actions';
import { useRouter } from 'next/navigation';

// Принудительно отключаем пре-рендер для этой страницы, 
// чтобы сборщик не пытался её "выполнить" во время билда
export const dynamic = 'force-dynamic';

export default function ConsolePage() {
    const [form, setForm] = useState({ name: '', url: '', desc: '' });
    const [isPending, startTransition] = useTransition();
    const router = useRouter();

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        // Простая валидация перед отправкой
        if (!form.name || !form.url) return;

        startTransition(async () => {
            try {
                // Используем ваш ID пользователя (например "2")
                await addSearchItem("2", {
                    name: form.name,
                    url: form.url,
                    desc: form.desc
                });
                // Возвращаемся на поиск, чтобы увидеть результат
                router.push('/search');
            } catch (error) {
                console.error("Ошибка при добавлении:", error);
                alert("Не удалось сохранить");
            }
        });
    };

    return (
        <div className="console-container">
            <form onSubmit={handleSubmit} className="console-form">
                <h2>Добавить в поисковик</h2>
                <input 
                    placeholder="Название проекта" 
                    value={form.name}
                    onChange={e => setForm({...form, name: e.target.value})}
                    required 
                />
                <input 
                    placeholder="URL (например: google.com)" 
                    value={form.url}
                    onChange={e => setForm({...form, url: e.target.value})}
                    required 
                />
                <textarea 
                    placeholder="Описание" 
                    value={form.desc}
                    onChange={e => setForm({...form, desc: e.target.value})}
                />
                <button type="submit" disabled={isPending}>
                    {isPending ? 'Сохранение...' : 'Опубликовать'}
                </button>
                <button type="button" onClick={() => router.back()} className="secondary">
                    Назад
                </button>
            </form>

            <style jsx>{`
                .console-container { min-height: 100vh; background: #000; color: #fff; display: flex; justify-content: center; align-items: center; padding: 20px; }
                .console-form { background: #1a1a1a; padding: 30px; border-radius: 20px; width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 15px; border: 1px solid #333; }
                input, textarea { background: #222; border: 1px solid #444; color: #fff; padding: 12px; border-radius: 10px; outline: none; }
                button { background: #8ab4f8; color: #000; border: none; padding: 12px; border-radius: 10px; font-weight: bold; cursor: pointer; }
                button:disabled { opacity: 0.5; }
                .secondary { background: transparent; color: #8ab4f8; margin-top: -5px; }
            `}</style>
        </div>
    );
}