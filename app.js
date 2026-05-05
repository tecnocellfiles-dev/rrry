/* ===== PhotoSwipe App Logic ===== */

(function () {
  'use strict';

  // ── Estado de la aplicación ──────────────────────────────────────
  const state = {
    photos: [],        // { file, url, name }
    current: 0,        // índice de la foto activa
    saved: [],         // fotos guardadas
    deleted: [],       // fotos descartadas
    history: [],       // para deshacer: { index, action }
    dragging: false,
    startX: 0,
    startY: 0,
    currentX: 0,
  };

  // ── Elementos del DOM ────────────────────────────────────────────
  const screens = {
    start:  document.getElementById('screen-start'),
    swipe:  document.getElementById('screen-swipe'),
    result: document.getElementById('screen-result'),
  };

  const fileInput      = document.getElementById('file-input');
  const cardStack      = document.getElementById('card-stack');
  const btnBack        = document.getElementById('btn-back');
  const btnDelete      = document.getElementById('btn-delete');
  const btnSave        = document.getElementById('btn-save');
  const btnUndo        = document.getElementById('btn-undo');
  const btnDownloadAll = document.getElementById('btn-download-all');
  const btnRestart     = document.getElementById('btn-restart');
  const currentIndexEl = document.getElementById('current-index');
  const totalCountEl   = document.getElementById('total-count');
  const savedCountEl   = document.getElementById('saved-count');
  const progressBar    = document.getElementById('progress-bar');
  const resSaved       = document.getElementById('res-saved');
  const resDeleted     = document.getElementById('res-deleted');
  const resultGrid     = document.getElementById('result-grid');

  // ── Helpers de pantalla ──────────────────────────────────────────
  function showScreen(name) {
    Object.entries(screens).forEach(([k, el]) => {
      el.classList.toggle('active', k === name);
    });
  }

  // ── Carga de archivos ────────────────────────────────────────────
  fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;

    // Liberar URLs anteriores
    state.photos.forEach(p => URL.revokeObjectURL(p.url));

    state.photos   = files.map(f => ({
      file: f,
      url:  URL.createObjectURL(f),
      name: f.name,
    }));
    state.current  = 0;
    state.saved    = [];
    state.deleted  = [];
    state.history  = [];

    initSwipeScreen();
    showScreen('swipe');

    // Reset del input para permitir cargar los mismos archivos de nuevo
    fileInput.value = '';
  });

  // ── Inicializar pantalla de swipe ────────────────────────────────
  function initSwipeScreen() {
    totalCountEl.textContent = state.photos.length;
    updateHeader();
    renderCardStack();
  }

  function updateHeader() {
    const shown = Math.min(state.current + 1, state.photos.length);
    currentIndexEl.textContent = shown;
    savedCountEl.textContent   = state.saved.length;
    btnUndo.disabled           = state.history.length === 0;

    const pct = (state.current / state.photos.length) * 100;
    progressBar.style.width = `${pct}%`;
  }

  // ── Renderizar stack de tarjetas ─────────────────────────────────
  function renderCardStack() {
    // Limpiar tarjetas existentes (mantener empty-state)
    Array.from(cardStack.querySelectorAll('.photo-card')).forEach(el => el.remove());

    const remaining = state.photos.slice(state.current, state.current + 3);

    if (remaining.length === 0) {
      showResults();
      return;
    }

    // Crear máx. 3 tarjetas (de atrás hacia adelante)
    remaining.slice().reverse().forEach((photo, revIdx) => {
      const idx = remaining.length - 1 - revIdx; // 0 = activa
      const card = createCard(photo, idx);
      cardStack.appendChild(card);
    });

    // La tarjeta activa (índice 0) recibe eventos
    const activeCard = cardStack.querySelector('.card-active');
    if (activeCard) attachDragEvents(activeCard);

    updateHeader();
  }

  function createCard(photo, stackPosition) {
    const card = document.createElement('div');
    card.className = 'photo-card';

    if (stackPosition === 0) card.classList.add('card-active');
    else if (stackPosition === 1) card.classList.add('card-bg-1');
    else card.classList.add('card-bg-2');

    const img = document.createElement('img');
    img.src = photo.url;
    img.draggable = false;
    img.alt = photo.name;

    // Overlays de decisión
    const overlayS = document.createElement('div');
    overlayS.className = 'card-overlay card-overlay-save';
    const labelS = document.createElement('div');
    labelS.className = 'card-overlay-label';
    labelS.textContent = 'GUARDAR';
    overlayS.appendChild(labelS);

    const overlayD = document.createElement('div');
    overlayD.className = 'card-overlay card-overlay-delete';
    const labelD = document.createElement('div');
    labelD.className = 'card-overlay-label';
    labelD.textContent = 'BORRAR';
    overlayD.appendChild(labelD);

    const info = document.createElement('div');
    info.className = 'card-info';
    const fname = document.createElement('div');
    fname.className = 'card-filename';
    fname.textContent = photo.name;
    info.appendChild(fname);

    card.append(img, overlayS, overlayD, info);
    return card;
  }

  // ── Gestos de arrastre ───────────────────────────────────────────
  const SWIPE_THRESHOLD = 80;   // px para activar swipe
  const TILT_MAX        = 20;   // grados máx. de inclinación

  function attachDragEvents(card) {
    // Touch
    card.addEventListener('touchstart', onDragStart, { passive: false });
    card.addEventListener('touchmove',  onDragMove,  { passive: false });
    card.addEventListener('touchend',   onDragEnd,   { passive: false });
    // Mouse
    card.addEventListener('mousedown',  onDragStart);
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup',  onDragEnd);
  }

  function getClientX(e) {
    return e.touches ? e.touches[0].clientX : e.clientX;
  }

  function onDragStart(e) {
    e.preventDefault();
    state.dragging = true;
    state.startX   = getClientX(e);
    state.currentX = 0;

    const card = e.currentTarget || e.target.closest('.photo-card');
    if (card) card.style.transition = 'none';
  }

  function onDragMove(e) {
    if (!state.dragging) return;
    e.preventDefault();

    const dx   = getClientX(e) - state.startX;
    state.currentX = dx;

    const card = cardStack.querySelector('.card-active');
    if (!card) return;

    const tilt  = Math.min(Math.abs(dx) / 8, TILT_MAX) * Math.sign(dx);
    const scale = 1 - Math.min(Math.abs(dx) / 800, 0.05);
    card.style.transform = `translateX(${dx}px) rotate(${tilt}deg) scale(${scale})`;

    const progress = Math.min(Math.abs(dx) / SWIPE_THRESHOLD, 1);
    const overlayS = card.querySelector('.card-overlay-save');
    const overlayD = card.querySelector('.card-overlay-delete');

    if (dx > 0) {
      overlayS.style.opacity = progress;
      overlayD.style.opacity = 0;
    } else {
      overlayD.style.opacity = progress;
      overlayS.style.opacity = 0;
    }
  }

  function onDragEnd(e) {
    if (!state.dragging) return;
    state.dragging = false;

    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup',  onDragEnd);

    const dx   = state.currentX;
    const card = cardStack.querySelector('.card-active');
    if (!card) return;

    card.style.transition = '';

    if (dx > SWIPE_THRESHOLD) {
      doSwipe('save', card);
    } else if (dx < -SWIPE_THRESHOLD) {
      doSwipe('delete', card);
    } else {
      // Volver al centro
      card.style.transform = '';
      card.querySelectorAll('.card-overlay').forEach(o => o.style.opacity = 0);
    }
  }

  // ── Acción de swipe ──────────────────────────────────────────────
  function doSwipe(action, card, animated = true) {
    const photo = state.photos[state.current];

    // Guardar en historial
    state.history.push({ index: state.current, action });

    if (action === 'save') {
      state.saved.push(photo);
    } else {
      state.deleted.push(photo);
    }

    if (animated) {
      card.classList.add(action === 'save' ? 'fly-right' : 'fly-left');
    }

    state.current++;

    setTimeout(() => {
      renderCardStack();
    }, animated ? 380 : 0);
  }

  // ── Botones de acción ────────────────────────────────────────────
  btnDelete.addEventListener('click', () => {
    const card = cardStack.querySelector('.card-active');
    if (!card) return;
    card.querySelector('.card-overlay-delete').style.opacity = 1;
    setTimeout(() => doSwipe('delete', card), 80);
  });

  btnSave.addEventListener('click', () => {
    const card = cardStack.querySelector('.card-active');
    if (!card) return;
    card.querySelector('.card-overlay-save').style.opacity = 1;
    setTimeout(() => doSwipe('save', card), 80);
  });

  // ── Deshacer ─────────────────────────────────────────────────────
  btnUndo.addEventListener('click', () => {
    if (!state.history.length) return;

    const last = state.history.pop();

    // Revertir la acción
    if (last.action === 'save') {
      state.saved.pop();
    } else {
      state.deleted.pop();
    }

    state.current = last.index;
    renderCardStack();

    // Animación de rebote
    setTimeout(() => {
      const card = cardStack.querySelector('.card-active');
      if (card) card.classList.add('pop-in');
    }, 30);
  });

  // ── Volver ───────────────────────────────────────────────────────
  btnBack.addEventListener('click', () => {
    if (confirm('¿Volver al inicio? Se perderá el progreso.')) {
      showScreen('start');
    }
  });

  // ── Mostrar resultados ───────────────────────────────────────────
  function showResults() {
    resSaved.textContent   = state.saved.length;
    resDeleted.textContent = state.deleted.length;
    progressBar.style.width = '100%';

    // Limpiar grid
    resultGrid.innerHTML = '';

    state.saved.forEach((photo) => {
      const thumb = document.createElement('div');
      thumb.className = 'result-thumb';

      const img = document.createElement('img');
      img.src = photo.url;
      img.alt = photo.name;

      const check = document.createElement('div');
      check.className = 'thumb-check';
      check.textContent = '✓';

      thumb.append(img, check);
      resultGrid.appendChild(thumb);
    });

    if (state.saved.length === 0) {
      resultGrid.innerHTML = '<p style="color:var(--text-muted);grid-column:1/-1;text-align:center;padding:1rem">Ninguna foto guardada</p>';
    }

    showScreen('result');
  }

  // ── Descargar fotos guardadas ────────────────────────────────────
  btnDownloadAll.addEventListener('click', async () => {
    if (!state.saved.length) {
      alert('No hay fotos guardadas para descargar.');
      return;
    }

    // Descargar una por una
    for (let i = 0; i < state.saved.length; i++) {
      const photo = state.saved[i];
      const a = document.createElement('a');
      a.href = photo.url;
      a.download = photo.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Pequeño delay para no saturar el navegador
      await new Promise(r => setTimeout(r, 200));
    }
  });

  // ── Reiniciar ────────────────────────────────────────────────────
  btnRestart.addEventListener('click', () => {
    // Liberar URLs de objeto
    state.photos.forEach(p => URL.revokeObjectURL(p.url));
    state.photos  = [];
    state.current = 0;
    state.saved   = [];
    state.deleted = [];
    state.history = [];
    showScreen('start');
  });

  // ── Soporte para teclado (accesibilidad / pruebas en escritorio) ─
  document.addEventListener('keydown', (e) => {
    if (!screens.swipe.classList.contains('active')) return;

    if (e.key === 'ArrowLeft') {
      const card = cardStack.querySelector('.card-active');
      if (card) doSwipe('delete', card);
    } else if (e.key === 'ArrowRight') {
      const card = cardStack.querySelector('.card-active');
      if (card) doSwipe('save', card);
    } else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      btnUndo.click();
    }
  });

})();
