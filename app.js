import { FFmpeg } from 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js';

const $ = (sel) => document.querySelector(sel);

const canvas = $('#canvas');
const ctx = canvas.getContext('2d', { alpha: false });

const cardsEl = $('#cards');
const statusLine = $('#statusLine');
const logEl = $('#log'); // hidden in HTML (ok)
const progressBar = $('#progressBar');
const metaDuration = $('#metaDuration');

const btnPreview = $('#btnPreview');
const btnStop = $('#btnStop');
const btnExport = $('#btnExport');
const btnAdd = $('#btnAdd');
const btnLoadExample = $('#btnLoadExample');
const btnClear = $('#btnClear');

const audioFile = $('#audioFile');
const audioPlayer = $('#audioPlayer');
const audioUrl = $('#audioUrl');
const btnLoadUrl = $('#btnLoadUrl');
const audioUrlError = $('#audioUrlError');
const downloadLink = $('#downloadLink');
const resultVideo = $('#resultVideo');

// Holds the currently-selected audio source, whether from file upload or URL fetch.
// Read here (not audioFile.files?.[0]) at export time so URL-loaded audio muxes correctly.
let currentAudioFile = null;
let currentAudioObjectUrl = null;

const bgFile = $('#bgFile');
const bgFitEl = $('#bgFit');
const bgDimEl = $('#bgDim'); // Opacity
const bgMutePreviewEl = $('#bgMutePreview');
const bgLoopEl = $('#bgLoop');

const resolutionSel = $('#resolution');
const fpsSel = $('#fps');
const fontFamilyEl = $('#fontFamily');
const fontSizeEl = $('#fontSize');
const enableFadeEl = $('#enableFade');
const enableGrainEl = $('#enableGrain');

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

