// Finger/mouse stroke-tracing practice: draw over a faint reference glyph on a canvas.
// This is a "tracing paper" style practice (not a stroke-order accuracy grader — true
// numbered stroke-order playback would need per-kanji vector stroke data, e.g. KanjiVG,
// which isn't bundled yet). Good for repetition muscle-memory practice.

function mountTracePad(container, kanjiChar) {
  container.innerHTML = `
    <div class="trace-wrap" id="trace-wrap">
      <div class="trace-guide">${kanjiChar}</div>
      <canvas id="trace-canvas"></canvas>
    </div>
    <div class="btn-row">
      <button class="btn secondary small" id="trace-clear">Clear</button>
      <button class="btn secondary small" id="trace-guide-toggle">Hide guide</button>
    </div>
  `;
  const wrap = container.querySelector('#trace-wrap');
  const guide = container.querySelector('.trace-guide');
  const canvas = container.querySelector('#trace-canvas');
  const size = 220;
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#b3282d';

  let drawing = false;
  let last = null;

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const point = (e.touches && e.touches[0]) ? e.touches[0] : e;
    return {
      x: (point.clientX - rect.left) * (canvas.width / rect.width),
      y: (point.clientY - rect.top) * (canvas.height / rect.height)
    };
  }

  function start(e) { drawing = true; last = pos(e); e.preventDefault(); }
  function move(e) {
    if (!drawing) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
    e.preventDefault();
  }
  function end() { drawing = false; last = null; }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);

  container.querySelector('#trace-clear').onclick = () => ctx.clearRect(0, 0, size, size);
  container.querySelector('#trace-guide-toggle').onclick = (e) => {
    const hidden = guide.style.visibility === 'hidden';
    guide.style.visibility = hidden ? 'visible' : 'hidden';
    e.target.textContent = hidden ? 'Hide guide' : 'Show guide';
  };
}
