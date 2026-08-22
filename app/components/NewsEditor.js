'use client';
import { useState, useRef, useCallback, useEffect } from 'react';
// npm install marked   (используется только для режима Markdown)
import { marked } from 'marked';
import { compressImageToJPEG } from '../lib/imageUpload';

marked.setOptions({ gfm: true, breaks: true });

// ─────────────────────────────────────────────────────────────────────────
// NewsEditor — форма создания/редактирования одной новости.
// Режимы контента (табы): 'html' (сырой HTML+CSS), 'markdown' (MD → HTML,
// полная поддержка GFM: таблицы, ссылки, код, списки и т.д.), 'builder'
// (визуальный конструктор с перетаскиванием/ресайзом/привязкой к сетке).
// На сохранении все режимы компилируются в один и тот же формат — готовый
// HTML+CSS (content), который у читателя рендерится ТОЛЬКО в
// <iframe sandbox> без allow-scripts, так что JS никогда не выполнится.
//
// props: initialData?, onSave(data), onCancel()
// ─────────────────────────────────────────────────────────────────────────

const BLOCK_DEFAULTS = {
  text: { w: 40, h: 12, text: 'Текст новости...', fontSize: 16, color: '#eee', weight: 400, align: 'left' },
  heading: { w: 60, h: 14, text: 'Заголовок', fontSize: 32, color: '#fff', weight: 800, align: 'left' },
  image: { w: 50, h: 30, src: '' },
  link: { w: 30, h: 8, text: 'Ссылка', href: 'https://', fontSize: 16, color: '#0078d4' },
  table: { w: 55, h: 25, cells: [['A1', 'B1'], ['A2', 'B2']] },
};

function newBlock(type) {
  return { id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type, x: 10, y: 10, ...BLOCK_DEFAULTS[type] };
}