/* ✅ autosize textarea helper */
function autosizeTA(ta){
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

// --- Per-card position helpers ---
function getCardPos(card) {
  const p = card?.pos || {};
  return {
    preset: p.preset || 'center',
    x: typeof p.x === 'number' ? p.x : 0.5,
    y: typeof p.y === 'number' ? p.y : 0.5,
    dvd: typeof p.dvd === 'boolean' ? p.dvd : false,
  };
}

function presetToAnchor(preset) {
  switch (preset) {
    case 'top-left':     return { ax: 0.08, ay: 0.12, align: 'left',  v: 'top' };
    case 'top':          return { ax: 0.50, ay: 0.12, align: 'center',v: 'top' };
    case 'top-right':    return { ax: 0.92, ay: 0.12, align: 'right', v: 'top' };
    case 'left':         return { ax: 0.08, ay: 0.50, align: 'left',  v: 'middle' };
    case 'center':       return { ax: 0.50, ay: 0.50, align: 'center',v: 'middle' };
    case 'right':        return { ax: 0.92, ay: 0.50, align: 'right', v: 'middle' };
    case 'bottom-left':  return { ax: 0.08, ay: 0.88, align: 'left',  v: 'bottom' };
    case 'bottom':       return { ax: 0.50, ay: 0.88, align: 'center',v: 'bottom' };
    case 'bottom-right': return { ax: 0.92, ay: 0.88, align: 'right', v: 'bottom' };
    default:             return { ax: 0.50, ay: 0.50, align: 'center',v: 'middle' };
  }
}

// Global DVD bounce state
const dvdState = {
  init: false,
  x: 0, y: 0,
  vx: 240, vy: 185,
  lastT: 0,
  lastWasDvd: false,
};

// Background state
let bg = { type: 'none', url: null, el: null };

function drawCoverOrContain(mediaW, mediaH, canvasW, canvasH, mode) {
  const scale = (mode === 'contain')
    ? Math.min(canvasW / mediaW, canvasH / mediaH)
    : Math.max(canvasW / mediaW, canvasH / mediaH);

  const w = mediaW * scale;
  const h = mediaH * scale;
  const x = (canvasW - w) / 2;
  const y = (canvasH - h) / 2;
  return { x, y, w, h };
}

function getBgOpacity01() {
  const v = Number(bgDimEl?.value ?? 0);
  return clamp(v / 100, 0, 1);
}

// Default template
let cards = [
  { text: 'Welcome back.', duration: 2.5, pos: { preset: 'center', x: 0.5, y: 0.5, dvd: false } },
  { text: 'This bump was made in a browser.', duration: 2.5, pos: { preset: 'center', x: 0.5, y: 0.5, dvd: false } },
  { text: 'It has no budget. Please respect that.', duration: 2.5, pos: { preset: 'center', x: 0.5, y: 0.5, dvd: false } },
  { text: '[your tag here]', duration: 4.0, pos: { preset: 'center', x: 0.5, y: 0.5, dvd: false } },
];

let isPreviewing = false;
let rafId = null;
let previewStartMs = 0;

let ffmpeg = null;
let ffmpegLoaded = false;

function setStatus(msg) { statusLine.textContent = msg; }

function log(msg) {
  if (!logEl) return;
  logEl.textContent = (logEl.textContent + msg + '\n').slice(-6000);
  logEl.scrollTop = logEl.scrollHeight;
}

function setProgress(p01) {
  const v = clamp(p01, 0, 1);
  progressBar.style.width = (v * 100).toFixed(1) + '%';
}

function getSettings() {
  const [w, h] = resolutionSel.value.split('x').map(n => parseInt(n, 10));
  const fps = parseInt(fpsSel.value, 10);
  const fontFamily = fontFamilyEl.value.trim() || 'Helvetica Neue, Arial, sans-serif';
  const fontSize = clamp(parseInt(fontSizeEl.value, 10) || 96, 12, 200);
  const enableFade = !!enableFadeEl.checked;
  const enableGrain = !!enableGrainEl.checked;
  return { w, h, fps, fontFamily, fontSize, enableFade, enableGrain };
}

function totalDuration() {
  return cards.reduce((sum, c) => sum + (Number(c.duration) || 0), 0);
}

function updateMeta() {
  metaDuration.textContent = totalDuration().toFixed(2) + 's';
}

function escapeText(s) {
  return (s || '').replace(/[\u2028\u2029]/g, ' ');
}

function wrapText(ctx2, text, maxWidth) {
  const words = (text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let line = words[0];
  for (let i = 1; i < words.length; i++) {
    const test = line + ' ' + words[i];
    if (ctx2.measureText(test).width <= maxWidth) line = test;
    else { lines.push(line); line = words[i]; }
  }
  lines.push(line);
  return lines;
}

function computeActiveCard(t) {
  let acc = 0;
  for (let i = 0; i < cards.length; i++) {
    const d = Number(cards[i].duration) || 0;
    if (t < acc + d) return { idx: i, localT: t - acc, start: acc, end: acc + d, dur: d, card: cards[i] };
    acc += d;
  }
  return null;
}

function drawGrain(w, h) {
  const grain = 1800;
  ctx.save();
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < grain; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const a = Math.random() * 0.6;
    const s = Math.random() * 2 + 0.5;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(x, y, s, s);
  }
  ctx.restore();
}

function drawFrame(tSeconds) {
  const { w, h, fontFamily, fontSize, enableFade, enableGrain } = getSettings();

  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);

  const fitMode = bgFitEl?.value || 'cover';

  if (bg.type === 'image' && bg.el) {
    const img = bg.el;
    const r = drawCoverOrContain(img.naturalWidth || w, img.naturalHeight || h, w, h, fitMode);
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
  } else if (bg.type === 'video' && bg.el) {
    const vid = bg.el;
    if (isPreviewing && vid.paused) { try { vid.play(); } catch {} }
    const r = drawCoverOrContain(vid.videoWidth || w, vid.videoHeight || h, w, h, fitMode);
    try { ctx.drawImage(vid, r.x, r.y, r.w, r.h); } catch {}
  }

  if (bg.type !== 'none') {
    const dim = getBgOpacity01();
    if (dim > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${dim})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }
  }

  const active = computeActiveCard(tSeconds);
  if (!active) return;

  const text = escapeText(active.card.text);

  const weight = 700;
  const lineHeight = 1.18;

  ctx.fillStyle = '#fff';
  ctx.font = `${weight} ${fontSize}px ${fontFamily}`;

  const maxWidth = w * 0.90;
  let lines = wrapText(ctx, text, maxWidth);

  let size = fontSize;
  for (let tries = 0; tries < 12; tries++) {
    ctx.font = `${weight} ${size}px ${fontFamily}`;
    lines = wrapText(ctx, text, maxWidth);
    const widest = Math.max(...lines.map(l => ctx.measureText(l).width));
    if (widest <= maxWidth) break;
    size -= 6;
    if (size < 18) break;
  }

  const blockH = lines.length * size * lineHeight;

  const dvdOn = !!(active.card?.pos?.dvd);
  if (dvdOn) {
    const blockW = Math.max(...lines.map(l => ctx.measureText(l).width));
    const margin = Math.max(12, Math.round(size * 0.25));
    const maxX = Math.max(1, w - blockW - margin * 2);
    const maxY = Math.max(1, h - blockH - margin * 2);

    if (!dvdState.init || !dvdState.lastWasDvd) {
      dvdState.init = true;
      dvdState.x = maxX * 0.5;
      dvdState.y = maxY * 0.5;
      dvdState.vx = 240;
      dvdState.vy = 185;
      dvdState.lastT = tSeconds;
    }

    let dt = tSeconds - dvdState.lastT;
    dt = clamp(dt, 0, 0.05);

    dvdState.x += dvdState.vx * dt;
    dvdState.y += dvdState.vy * dt;

    if (dvdState.x <= 0) { dvdState.x = 0; dvdState.vx = Math.abs(dvdState.vx); }
    else if (dvdState.x >= maxX) { dvdState.x = maxX; dvdState.vx = -Math.abs(dvdState.vx); }

    if (dvdState.y <= 0) { dvdState.y = 0; dvdState.vy = Math.abs(dvdState.vy); }
    else if (dvdState.y >= maxY) { dvdState.y = maxY; dvdState.vy = -Math.abs(dvdState.vy); }

    dvdState.lastT = tSeconds;
    dvdState.lastWasDvd = true;

    const xLeft = margin + dvdState.x;
    const yTop  = margin + dvdState.y;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';

    let y = yTop + (size * lineHeight / 2);

    if (enableFade) {
      const fade = 0.18;
      const inA = Math.min(1, active.localT / fade);
      const outA = Math.min(1, (active.end - tSeconds) / fade);
      ctx.globalAlpha = clamp(Math.min(inA, outA), 0, 1);
    } else ctx.globalAlpha = 1;

    for (const line of lines) {
      ctx.fillText(line, xLeft, y);
      y += size * lineHeight;
    }
    ctx.globalAlpha = 1;
    if (enableGrain) drawGrain(w, h);
    return;
  } else {
    dvdState.lastWasDvd = false;
  }

  const pos = getCardPos(active.card);
  const anchor = presetToAnchor(pos.preset);

  const anchorPxX = anchor.ax * w;
  const anchorPxY = anchor.ay * h;

  ctx.textAlign = anchor.align;
  ctx.textBaseline = 'middle';

  let yStart;
  if (anchor.v === 'top') yStart = anchorPxY;
  else if (anchor.v === 'bottom') yStart = anchorPxY - blockH;
  else yStart = anchorPxY - (blockH / 2);

  let y = yStart + (size * lineHeight / 2);
  const x = anchorPxX;

  if (enableFade) {
    const fade = 0.18;
    const inA = Math.min(1, active.localT / fade);
    const outA = Math.min(1, (active.end - tSeconds) / fade);
    ctx.globalAlpha = clamp(Math.min(inA, outA), 0, 1);
  } else ctx.globalAlpha = 1;

  for (const line of lines) {
    ctx.fillText(line, x, y);
    y += size * lineHeight;
  }
  ctx.globalAlpha = 1;

  if (enableGrain) drawGrain(w, h);
}

