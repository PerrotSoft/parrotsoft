const express = require('express');
const app = express();
const PORT = 3000;

// Middleware для работы с JSON и статическими файлами
app.use(express.json());

// Главная страница
app.get('/', (req, res) => {
    res.send('<h1>Привет! Это тестовый сайт на Node.js</h1><p>Сервер работает корректно.</p>');
});

// Пример API маршрута
app.get('/api/status', (req, res) => {
    res.json({ status: 'OK', uptime: process.uptime() });
});

app.listen(PORT, () => {
    console.log(`Сервер запущен: http://localhost:${PORT}`);
});
