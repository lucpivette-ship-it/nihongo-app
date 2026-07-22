// Stroke-by-stroke animation for kanji, using the HanziWriter library (loaded
// from CDN in index.html) and per-character stroke path data from the
// hanzi-writer-data package (also fetched from a CDN on first view, then
// cached by the service worker for offline use afterwards).
//
// Note: hanzi-writer-data is built from a Chinese-hanzi stroke order dataset.
// For the vast majority of shared Han characters the stroke order matches the
// Japanese school convention, but a handful of characters can differ slightly
// from the official Japanese textbook stroke order. Treat this as a strong
// visual guide rather than an official JLPT/MEXT stroke-order reference.

const STROKE_DATA_BASE = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@latest/';

function mountStrokeOrder(container, kanjiChar) {
  container.innerHTML = `
    <div class="stroke-order-panel">
      <div id="stroke-target" class="stroke-target"></div>
      <div class="btn-row">
        <button class="btn secondary" id="stroke-replay-btn">↻ Replay</button>
      </div>
    </div>
  `;

  if (typeof HanziWriter === 'undefined') {
    container.querySelector('.stroke-order-panel').innerHTML =
      '<p class="empty-state">Stroke order animation isn\'t available right now (needs an internet connection the first time a kanji is viewed).</p>';
    return;
  }

  let writer;
  try {
    writer = HanziWriter.create('stroke-target', kanjiChar, {
      width: 220,
      height: 220,
      padding: 12,
      strokeColor: '#b3282d',
      radicalColor: '#b3282d',
      outlineColor: '#ddd',
      showOutline: true,
      strokeAnimationSpeed: 0.8,
      delayBetweenStrokes: 350,
      charDataLoader: (char, onComplete, onError) => {
        fetch(STROKE_DATA_BASE + encodeURIComponent(char) + '.json')
          .then((res) => {
            if (!res.ok) throw new Error('no data');
            return res.json();
          })
          .then(onComplete)
          .catch(() => {
            const panel = container.querySelector('.stroke-order-panel');
            if (panel) panel.innerHTML = '<p class="empty-state">Stroke order data isn\'t available for this kanji yet.</p>';
            if (onError) onError();
          })
      }
    });
  } catch (e) {
    container.querySelector('.stroke-order-panel').innerHTML = '<p class="empty-state">Couldn\'t load stroke order for this kanji.</p>';
    return;
  }

  writer.animateCharacter();
  const replayBtn = document.getElementById('stroke-replay-btn');
  if (replayBtn) replayBtn.addEventListener('click', () => writer.animateCharacter());
}