function escapeHtml(s = '') {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function compileBuilderToHtml(blocks, canvasBg) {
  const blocksHtml = blocks.map(b => {
    const base = `position:absolute;left:${b.x}%;top:${b.y}%;width:${b.w}%;height:${b.h}%;overflow:auto;box-sizing:border-box;`;
    if (b.type === 'image') {
      return `<div style="${base}"><img src="${escapeHtml(b.src)}" style="width:100%;height:100%;object-fit:cover;display:block" /></div>`;
    }
    if (b.type === 'link') {
      return `<div style="${base}display:flex;align-items:center"><a href="${escapeHtml(b.href)}" target="_blank" rel="noopener" style="color:${b.color};font-size:${b.fontSize}px;font-weight:600;text-decoration:none">${escapeHtml(b.text)}</a></div>`;
    }
    if (b.type === 'table') {
      const rows = b.cells.map(row => `<tr>${row.map(c => `<td style="border:1px solid #222;padding:6px 10px">${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
      return `<div style="${base}"><table style="border-collapse:collapse;width:100%;color:#eee">${rows}</table></div>`;
    }
    const textStyle = `font-size:${b.fontSize}px;color:${b.color};font-weight:${b.weight};text-align:${b.align};font-family:inherit;line-height:1.3;`;
    return `<div style="${base}${textStyle}">${escapeHtml(b.text).replace(/\n/g, '<br/>')}</div>`;
  }).join('\n');

  return `<div class="nb-canvas">
${blocksHtml}
</div>
<style>
  html,body{margin:0;padding:0;font-family:system-ui,-apple-system,sans-serif}
  .nb-canvas{position:relative;width:100%;padding-bottom:60%;background:${canvasBg};}
</style>`;
}

function compileMarkdownToHtml(md) {
  const body = marked.parse(md || '');
  return `<div class="md-body">${body}</div>
<style>
  .md-body{font-family:system-ui,-apple-system,sans-serif;line-height:1.65;color:#eee}
  .md-body h1,.md-body h2,.md-body h3{color:#fff;margin-top:1.1em}
  .md-body a{color:#0078d4;text-decoration:none}
  .md-body a:hover{text-decoration:underline}
  .md-body code{background:#111;padding:2px 6px;border-radius:4px;font-size:0.9em}
  .md-body pre{background:#111;padding:12px;border-radius:8px;overflow:auto}
  .md-body pre code{background:none;padding:0}
  .md-body blockquote{border-left:3px solid #0078d4;margin:0;padding-left:12px;opacity:0.85}
  .md-body table{border-collapse:collapse;width:100%;margin:10px 0}
  .md-body th,.md-body td{border:1px solid #222;padding:6px 10px}
  .md-body img{max-width:100%;border-radius:8px}
</style>`;
}

function buildPreviewDoc(html) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#000;color:#eee;font-family:system-ui,-apple-system,sans-serif;padding:14px;box-sizing:border-box">${html}</body></html>`;
}

export default function NewsEditor({ initialData, onSave, onCancel }) {
  const [title, setTitle] = useState(initialData?.title || '');
  const [cover, setCover] = useState(initialData?.cover || '');
  const [coverUploading, setCoverUploading] = useState(false);
  const [mode, setMode] = useState(initialData?.mode === 'builder' ? 'builder' : 'html');

  const savedSource = initialData?.builderData;

  // HTML-режим
  const [rawHtml, setRawHtml] = useState(
    initialData?.mode === 'html' ? (initialData?.content?.split('<style>')[0] || '') : '<h1>Заголовок новости</h1>\n<p>Текст новости...</p>'
  );
  const [rawCss, setRawCss] = useState('body{font-family:system-ui,sans-serif} h1{color:#fff}');

  // Markdown-режим
  const [markdown, setMarkdown] = useState(savedSource?.kind === 'markdown' ? savedSource.text : '# Заголовок\n\nТекст новости с **поддержкой** markdown: таблицы, ссылки, списки...\n\n| Колонка A | Колонка B |\n|---|---|\n| 1 | 2 |');

  // Builder-режим
  const [blocks, setBlocks] = useState(savedSource?.kind === 'builder' ? savedSource.blocks : []);
  const [canvasBg, setCanvasBg] = useState(savedSource?.canvasBg || '#1a1a1a');
  const [selectedId, setSelectedId] = useState(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [blockImgUploading, setBlockImgUploading] = useState(null);
  const canvasRef = useRef(null);
  const dragState = useRef(null);

  const selected = blocks.find(b => b.id === selectedId) || null;

  const htmlContent = `${rawHtml}\n<style>${rawCss}</style>`;
  const markdownContent = compileMarkdownToHtml(markdown);
  const builderContent = compileBuilderToHtml(blocks, canvasBg);
  const previewHtml = mode === 'builder' ? builderContent : mode === 'markdown' ? markdownContent : htmlContent;

  const updateBlock = useCallback((id, patch) => {
    setBlocks(bs => bs.map(b => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const snap = v => (snapEnabled ? Math.round(v / 5) * 5 : v);

  const onCanvasMouseDown = (e, id, dragMode) => {
    e.stopPropagation();
    const block = blocks.find(b => b.id === id);
    if (!block || !canvasRef.current) return;
    setSelectedId(id);
    dragState.current = { id, mode: dragMode, startClientX: e.clientX, startClientY: e.clientY, rect: canvasRef.current.getBoundingClientRect(), startBlock: { ...block } };
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
  };

  const onWindowMouseMove = (e) => {
    const ds = dragState.current;
    if (!ds) return;
    const dxPct = ((e.clientX - ds.startClientX) / ds.rect.width) * 100;
    const dyPct = ((e.clientY - ds.startClientY) / ds.rect.height) * 100;
    if (ds.mode === 'move') {
      updateBlock(ds.id, {
        x: snap(Math.max(0, Math.min(100 - ds.startBlock.w, ds.startBlock.x + dxPct))),
        y: snap(Math.max(0, Math.min(100 - ds.startBlock.h, ds.startBlock.y + dyPct))),
      });
    } else {
      updateBlock(ds.id, {
        w: snap(Math.max(5, Math.min(100 - ds.startBlock.x, ds.startBlock.w + dxPct))),
        h: snap(Math.max(5, Math.min(100 - ds.startBlock.y, ds.startBlock.h + dyPct))),
      });
    }
  };

  const onWindowMouseUp = () => {
    dragState.current = null;
    window.removeEventListener('mousemove', onWindowMouseMove);
    window.removeEventListener('mouseup', onWindowMouseUp);
  };

  // Стрелочки клавиатуры двигают выбранный блок (когда фокус не в текстовом поле).
  // Обычный шаг — 1%, с зажатым Shift или при включённой привязке — 5% (по сетке).
  useEffect(() => {
    const onKeyDown = (e) => {
      if (!selectedId) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const step = snapEnabled || e.shiftKey ? 5 : 1;
      let dx = 0, dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      else if (e.key === 'ArrowRight') dx = step;
      else if (e.key === 'ArrowUp') dy = -step;
      else if (e.key === 'ArrowDown') dy = step;
      else return;
      e.preventDefault();
      const b = blocks.find(bl => bl.id === selectedId);
      if (!b) return;
      updateBlock(selectedId, {
        x: Math.max(0, Math.min(100 - b.w, b.x + dx)),
        y: Math.max(0, Math.min(100 - b.h, b.y + dy)),
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, blocks, snapEnabled, updateBlock]);

  const handleCoverFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCoverUploading(true);
    try {
      const { dataUrl } = await compressImageToJPEG(file);
      setCover(dataUrl);
    } catch (err) {
      alert('Не удалось обработать картинку: ' + err.message);
    } finally {
      setCoverUploading(false);
      e.target.value = '';
    }
  };

  const handleBlockImageFile = async (blockId, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBlockImgUploading(blockId);
    try {
      const { dataUrl } = await compressImageToJPEG(file);
      updateBlock(blockId, { src: dataUrl });
    } catch (err) {
      alert('Не удалось обработать картинку: ' + err.message);
    } finally {
      setBlockImgUploading(null);
      e.target.value = '';
    }
  };

  const updateTableCell = (blockId, r, c, value) => {
    const b = blocks.find(bl => bl.id === blockId);
    if (!b) return;
    const cells = b.cells.map(row => [...row]);
    cells[r][c] = value;
    updateBlock(blockId, { cells });
  };
  const addTableRow = (blockId) => {
    const b = blocks.find(bl => bl.id === blockId);
    if (!b) return;
    const cols = b.cells[0]?.length || 2;
    updateBlock(blockId, { cells: [...b.cells, Array(cols).fill('')] });
  };
  const addTableCol = (blockId) => {
    const b = blocks.find(bl => bl.id === blockId);
    if (!b) return;
    updateBlock(blockId, { cells: b.cells.map(row => [...row, '']) });
  };

  const handleSave = () => {
    if (!title.trim()) return alert('Укажите заголовок новости');
    if (mode === 'html') {
      if (!rawHtml.trim()) return alert('Заполните содержимое новости');
      onSave({ title, cover, mode: 'html', content: htmlContent, builderData: null });
    } else if (mode === 'markdown') {
      if (!markdown.trim()) return alert('Заполните текст новости');
      onSave({ title, cover, mode: 'html', content: markdownContent, builderData: { kind: 'markdown', text: markdown } });
    } else {
      if (!blocks.length) return alert('Добавьте хотя бы один блок');
      onSave({ title, cover, mode: 'builder', content: builderContent, builderData: { kind: 'builder', blocks, canvasBg } });
    }
  };

  return (
    <div className="news-editor">
      <h2 className="editor-title">{initialData ? 'Редактировать новость' : 'Новая новость'}</h2>

      <input className="ne-input" placeholder="Заголовок новости" value={title} onChange={e => setTitle(e.target.value)} />

      <div className="cover-row">
        <input className="ne-input" placeholder="Обложка — вставьте URL или загрузите файл" value={cover} onChange={e => setCover(e.target.value)} />
        <label className="upload-btn">
          {coverUploading ? '...' : '🖼️ Загрузить'}
          <input type="file" accept="image/*" hidden onChange={handleCoverFile} />
        </label>
      </div>
      {cover && <img src={cover} className="cover-preview" alt="" />}

      <div className="mode-tabs">
        <button className={mode === 'html' ? 'tab active' : 'tab'} onClick={() => setMode('html')}>HTML + CSS</button>
        <button className={mode === 'markdown' ? 'tab active' : 'tab'} onClick={() => setMode('markdown')}>Markdown</button>
        <button className={mode === 'builder' ? 'tab active' : 'tab'} onClick={() => setMode('builder')}>Конструктор</button>
      </div>

      <div className="editor-grid">
        <div className="editor-col">
          {mode === 'html' && (
            <>
              <label className="field-label">HTML</label>
              <textarea className="ne-textarea code" value={rawHtml} onChange={e => setRawHtml(e.target.value)} />
              <label className="field-label">CSS</label>
              <textarea className="ne-textarea code short" value={rawCss} onChange={e => setRawCss(e.target.value)} />
            </>
          )}

          {mode === 'markdown' && (
            <>
              <label className="field-label">Markdown (поддерживаются заголовки, **жирный**, *курсив*, списки, [ссылки](url), ![картинки](url), таблицы, `код`, блоки кода, цитаты)</label>
              <textarea className="ne-textarea code tall" value={markdown} onChange={e => setMarkdown(e.target.value)} />
            </>
          )}

          {mode === 'builder' && (
            <>
              <div className="builder-toolbar">
                <button className="mini-btn" onClick={() => setBlocks(bs => [...bs, newBlock('heading')])}>+ Заголовок</button>
                <button className="mini-btn" onClick={() => setBlocks(bs => [...bs, newBlock('text')])}>+ Текст</button>
                <button className="mini-btn" onClick={() => setBlocks(bs => [...bs, newBlock('image')])}>+ Картинка</button>
                <button className="mini-btn" onClick={() => setBlocks(bs => [...bs, newBlock('link')])}>+ Ссылка</button>
                <button className="mini-btn" onClick={() => setBlocks(bs => [...bs, newBlock('table')])}>+ Таблица</button>
                <button className={snapEnabled ? 'mini-btn active' : 'mini-btn'} onClick={() => setSnapEnabled(v => !v)} title="Привязка к сетке 5%">🧲 Привязка</button>
                {selected && (
                  <button className="mini-btn danger" onClick={() => { setBlocks(bs => bs.filter(b => b.id !== selectedId)); setSelectedId(null); }}>Удалить блок</button>
                )}
              </div>
              <p className="hint">Выделите блок и двигайте стрелочками ← ↑ → ↓ (Shift — крупный шаг). Хват в углу блока — ресайз.</p>

              <div ref={canvasRef} className="builder-canvas" style={{ background: canvasBg }} onMouseDown={() => setSelectedId(null)}>
                {blocks.map(b => (
                  <div key={b.id}
                    onMouseDown={e => onCanvasMouseDown(e, b.id, 'move')}
                    className={`builder-block ${selectedId === b.id ? 'selected' : ''}`}
                    style={{ left: `${b.x}%`, top: `${b.y}%`, width: `${b.w}%`, height: `${b.h}%`, color: b.color, fontSize: b.fontSize, fontWeight: b.weight }}
                  >
                    {b.type === 'image' && (b.src ? <img src={b.src} alt="" /> : <span className="placeholder">Картинка — укажите справа</span>)}
                    {b.type === 'link' && <span style={{ pointerEvents: 'none', textDecoration: 'underline' }}>{b.text}</span>}
                    {b.type === 'table' && (
                      <table className="mini-table"><tbody>
                        {b.cells.map((row, ri) => <tr key={ri}>{row.map((c, ci) => <td key={ci}>{c}</td>)}</tr>)}
                      </tbody></table>
                    )}
                    {(b.type === 'text' || b.type === 'heading') && <span className="placeholder-text">{b.text}</span>}
                    <div className="resize-handle" onMouseDown={e => onCanvasMouseDown(e, b.id, 'resize')} />
                  </div>
                ))}
              </div>

              {selected && (
                <div className="block-props">
                  <label className="field-label">Свойства блока</label>
                  {selected.type === 'image' && (
                    <div className="cover-row">
                      <input className="ne-input" placeholder="URL картинки" value={selected.src} onChange={e => updateBlock(selected.id, { src: e.target.value })} />
                      <label className="upload-btn">
                        {blockImgUploading === selected.id ? '...' : '🖼️'}
                        <input type="file" accept="image/*" hidden onChange={e => handleBlockImageFile(selected.id, e)} />
                      </label>
                    </div>
                  )}
                  {selected.type === 'link' && (
                    <>
                      <input className="ne-input" placeholder="Текст ссылки" value={selected.text} onChange={e => updateBlock(selected.id, { text: e.target.value })} />
                      <input className="ne-input" placeholder="https://..." value={selected.href} onChange={e => updateBlock(selected.id, { href: e.target.value })} />
                    </>
                  )}
                  {selected.type === 'table' && (
                    <>
                      <table className="edit-table"><tbody>
                        {selected.cells.map((row, ri) => (
                          <tr key={ri}>{row.map((c, ci) => (
                            <td key={ci}><input className="ne-input cell" value={c} onChange={e => updateTableCell(selected.id, ri, ci, e.target.value)} /></td>
                          ))}</tr>
                        ))}
                      </tbody></table>
                      <div className="cover-row">
                        <button className="mini-btn" onClick={() => addTableRow(selected.id)}>+ Строка</button>
                        <button className="mini-btn" onClick={() => addTableCol(selected.id)}>+ Столбец</button>
                      </div>
                    </>
                  )}
                  {(selected.type === 'text' || selected.type === 'heading') && (
                    <>
                      <textarea className="ne-textarea" value={selected.text} onChange={e => updateBlock(selected.id, { text: e.target.value })} />
                      <div className="cover-row">
                        <input className="ne-input num" type="number" value={selected.fontSize} onChange={e => updateBlock(selected.id, { fontSize: Number(e.target.value) })} title="Размер шрифта" />
                        <input type="color" className="color-input" value={selected.color} onChange={e => updateBlock(selected.id, { color: e.target.value })} />
                      </div>
                    </>
                  )}
                </div>
              )}
              <div className="cover-row" style={{ marginTop: 10 }}>
                <label className="field-label" style={{ margin: 0 }}>Фон холста</label>
                <input type="color" className="color-input" value={canvasBg} onChange={e => setCanvasBg(e.target.value)} />
              </div>
            </>
          )}
        </div>

        <div className="editor-col">
          <label className="field-label">Предпросмотр (изолированный iframe, JS не выполняется)</label>
          <iframe title="preview" sandbox="allow-same-origin" srcDoc={buildPreviewDoc(previewHtml)} className="preview-frame" />
        </div>
      </div>

      <div className="editor-actions">
        <button className="save-btn" onClick={handleSave}>Опубликовать</button>
        <button className="cancel-btn" onClick={onCancel}>Отмена</button>
      </div>

      <style jsx>{`
        .news-editor { background: #0a0a0a; border: 1px solid #222; padding: 24px; border-radius: 18px; max-width: 920px; width: 100%; max-height: 90vh; overflow-y: auto; color: #fff; }
        .editor-title { margin: 0 0 16px; }
        .ne-input { width: 100%; background: #111; border: 1px solid #222; color: #fff; padding: 10px 14px; border-radius: 10px; outline: none; font-size: 14px; margin-bottom: 10px; box-sizing: border-box; }
        .ne-input:focus { border-color: #0078d4; }
        .ne-input.num { width: 90px; }
        .ne-input.cell { margin-bottom: 0; padding: 6px 8px; font-size: 12px; }
        .ne-textarea { width: 100%; background: #111; border: 1px solid #222; color: #fff; padding: 10px 14px; border-radius: 10px; outline: none; font-size: 13px; min-height: 90px; box-sizing: border-box; font-family: system-ui, sans-serif; }
        .ne-textarea.code { font-family: 'SF Mono', Menlo, monospace; min-height: 160px; margin-bottom: 10px; }
        .ne-textarea.code.short { min-height: 100px; }
        .ne-textarea.code.tall { min-height: 320px; }
        .ne-textarea:focus { border-color: #0078d4; }
        .cover-row { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
        .cover-row .ne-input { margin-bottom: 0; flex: 1; }
        .cover-preview { max-width: 160px; max-height: 100px; border-radius: 10px; display: block; margin-bottom: 12px; object-fit: cover; }
        .upload-btn { background: #111; border: 1px solid #222; color: #0078d4; padding: 10px 14px; border-radius: 10px; cursor: pointer; font-size: 13px; white-space: nowrap; }
        .upload-btn:hover { background: #161616; }
        .mode-tabs { display: flex; gap: 8px; margin-bottom: 16px; }
        .tab { background: #111; border: 1px solid #222; color: #999; padding: 8px 16px; border-radius: 20px; cursor: pointer; font-size: 13px; }
        .tab.active { background: #0078d4; border-color: #0078d4; color: #fff; }
        .field-label { display: block; font-size: 11px; opacity: 0.55; text-transform: uppercase; letter-spacing: 0.5px; margin: 8px 0 6px; }
        .editor-grid { display: flex; gap: 18px; flex-wrap: wrap; }
        .editor-col { flex: 1 1 340px; min-width: 300px; }
        .preview-frame { width: 100%; min-height: 340px; border: 1px solid #222; border-radius: 12px; background: #000; }
        .builder-toolbar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
        .mini-btn { background: #111; border: 1px solid #222; color: #ccc; padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 12px; }
        .mini-btn.active { background: #0078d4; border-color: #0078d4; color: #fff; }
        .mini-btn.danger { color: #ff4d4d; border-color: #ff4d4d; margin-left: auto; }
        .hint { font-size: 11px; opacity: 0.45; margin: 0 0 8px; }
        .builder-canvas { position: relative; width: 100%; padding-bottom: 60%; border-radius: 12px; border: 1px solid #222; overflow: hidden; }
        .builder-block { position: absolute; box-sizing: border-box; cursor: move; outline: 1px dashed rgba(255,255,255,0.2); display: flex; align-items: center; overflow: hidden; }
        .builder-block.selected { outline: 2px solid #0078d4; }
        .builder-block img { width: 100%; height: 100%; object-fit: cover; pointer-events: none; }
        .placeholder { opacity: 0.5; font-size: 11px; padding: 0 6px; }
        .placeholder-text { pointer-events: none; white-space: pre-wrap; padding: 0 4px; }
        .mini-table { pointer-events: none; border-collapse: collapse; font-size: 11px; width: 100%; }
        .mini-table td { border: 1px solid #333; padding: 3px 6px; }
        .resize-handle { position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; background: #0078d4; cursor: nwse-resize; border-radius: 3px 0 0 0; }
        .block-props { background: #111; border: 1px solid #222; border-radius: 12px; padding: 12px; margin-top: 10px; }
        .edit-table { border-collapse: collapse; margin-bottom: 8px; }
        .color-input { width: 42px; height: 36px; padding: 2px; background: #111; border: 1px solid #222; border-radius: 8px; cursor: pointer; }
        .editor-actions { display: flex; gap: 10px; margin-top: 20px; }
        .save-btn { flex: 1; background: #0078d4; border: none; color: #fff; padding: 12px; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 14px; }
        .save-btn:hover { background: #0068bc; }
        .cancel-btn { flex: 1; background: #111; border: 1px solid #222; color: #ccc; padding: 12px; border-radius: 10px; cursor: pointer; font-size: 14px; }
        .cancel-btn:hover { background: #161616; }
        @media (max-width: 768px) {
          .news-editor { padding: 16px; border-radius: 14px; }
          .editor-grid { flex-direction: column; }
        }
      `}</style>
    </div>
  );
}