function stopPreview() {
  if (!isPreviewing) return;
  isPreviewing = false;
  btnPreview.disabled = false;
  btnExport.disabled = false;
  btnStop.disabled = true;

  if (!audioPlayer.paused) {
    audioPlayer.pause();
    audioPlayer.currentTime = 0;
  }

  if (bg.type === 'video' && bg.el) {
    try { bg.el.pause(); } catch {}
    try { bg.el.currentTime = 0; } catch {}
  }

  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;

  setStatus('Stopped.');
}

function previewLoop() {
  if (!isPreviewing) return;
  const t = (performance.now() - previewStartMs) / 1000;
  drawFrame(t);
  if (t >= totalDuration()) { stopPreview(); return; }
  rafId = requestAnimationFrame(previewLoop);
}

btnPreview.addEventListener('click', () => {
  if (!cards.length) return;

  canvas.style.display = 'block';
  resultVideo.style.display = 'none';

  isPreviewing = true;
  btnPreview.disabled = true;
  btnExport.disabled = true;
  btnStop.disabled = false;

  previewStartMs = performance.now();

  if (bg.type === 'video' && bg.el) {
    try { bg.el.currentTime = 0; } catch {}
    try { bg.el.play(); } catch {}
  }

  if (audioPlayer.src) {
    try { audioPlayer.currentTime = 0; audioPlayer.play(); } catch {}
  }

  setProgress(0);
  setStatus('Previewing...');
  rafId = requestAnimationFrame(previewLoop);
});

