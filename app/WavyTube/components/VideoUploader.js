// app/components/VideoUploader.js
// Конвертация в FastStart (moov atom) перед загрузкой через FFmpeg WASM
'use client';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { useState, useRef } from 'react';
import { uploadVideoFile, saveVideoMetadata } from '../actions';

export default function VideoUploader({ currentUsername }) {
  const [status, setStatus] = useState('');
  const ffmpegRef = useRef(new FFmpeg());

  const handleUpload = async (e) => {
    e.preventDefault();
    const file = e.target.videoFile.files[0];
    const previewFile = e.target.previewFile.files[0]; // HD Preview
    const videoId = 'v_' + Math.random().toString(36).substring(2, 11);
    
    setStatus('Загрузка FFmpeg...');
    const ffmpeg = ffmpegRef.current;
    if (!ffmpeg.loaded) await ffmpeg.load();

    setStatus('Конвертация в FastStart (MP4)...');
    await ffmpeg.writeFile('input.mp4', await fetchFile(file));
    // Перенос moov atom в начало файла для мгновенного воспроизведения
    await ffmpeg.exec(['-i', 'input.mp4', '-c', 'copy', '-movflags', 'faststart', 'output.mp4']);
    
    const data = await ffmpeg.readFile('output.mp4');
    const fastStartBlob = new Blob([data.buffer], { type: 'video/mp4' });

    setStatus('Загрузка на сервер...');
    const formData = new FormData();
    formData.append('file', fastStartBlob);
    formData.append('videoId', videoId);
    if (previewFile) formData.append('preview', previewFile);

    await uploadVideoFile(formData);

    setStatus('Сохранение в базу данных...');
    await saveVideoMetadata(
      {
        id: videoId,
        channel: currentUsername,
        title: e.target.title.value,
        description: e.target.description.value,
        playlist: e.target.playlist.value || 'General'
      },
      {
        tags: e.target.tags.value,
        audience_type: 'general'
      }
    );

    setStatus('Успешно загружено!');
  };

  return (
    <form onSubmit={handleUpload}>
      <input name="title" placeholder="Название" required />
      <input name="description" placeholder="Описание" required />
      <input name="playlist" placeholder="Плейлист" required />
      <input name="tags" placeholder="Теги (через запятую)" />
      <input type="file" name="previewFile" accept="image/*" required />
      <input type="file" name="videoFile" accept="video/mp4" required />
      <button type="submit">Загрузить</button>
      <p>{status}</p>
    </form>
  );
}