btnStop.addEventListener('click', stopPreview);

function clearAudioUrlError() {
  audioUrlError.textContent = '';
  audioUrlError.classList.remove('visible');
}

function showAudioUrlError(msg) {
  audioUrlError.textContent = msg;
  audioUrlError.classList.add('visible');
}

function setCurrentAudio(file) {
  if (currentAudioObjectUrl) {
    URL.revokeObjectURL(currentAudioObjectUrl);
    currentAudioObjectUrl = null;
  }
  currentAudioFile = file;
  if (file) {
    currentAudioObjectUrl = URL.createObjectURL(file);
    audioPlayer.src = currentAudioObjectUrl;
    audioPlayer.load();
  } else {
    audioPlayer.removeAttribute('src');
    audioPlayer.load();
  }
}

audioFile.addEventListener('change', (e) => {
  cancelInFlightUrlLoad();
  const file = e.target.files?.[0] || null;
  clearAudioUrlError();
  if (audioUrl) audioUrl.value = '';
  setCurrentAudio(file);
});

audioUrl?.addEventListener('input', () => {
  // User is editing the URL — invalidate any in-flight load so its resolution
  // can't overwrite whatever they're now typing / about to submit.
  if (urlLoadInFlight) cancelInFlightUrlLoad();
});

async function loadAudioFromUrl(rawUrl, signal) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('That doesn’t look like a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http:// and https:// URLs are supported.');
  }

  let res;
  try {
    res = await fetch(url.href, { mode: 'cors', signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // Network layer failure (DNS, offline) OR a CORS/COEP block that prevents any response.
    throw new Error('Couldn’t reach that URL. The source may block cross-origin requests — try downloading and uploading instead.');
  }

  if (!res.ok) {
    throw new Error(`Server returned ${res.status} ${res.statusText || ''}`.trim());
  }

  const blob = await res.blob();
  const type = blob.type || res.headers.get('content-type') || '';

  // Explicitly reject video responses: even audio-only playback works, but the
  // ffmpeg mux fallback would then have two video streams and stream-map
  // heuristics could pick the wrong one. Users with a video track should
  // extract the audio locally and upload that.
  if (type.startsWith('video/')) {
    throw new Error('That URL points to a video, not audio. Extract the audio track and upload it instead.');
  }

  // Derive a filename from the URL path so ffmpeg gets a sensible extension.
  let name = 'audio';
  try {
    const last = url.pathname.split('/').filter(Boolean).pop();
    if (last) name = decodeURIComponent(last);
  } catch {
    // fall through
  }

  // Content-Type is unreliable — many CDNs serve audio as application/octet-stream
  // or omit the header entirely. Accept if MIME is audio OR the URL path has a
  // known audio-only extension. `.webm` and `.mp4` are omitted because they are
  // typically video containers; `.weba` covers audio-only WebM.
  const looksLikeAudio = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)(\?|#|$)/i.test(url.pathname);
  const mimeIsAudio = type.startsWith('audio/');
  if (!mimeIsAudio && !looksLikeAudio) {
    throw new Error(`That URL doesn’t look like audio (got ${type || 'unknown type'}).`);
  }

  return new File([blob], name, { type });
}

let urlLoadInFlight = false;
let urlLoadAbort = null;

// Cancel any in-flight URL load. Called when the user changes source another way
// (picks a file, edits the URL) so the older fetch can't resolve and clobber the
// newer selection.
function cancelInFlightUrlLoad() {
  if (urlLoadAbort) {
    urlLoadAbort.abort();
    urlLoadAbort = null;
  }
}

async function handleLoadUrlClick() {
  if (urlLoadInFlight) return;
  const raw = (audioUrl?.value || '').trim();
  if (!raw) {
    showAudioUrlError('Paste an audio URL first.');
    return;
  }
  urlLoadInFlight = true;
  urlLoadAbort = new AbortController();
  const controller = urlLoadAbort;
  clearAudioUrlError();
  btnLoadUrl.disabled = true;
  const prevLabel = btnLoadUrl.textContent;
  btnLoadUrl.textContent = 'Loading…';
  try {
    const file = await loadAudioFromUrl(raw, controller.signal);
    if (controller.signal.aborted) return; // superseded
    audioFile.value = '';
    setCurrentAudio(file);
  } catch (err) {
    if (err?.name === 'AbortError' || controller.signal.aborted) return; // superseded
    showAudioUrlError(err?.message || 'Failed to load that URL.');
  } finally {
    // Only reset UI state if THIS load is still the current one; otherwise
    // a newer load already owns the button/spinner state.
    if (urlLoadAbort === controller) {
      urlLoadInFlight = false;
      urlLoadAbort = null;
      btnLoadUrl.disabled = false;
      btnLoadUrl.textContent = prevLabel;
    }
  }
}

btnLoadUrl?.addEventListener('click', handleLoadUrlClick);
audioUrl?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handleLoadUrlClick();
  }
});

// Background upload
bgFile?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) {
    if (bg.url) URL.revokeObjectURL(bg.url);
    bg = { type: 'none', url: null, el: null };
    if (!isPreviewing) drawFrame(0);
    return;
  }

  if (bg.url) URL.revokeObjectURL(bg.url);
  const url = URL.createObjectURL(file);

  if (file.type.startsWith('image/')) {
    const img = new Image();
    img.onload = () => { bg = { type: 'image', url, el: img }; if (!isPreviewing) drawFrame(0); };
    img.src = url;
    return;
  }

  if (file.type.startsWith('video/')) {
    const vid = document.createElement('video');
    vid.src = url;
    vid.playsInline = true;
    vid.preload = 'auto';
    vid.loop = !!bgLoopEl?.checked;
    vid.muted = !!bgMutePreviewEl?.checked;
    vid.volume = 0;

    vid.addEventListener('loadedmetadata', async () => {
      bg = { type: 'video', url, el: vid };
      try { vid.currentTime = 0; } catch {}
      try { await vid.play(); } catch {}
      if (!isPreviewing) drawFrame(0);
    });
    return;
  }

  bg = { type: 'none', url: null, el: null };
});

bgLoopEl?.addEventListener('change', () => {
  if (bg.type === 'video' && bg.el) bg.el.loop = !!bgLoopEl.checked;
});
bgMutePreviewEl?.addEventListener('change', () => {
  if (bg.type === 'video' && bg.el) bg.el.muted = !!bgMutePreviewEl.checked;
});

function ensureCardDefaults(card) {
  if (!card.pos) card.pos = { preset: 'center', x: 0.5, y: 0.5, dvd: false };
  if (!card.pos.preset) card.pos.preset = 'center';
  if (typeof card.pos.x !== 'number') card.pos.x = 0.5;
  if (typeof card.pos.y !== 'number') card.pos.y = 0.5;
  if (typeof card.pos.dvd !== 'boolean') card.pos.dvd = false;
  if (typeof card.duration !== 'number') card.duration = 2.0;
  if (typeof card.text !== 'string') card.text = '';
}

/* Drag & drop reorder */
let dragFromIndex = null;

function onDragStart(idx, el, e) {
  dragFromIndex = idx;
  el.classList.add('dragging');
  try {
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
  } catch {}
}
function onDragEnd(el) {
  el.classList.remove('dragging');
  [...cardsEl.querySelectorAll('.cardItem')].forEach(x => x.classList.remove('dropTarget'));
  dragFromIndex = null;
}
function onDragOver(targetEl, e) {
  e.preventDefault();
  targetEl.classList.add('dropTarget');
}
function onDragLeave(targetEl) {
  targetEl.classList.remove('dropTarget');
}
function onDrop(toIdx, targetEl, e) {
  e.preventDefault();
  targetEl.classList.remove('dropTarget');

  const fromIdx = dragFromIndex ?? Number(e.dataTransfer?.getData('text/plain'));
  if (!Number.isFinite(fromIdx) || fromIdx === toIdx) return;

  const item = cards.splice(fromIdx, 1)[0];
  cards.splice(toIdx, 0, item);

  renderCardsUI();
  if (!isPreviewing) drawFrame(0);
}

// Icons
const ICON_DUP = `
<svg viewBox="0 0 24 24" fill="none">
  <path d="M9 9h10v10H9V9Z" stroke="currentColor" stroke-width="2"/>
  <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="2"/>
</svg>`;
const ICON_DEL = `
<svg viewBox="0 0 24 24" fill="none">
  <path d="M6 7h12" stroke="currentColor" stroke-width="2"/>
  <path d="M10 11v7M14 11v7" stroke="currentColor" stroke-width="2"/>
  <path d="M9 7l1-2h4l1 2" stroke="currentColor" stroke-width="2"/>
  <path d="M7 7l1 14h8l1-14" stroke="currentColor" stroke-width="2"/>
</svg>`;

function renderCardsUI() {
  cardsEl.innerHTML = '';

  cards.forEach((c, idx) => {
    ensureCardDefaults(c);

    const wrap = document.createElement('div');
    wrap.className = 'cardItem';
    wrap.draggable = true;

    wrap.innerHTML = `
      <div class="cardTop">
        <div class="cardIdx">Card ${idx + 1}</div>
        <div class="iconRow">
          <button class="iconBtn" data-act="dup" title="Duplicate">${ICON_DUP}</button>
          <button class="iconBtn" data-act="del" title="Delete">${ICON_DEL}</button>
        </div>
      </div>

      <div class="split">
        <label>
          Text
          <textarea data-field="text"></textarea>
        </label>
        <label>
          Seconds
          <input data-field="duration" type="number" min="0.1" step="0.1" />
        </label>
      </div>

      <div class="posRow">
        <label>
          Position
          <select data-field="preset">
            <option value="top-left">Top Left</option>
            <option value="top">Top</option>
            <option value="top-right">Top Right</option>
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
            <option value="bottom-left">Bottom Left</option>
            <option value="bottom">Bottom</option>
            <option value="bottom-right">Bottom Right</option>
          </select>
        </label>

        <label class="check">
          <input data-field="dvd" type="checkbox" />
          <span>DVD Mode</span>
        </label>
      </div>
    `;

    const ta = wrap.querySelector('textarea[data-field="text"]');
    const dur = wrap.querySelector('input[data-field="duration"]');
    const presetSel = wrap.querySelector('select[data-field="preset"]');
    const dvdEl = wrap.querySelector('input[data-field="dvd"]');

    ta.value = c.text ?? '';
    autosizeTA(ta);

    dur.value = Number(c.duration || 0).toString();
    presetSel.value = c.pos?.preset || 'center';
    dvdEl.checked = !!c.pos?.dvd;

    const syncDvdUi = () => {
      const dvdOn = !!dvdEl.checked;
      presetSel.disabled = dvdOn;
      presetSel.style.opacity = dvdOn ? '0.6' : '1';
    };
    syncDvdUi();

    ta.addEventListener('input', () => {
      cards[idx].text = ta.value;
      autosizeTA(ta);
      if (!isPreviewing) drawFrame(0);
    });

    dur.addEventListener('input', () => {
      cards[idx].duration = Math.max(0.1, Number(dur.value || 0.1));
      updateMeta();
    });

    presetSel.addEventListener('change', () => {
      cards[idx].pos.preset = presetSel.value;
      if (!isPreviewing) drawFrame(0);
    });

    dvdEl.addEventListener('change', () => {
      cards[idx].pos.dvd = !!dvdEl.checked;
      syncDvdUi();
      if (!isPreviewing) drawFrame(0);
    });

    wrap.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const act = btn.getAttribute('data-act');
        if (act === 'del') cards.splice(idx, 1);
        else if (act === 'dup') cards.splice(idx + 1, 0, JSON.parse(JSON.stringify(cards[idx])));

        renderCardsUI();
        updateMeta();
        if (!isPreviewing) drawFrame(0);
      });
    });

    wrap.addEventListener('dragstart', (e) => onDragStart(idx, wrap, e));
    wrap.addEventListener('dragend', () => onDragEnd(wrap));
    wrap.addEventListener('dragover', (e) => onDragOver(wrap, e));
    wrap.addEventListener('dragleave', () => onDragLeave(wrap));
    wrap.addEventListener('drop', (e) => onDrop(idx, wrap, e));

    cardsEl.appendChild(wrap);
  });

  updateMeta();
}

btnAdd.addEventListener('click', () => {
  cards.push({ text: 'New card', duration: 2.0, pos: { preset: 'center', x: 0.5, y: 0.5, dvd: false } });
  renderCardsUI();
  if (!isPreviewing) drawFrame(0);
});

btnLoadExample.addEventListener('click', () => {
  cards = [
    { text: 'Welcome back.', duration: 2.5, pos: { preset: 'center', x: 0.5, y: 0.5, dvd: false } },
    { text: 'This is a handmade commercial.', duration: 2.5, pos: { preset: 'center', x: 0.5, y: 0.5, dvd: false } },
    { text: 'It sells nothing.', duration: 2.5, pos: { preset: 'center', x: 0.5, y: 0.5, dvd: false } },
    { text: 'Tunarr will now pretend it\'s cable.', duration: 2.5, pos: { preset: 'center', x: 0.5, y: 0.5, dvd: false } },
    { text: 'You will pretend you didn\'t notice.', duration: 2.5, pos: { preset: 'center', x: 0.5, y: 0.5, dvd: false } },
    { text: 'Enjoy.', duration: 2.5, pos: { preset: 'center', x: 0.5, y: 0.5, dvd: false } },
    { text: '[your tag here]', duration: 4.0, pos: { preset: 'center', x: 0.5, y: 0.5, dvd: false } },
  ];
  renderCardsUI();
  if (!isPreviewing) drawFrame(0);
});

btnClear.addEventListener('click', () => {
  cards = [];
  renderCardsUI();
  drawFrame(0);
});

/* ---- Progress bar fix ---- */
async function recordCanvasToBlob({ mimeType, includeAudio }) {
  const { fps } = getSettings();
  drawFrame(0);

  const stream = canvas.captureStream(fps);

  let audioWasStarted = false;
  if (includeAudio && audioPlayer?.src && typeof audioPlayer.captureStream === 'function') {
    try {
      audioPlayer.currentTime = 0;
      await audioPlayer.play();
      audioWasStarted = true;

      const astream = audioPlayer.captureStream();
      for (const track of astream.getAudioTracks()) stream.addTrack(track);
    } catch {
      log('Audio captureStream failed, continuing without embedded audio...');
    }
  }

  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  let resolveStop;
  const stopped = new Promise((res) => resolveStop = res);
  recorder.onstop = () => resolveStop();

  if (bg.type === 'video' && bg.el) {
    try { bg.el.currentTime = 0; } catch {}
    try { await bg.el.play(); } catch {}
  }

  recorder.start(200);

  const dur = totalDuration();
  const startMs = performance.now();

  setStatus('Recording...');
  while (true) {
    const t = (performance.now() - startMs) / 1000;
    drawFrame(t);

    const p = clamp(t / dur, 0, 1);
    setProgress(p * 0.9);
    setStatus(`Recording... ${t.toFixed(1)} / ${dur.toFixed(1)}s`);

    if (t >= dur) break;
    await new Promise(r => setTimeout(r, 0));
  }

  recorder.stop();
  await stopped;

  if (audioWasStarted) {
    try { audioPlayer.pause(); audioPlayer.currentTime = 0; } catch {}
  }

  return new Blob(chunks, { type: mimeType || 'video/webm' });
}

/* ---- FFmpeg ---- */
async function fetchWithProgress(url, label, timeoutMs = 120000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    setStatus(label);
    const res = await fetch(url, { signal: ctrl.signal, cache: 'force-cache' });
    if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`);
    const buf = await res.arrayBuffer();
    return { buf, total: buf.byteLength };
  } finally { clearTimeout(t); }
}

async function toBlobURL(url, mimeType, label) {
  const { buf } = await fetchWithProgress(url, label || `Downloading ${url}`);
  const blob = new Blob([buf], { type: mimeType });
  return URL.createObjectURL(blob);
}

async function loadFFmpegIfNeeded() {
  if (ffmpegLoaded) return;

  setProgress(0);
  if (logEl) logEl.textContent = '';
  setStatus('Loading ffmpeg-core (first time only)...');

  ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => log(message));
  ffmpeg.on('progress', ({ progress }) => {
    if (typeof progress === 'number') setProgress(0.9 + progress * 0.1);
  });

  const coreBase = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd';
  const ffBase = 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/dist/esm';

  const workerURL = await toBlobURL(`${ffBase}/worker.js`, 'text/javascript', 'Downloading worker.js...');
  const coreURL = await toBlobURL(`${coreBase}/ffmpeg-core.js`, 'text/javascript', 'Downloading ffmpeg-core.js...');
  const wasmURL = await toBlobURL(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm', 'Downloading ffmpeg-core.wasm...');

  setStatus('Initializing ffmpeg (compiling wasm)...');
  await ffmpeg.load({ workerURL, classWorkerURL: workerURL, coreURL, wasmURL });

  ffmpegLoaded = true;
  setProgress(0);
  setStatus('ffmpeg loaded.');
}

function pickMp4Mime() {
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4'
  ];
  for (const c of candidates) { try { if (MediaRecorder.isTypeSupported(c)) return c; } catch {} }
  return '';
}

function pickWebmMime() {
  const candidates = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
  for (const c of candidates) { if (MediaRecorder.isTypeSupported(c)) return c; }
  return '';
}

function fileExt(name) {
  const m = (name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : 'bin';
}

async function muxToMp4(webmBlob, audioFileObjOrNull) {
  await loadFFmpegIfNeeded();
  setStatus('Converting to MP4...');

  const webmData = new Uint8Array(await webmBlob.arrayBuffer());
  await ffmpeg.writeFile('input.webm', webmData);

  if (audioFileObjOrNull) {
    const ext = fileExt(audioFileObjOrNull.name);
    const audioName = `music.${ext}`;
    const audioData = new Uint8Array(await audioFileObjOrNull.arrayBuffer());
    await ffmpeg.writeFile(audioName, audioData);

    await ffmpeg.exec([
      '-i', 'input.webm',
      '-i', audioName,
      '-c:v', 'mpeg4',
      '-q:v', '2',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      'output.mp4',
    ]);
  } else {
    await ffmpeg.exec([
      '-i', 'input.webm',
      '-c:v', 'mpeg4',
      '-q:v', '2',
      '-pix_fmt', 'yuv420p',
      'output.mp4',
    ]);
  }

  const out = await ffmpeg.readFile('output.mp4');
  return new Blob([out.buffer], { type: 'video/mp4' });
}

btnExport.addEventListener('click', async () => {
  if (!cards.length) return;

  stopPreview();
  canvas.style.display = 'block';
  resultVideo.style.display = 'none';

  if (logEl) logEl.textContent = '';
  setProgress(0);
  setStatus('Starting export...');

  btnPreview.disabled = true;
  btnExport.disabled = true;
  btnStop.disabled = true;

  try {
    const audio = currentAudioFile;

    const mp4Mime = pickMp4Mime();
    const canEmbedAudio = !!(audio && typeof audioPlayer.captureStream === 'function');
    let mp4;

    if (mp4Mime) {
      const mp4Direct = await recordCanvasToBlob({ mimeType: mp4Mime, includeAudio: canEmbedAudio });
      if (canEmbedAudio) mp4 = mp4Direct;
      else {
        if (audio) {
          const webmForMux = await recordCanvasToBlob({ mimeType: pickWebmMime(), includeAudio: false });
          mp4 = await muxToMp4(webmForMux, audio);
        } else mp4 = mp4Direct;
      }
    } else {
      const webm = await recordCanvasToBlob({ mimeType: pickWebmMime(), includeAudio: false });
      mp4 = await muxToMp4(webm, audio);
    }

    const url = URL.createObjectURL(mp4);

    canvas.style.display = 'none';
    resultVideo.src = url;
    resultVideo.style.display = 'block';

    downloadLink.href = url;
    downloadLink.download = `bump-${new Date().toISOString().replace(/[:.]/g,'-')}.mp4`;
    downloadLink.click();

    setProgress(1);
    setStatus('Done. Download started.');
  } catch (err) {
    console.error(err);
    setStatus('Export failed.');
    log(String(err?.message || err));
    setProgress(0);
  } finally {
    btnPreview.disabled = false;
    btnExport.disabled = false;
  }
});

for (const el of [
  resolutionSel, fpsSel, fontFamilyEl, fontSizeEl, enableFadeEl, enableGrainEl,
  bgFitEl, bgDimEl, bgMutePreviewEl, bgLoopEl
]) {
  if (!el) continue;
  el.addEventListener('change', () => { updateMeta(); if (!isPreviewing) drawFrame(0); });
  el.addEventListener('input',  () => { updateMeta(); if (!isPreviewing) drawFrame(0); });
}

renderCardsUI();
updateMeta();
drawFrame(0);