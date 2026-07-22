// Main app: content loading + navigation + view rendering.

const CONTENT = 'content/';
const state = {
  kanjiByGrade: {},      // { 1: [ {kanji, strokes, onyomi, kunyomi, meaning, sentence, group, jlpt}, ... ] }
  groupsByGrade: {},     // { 1: { 1: [kanjiObjs...], 2: [...] } }
  vocabCategories: [],   // [{slug, title, tags, words: [...]}]
  grammarPoints: [],     // [{slug, title, jlpt, data, body}]
  readings: [],          // [{slug, title, jlpt, data, body}]
  otherNotes: [],        // [{slug, data, body}]
  fileList: [],
  viewStack: []
};

async function fetchText(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error('Failed to fetch ' + path);
  return res.text();
}

async function loadFileList() {
  const text = await fetchText(CONTENT + 'index.md');
  const lines = text.split(/\r?\n/).filter(l => l.startsWith('- '));
  state.fileList = lines.map(l => l.slice(2).trim());
}

async function loadKanjiGrade(grade) {
  if (state.kanjiByGrade[grade]) return state.kanjiByGrade[grade];
  const files = state.fileList.filter(f => new RegExp(`^kanji/grade${grade}/\\d+-.+\\.md$`).test(f));
  const items = [];
  for (const f of files) {
    const text = await fetchText(CONTENT + f);
    const { data, body } = parseFrontmatter(text);
    const jpMatch = body.match(/\*\*JP:\*\*\s*(.+)/);
    const readingMatch = body.match(/\*\*Reading:\*\*\s*(.+)/);
    const enMatch = body.match(/\*\*EN:\*\*\s*(.+)/);
    const orderMatch = f.match(/\/(\d+)-[^/]+\.md$/);
    items.push({
      kanji: data.kanji,
      strokes: data.strokes,
      onyomi: Array.isArray(data.onyomi) ? data.onyomi : [],
      kunyomi: Array.isArray(data.kunyomi) ? data.kunyomi : [],
      meaning: data.meaning,
      grade: data.grade,
      jlpt: data.jlpt,
      group: data.group,
      order: orderMatch ? parseInt(orderMatch[1], 10) : 0,
      sentence: {
        jp: jpMatch ? jpMatch[1].trim() : '',
        reading: readingMatch ? readingMatch[1].trim() : '',
        en: enMatch ? enMatch[1].trim() : ''
      }
    });
  }
  items.sort((a, b) => a.order - b.order);
  state.kanjiByGrade[grade] = items;
  const groups = {};
  items.forEach(k => { (groups[k.group] = groups[k.group] || []).push(k); });
  state.groupsByGrade[grade] = groups;
  return items;
}

async function loadVocab() {
  if (state.vocabCategories.length) return state.vocabCategories;
  const files = state.fileList.filter(f => /^vocab\/.+\.md$/.test(f) && f !== 'vocab/index.md');
  const cats = [];
  for (const f of files) {
    const text = await fetchText(CONTENT + f);
    const { data, body } = parseFrontmatter(text);
    const titleMatch = body.match(/^#\s+Vocabulary\s+—\s+(.+)$/m);
    const rows = parseMarkdownTable(body).slice(1); // skip header row
    cats.push({
      slug: f,
      title: titleMatch ? titleMatch[1].trim() : f,
      tags: data.tags || [],
      words: rows.map(r => ({ term: r[0], reading: r[1], meaning: r[2], jlpt: (r[3] || '').replace('#', ''), example: r[4] }))
    });
  }
  cats.sort((a, b) => a.title.localeCompare(b.title));
  state.vocabCategories = cats;
  return cats;
}

async function loadGrammar() {
  if (state.grammarPoints.length) return state.grammarPoints;
  const files = state.fileList.filter(f => /^grammar\/.+\.md$/.test(f) && f !== 'grammar/index.md');
  const points = [];
  for (const f of files) {
    const text = await fetchText(CONTENT + f);
    const { data, body } = parseFrontmatter(text);
    const titleMatch = body.match(/^#\s+(.+)$/m);
    points.push({ slug: f, title: titleMatch ? titleMatch[1].trim() : f, jlpt: data.jlpt, body });
  }
  points.sort((a, b) => (a.jlpt || '').localeCompare(b.jlpt || ''));
  state.grammarPoints = points;
  return points;
}

async function loadReadings() {
  if (state.readings.length) return state.readings;
  const files = state.fileList.filter(f => /^readings\/.+\.md$/.test(f) && f !== 'readings/index.md');
  const items = [];
  for (const f of files) {
    const text = await fetchText(CONTENT + f);
    const { data, body } = parseFrontmatter(text);
    const titleMatch = body.match(/^#\s+(.+)$/m);
    items.push({ slug: f, title: titleMatch ? titleMatch[1].trim() : f, jlpt: data.jlpt, body });
  }
  state.readings = items;
  return items;
}

async function loadOther() {
  if (state.otherNotes.length) return state.otherNotes;
  const files = state.fileList.filter(f => /^other\/.+\.md$/.test(f) && f !== 'other/index.md');
  const items = [];
  for (const f of files) {
    const text = await fetchText(CONTENT + f);
    const { data, body } = parseFrontmatter(text);
    const titleMatch = body.match(/^#\s+(.+)$/m);
    items.push({ slug: f, title: titleMatch ? titleMatch[1].trim() : f, body });
  }
  state.otherNotes = items;
  return items;
}

// ---------- Navigation ----------

const main = document.getElementById('app-main');
const headerTitle = document.getElementById('header-title');
const headerSub = document.getElementById('header-sub');
const backBtn = document.getElementById('back-btn');

function jlptBadge(jlpt) {
  return jlpt ? `<span class="jlpt-badge jlpt-${jlpt}">${jlpt}</span>` : '';
}

function pushView(render, title, sub = '') {
  state.viewStack.push({ render, title, sub });
  renderCurrent();
}

// Replaces the current top-of-stack view instead of pushing a new one, so
// lateral moves (prev/next kanji, prev/next group, switch grade, etc.) don't
// pile up the back-button history.
function replaceView(fn) {
  if (state.viewStack.length > 0) state.viewStack.pop();
  fn();
}

function renderCurrent() {
  const top = state.viewStack[state.viewStack.length - 1];
  headerTitle.textContent = top.title;
  headerSub.textContent = top.sub;
  backBtn.hidden = state.viewStack.length <= 1;
  main.scrollTop = 0;
  top.render();
}

backBtn.addEventListener('click', () => {
  if (state.viewStack.length > 1) {
    state.viewStack.pop();
    renderCurrent();
  }
});

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.viewStack = [];
    const view = btn.dataset.view;
    if (view === 'home') renderHome();
    if (view === 'kanji') renderKanjiHome();
    if (view === 'vocab') renderVocabHome();
    if (view === 'grammar') renderGrammarHome();
    if (view === 'readings') renderReadingsHome();
    if (view === 'other') renderOtherHome();
  });
});

// ---------- Home ----------

function renderHome() {
  pushView(() => {
    main.innerHTML = `
      <p style="color:var(--muted);margin-top:0">Goal: JLPT N3 → N2 → N1</p>
      <div class="tile-grid">
        <div class="tile" data-go="kanji"><span class="glyph">漢字</span><span class="label">Kanji</span><span class="sub">Grade 1 · 80</span></div>
        <div class="tile" data-go="vocab"><span class="glyph">語彙</span><span class="label">Vocabulary</span><span class="sub">Daily life & business</span></div>
        <div class="tile" data-go="grammar"><span class="glyph">文法</span><span class="label">Grammar</span><span class="sub">N5–N3 points</span></div>
        <div class="tile" data-go="readings"><span class="glyph">読解</span><span class="label">Readings</span><span class="sub">Short passages</span></div>
        <div class="tile" data-go="other"><span class="glyph">他</span><span class="label">Other</span><span class="sub">Roadmap & notes</span></div>
      </div>
    `;
    main.querySelectorAll('[data-go]').forEach(t => t.addEventListener('click', () => {
      document.querySelector(`.nav-btn[data-view="${t.dataset.go}"]`).click();
    }));
  }, 'Nihongo', 'Home');
}

// ---------- Kanji ----------

function renderKanjiHome() {
  pushView(async () => {
    main.innerHTML = '<p>Loading…</p>';
    await loadKanjiGrade(1);
    main.innerHTML = `
      <div class="section-title">Elementary grades</div>
      <div class="card" id="grade-1">Grade 1 — 80 kanji ${jlptBadge('N5')}</div>
      <div class="card coming-soon">Grade 2 — coming soon</div>
      <div class="card coming-soon">Grade 3 — coming soon</div>
      <div class="card coming-soon">Grade 4 — coming soon</div>
      <div class="card coming-soon">Grade 5 — coming soon</div>
      <div class="card coming-soon">Grade 6 — coming soon</div>
    `;
    document.getElementById('grade-1').addEventListener('click', () => renderGroupList(1));
  }, 'Kanji', 'Grades 1–6');
}

const BUILT_KANJI_GRADES = [1]; // grades with content available so far

function renderGroupList(grade) {
  pushView(() => {
    const groups = state.groupsByGrade[grade];
    const groupNums = Object.keys(groups).map(Number).sort((a, b) => a - b);
    const gradeTabs = [1, 2, 3, 4, 5, 6].map(g => {
      const built = BUILT_KANJI_GRADES.includes(g);
      return `<button class="grade-tab ${g === grade ? 'active' : ''}" data-grade="${g}" ${built ? '' : 'disabled'}>G${g}</button>`;
    }).join('');
    main.innerHTML = `
      <div class="grade-tabs">${gradeTabs}</div>
      <div class="group-list">` + groupNums.map(g => {
      const kanjiStr = groups[g].map(k => k.kanji).join('');
      return `<div class="card" data-group="${g}">
        <div><div class="group-kanji-preview">${kanjiStr}</div><div class="group-meta">Group ${String(g).padStart(2, '0')} · 5 kanji</div></div>
        <span>›</span>
      </div>`;
    }).join('') + `</div>`;
    main.querySelectorAll('[data-group]').forEach(el => {
      el.addEventListener('click', () => renderGroupDetail(grade, Number(el.dataset.group)));
    });
    main.querySelectorAll('.grade-tab').forEach(el => {
      el.addEventListener('click', async () => {
        const g = Number(el.dataset.grade);
        if (g === grade || el.disabled) return;
        await loadKanjiGrade(g);
        replaceView(() => renderGroupList(g));
      });
    });
  }, `Grade ${grade} Kanji`, `${Object.keys(state.groupsByGrade[grade]).length} groups of 5`);
}

function renderGroupDetail(grade, groupNum) {
  pushView(() => {
    const kanjiList = state.groupsByGrade[grade][groupNum];
    const groupNums = Object.keys(state.groupsByGrade[grade]).map(Number).sort((a, b) => a - b);
    const idx = groupNums.indexOf(groupNum);
    const prevNum = idx > 0 ? groupNums[idx - 1] : null;
    const nextNum = idx < groupNums.length - 1 ? groupNums[idx + 1] : null;
    main.innerHTML = `
      <div class="detail-nav">
        <button class="nav-arrow" id="prev-group-btn" ${prevNum === null ? 'disabled' : ''}>‹ Group ${prevNum !== null ? String(prevNum).padStart(2, '0') : ''}</button>
        <span class="nav-pos">Group ${idx + 1} / ${groupNums.length}</span>
        <button class="nav-arrow" id="next-group-btn" ${nextNum === null ? 'disabled' : ''}>Group ${nextNum !== null ? String(nextNum).padStart(2, '0') : ''} ›</button>
      </div>
      <div class="kanji-grid">
        ${kanjiList.map(k => `<div class="kanji-tile" data-kanji="${k.kanji}">${k.kanji}<span class="strokes-badge">${k.strokes}✍︎</span></div>`).join('')}
      </div>
      <div class="btn-row">
        <button class="btn" id="quiz-group-btn">Quiz this group (10 Q)</button>
      </div>
      <div id="quiz-area"></div>
    `;
    main.querySelectorAll('[data-kanji]').forEach(el => {
      el.addEventListener('click', () => renderKanjiDetail(grade, el.dataset.kanji));
    });
    if (prevNum !== null) {
      document.getElementById('prev-group-btn').addEventListener('click', () => replaceView(() => renderGroupDetail(grade, prevNum)));
    }
    if (nextNum !== null) {
      document.getElementById('next-group-btn').addEventListener('click', () => replaceView(() => renderGroupDetail(grade, nextNum)));
    }
    document.getElementById('quiz-group-btn').addEventListener('click', () => {
      const area = document.getElementById('quiz-area');
      const questions = buildQuizForGroup(kanjiList, state.kanjiByGrade[grade]);
      runQuiz(area, questions, (score, total) => {
        area.innerHTML = `<div class="quiz-score">${score} / ${total}</div><p style="text-align:center">${score === total ? 'Perfect! 🎉' : 'Good effort — review and try again.'}</p>
          <div class="btn-row"><button class="btn secondary" id="retry-quiz">Retry</button></div>`;
        document.getElementById('retry-quiz').addEventListener('click', () => document.getElementById('quiz-group-btn').click());
      });
    });
  }, `Group ${String(groupNum).padStart(2, '0')}`, `Grade ${grade}`);
}

function renderKanjiDetail(grade, kanjiChar) {
  const flat = state.kanjiByGrade[grade];
  const idx = flat.findIndex(x => x.kanji === kanjiChar);
  const k = flat[idx];
  const prevK = idx > 0 ? flat[idx - 1] : null;
  const nextK = idx < flat.length - 1 ? flat[idx + 1] : null;
  pushView(() => {
    main.innerHTML = `
      <div class="kanji-detail">
        <div class="detail-nav">
          <button class="nav-arrow" id="prev-kanji-btn" ${prevK ? '' : 'disabled'}>${prevK ? '‹ ' + prevK.kanji : '‹'}</button>
          <span class="nav-pos">${idx + 1} / ${flat.length}</span>
          <button class="nav-arrow" id="next-kanji-btn" ${nextK ? '' : 'disabled'}>${nextK ? nextK.kanji + ' ›' : '›'}</button>
        </div>
        <div class="kanji-glyph-big">${k.kanji}</div>
        <div class="kanji-meaning">${k.meaning} ${jlptBadge(k.jlpt)}</div>
        <div class="readings-row">
          <div><div class="rlabel">Strokes</div><div class="rval">${k.strokes}</div></div>
          <div><div class="rlabel">On-yomi</div><div class="rval">${k.onyomi.join('、') || '—'}</div></div>
          <div><div class="rlabel">Kun-yomi</div><div class="rval">${k.kunyomi.join('、') || '—'}</div></div>
        </div>
        <div class="sentence-block">
          <div class="jp">${k.sentence.jp} ${TTS.buttons(k.sentence.jp)}</div>
          <div class="reading">${k.sentence.reading}</div>
          <div class="en">${k.sentence.en}</div>
        </div>
        <div class="btn-row">
          <button class="btn secondary" id="stroke-order-btn">▶ Stroke order</button>
          <button class="btn secondary" id="practice-btn">✍️ Practice writing</button>
          <button class="btn" id="quiz-btn">Quiz me on this kanji</button>
        </div>
        <div id="kanji-extra"></div>
      </div>
    `;
    if (prevK) {
      document.getElementById('prev-kanji-btn').addEventListener('click', () => replaceView(() => renderKanjiDetail(grade, prevK.kanji)));
    }
    if (nextK) {
      document.getElementById('next-kanji-btn').addEventListener('click', () => replaceView(() => renderKanjiDetail(grade, nextK.kanji)));
    }
    document.getElementById('stroke-order-btn').addEventListener('click', () => {
      const extra = document.getElementById('kanji-extra');
      mountStrokeOrder(extra, k.kanji);
    });
    document.getElementById('practice-btn').addEventListener('click', () => {
      const extra = document.getElementById('kanji-extra');
      mountTracePad(extra, k.kanji);
    });
    document.getElementById('quiz-btn').addEventListener('click', () => {
      const extra = document.getElementById('kanji-extra');
      const questions = buildQuizForKanji(k, state.kanjiByGrade[grade]);
      runQuiz(extra, questions, (score, total) => {
        extra.innerHTML = `<div class="quiz-score">${score} / ${total}</div>`;
      });
    });
  }, `${k.kanji} — ${k.meaning}`, `Grade ${grade}`);
}

// ---------- Vocabulary ----------

function renderVocabHome() {
  pushView(async () => {
    main.innerHTML = '<p>Loading…</p>';
    const cats = await loadVocab();
    const total = cats.reduce((sum, c) => sum + c.words.length, 0);
    main.innerHTML = `<p style="color:var(--muted);margin-top:0">${total} words in this batch (pilot toward a 2,000–3,000 word target)</p>` +
      cats.map(c => `<div class="list-note" data-slug="${c.slug}"><div class="title">${c.title}</div><div class="group-meta">${c.words.length} words</div></div>`).join('');
    main.querySelectorAll('[data-slug]').forEach(el => {
      el.addEventListener('click', () => renderVocabCategory(el.dataset.slug));
    });
  }, 'Vocabulary', 'Daily life & business');
}

function splitExample(example) {
  const m = example.match(/^(.*?)\s*\*\(([^)]*)\)\*\s*$/);
  return m ? { jp: m[1].trim(), en: m[2].trim() } : { jp: example, en: '' };
}

// Cross-category word navigation: stepping past the last word of a category
// rolls into the first word of the next category (and vice versa), mirroring
// how kanji navigation rolls across group boundaries.
function nextVocabRef(catIdx, wordIdx) {
  const cat = state.vocabCategories[catIdx];
  if (wordIdx + 1 < cat.words.length) return { catIdx, wordIdx: wordIdx + 1 };
  if (catIdx + 1 < state.vocabCategories.length) return { catIdx: catIdx + 1, wordIdx: 0 };
  return null;
}
function prevVocabRef(catIdx, wordIdx) {
  if (wordIdx - 1 >= 0) return { catIdx, wordIdx: wordIdx - 1 };
  if (catIdx - 1 >= 0) return { catIdx: catIdx - 1, wordIdx: state.vocabCategories[catIdx - 1].words.length - 1 };
  return null;
}

function renderVocabCategory(slug) {
  const catIdx = state.vocabCategories.findIndex(c => c.slug === slug);
  const cat = state.vocabCategories[catIdx];
  pushView(() => {
    const prevCat = catIdx > 0 ? state.vocabCategories[catIdx - 1] : null;
    const nextCat = catIdx < state.vocabCategories.length - 1 ? state.vocabCategories[catIdx + 1] : null;
    const navRow = `
      <div class="detail-nav">
        <button class="nav-arrow" id="prev-theme-btn" ${prevCat ? '' : 'disabled'}>${prevCat ? '‹ ' + prevCat.title.replace('Vocabulary — ', '') : '‹'}</button>
        <span class="nav-pos">Theme ${catIdx + 1} / ${state.vocabCategories.length}</span>
        <button class="nav-arrow" id="next-theme-btn" ${nextCat ? '' : 'disabled'}>${nextCat ? nextCat.title.replace('Vocabulary — ', '') + ' ›' : '›'}</button>
      </div>
    `;
    main.innerHTML = navRow + cat.words.map((w, wordIdx) => {
      const ex = splitExample(w.example || '');
      return `
      <div class="card vocab-word-card" data-word-idx="${wordIdx}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div><strong style="font-size:18px">${w.term}</strong> <span style="color:var(--muted)">${w.reading}</span> ${jlptBadge(w.jlpt)}</div>
          ${TTS.buttons(w.term)}
        </div>
        <div>${w.meaning}</div>
        <div class="sentence-block" style="margin-top:8px">
          <div class="jp">${ex.jp} ${TTS.buttons(ex.jp)}</div>
          ${ex.en ? `<div class="en">${ex.en}</div>` : ''}
        </div>
      </div>
    `;
    }).join('');
    if (prevCat) document.getElementById('prev-theme-btn').addEventListener('click', () => replaceView(() => renderVocabCategory(prevCat.slug)));
    if (nextCat) document.getElementById('next-theme-btn').addEventListener('click', () => replaceView(() => renderVocabCategory(nextCat.slug)));
    main.querySelectorAll('.vocab-word-card').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('.speak-btn')) return; // don't open detail when tapping a listen button
        renderVocabWordDetail(catIdx, Number(el.dataset.wordIdx));
      });
    });
  }, cat.title.replace('Vocabulary — ', ''), 'Vocabulary');
}

function renderVocabWordDetail(catIdx, wordIdx) {
  const cat = state.vocabCategories[catIdx];
  const w = cat.words[wordIdx];
  const ex = splitExample(w.example || '');
  const prevRef = prevVocabRef(catIdx, wordIdx);
  const nextRef = nextVocabRef(catIdx, wordIdx);
  pushView(() => {
    main.innerHTML = `
      <div class="detail-nav">
        <button class="nav-arrow" id="prev-word-btn" ${prevRef ? '' : 'disabled'}>${prevRef ? '‹ ' + state.vocabCategories[prevRef.catIdx].words[prevRef.wordIdx].term : '‹'}</button>
        <span class="nav-pos">${wordIdx + 1} / ${cat.words.length}</span>
        <button class="nav-arrow" id="next-word-btn" ${nextRef ? '' : 'disabled'}>${nextRef ? state.vocabCategories[nextRef.catIdx].words[nextRef.wordIdx].term + ' ›' : '›'}</button>
      </div>
      <div class="kanji-detail">
        <div class="kanji-glyph-big" style="font-size:48px">${w.term}</div>
        <div class="kanji-meaning">${w.reading} ${jlptBadge(w.jlpt)}</div>
        <div style="margin:6px 0">${TTS.buttons(w.term)}</div>
        <div class="readings-row"><div><div class="rlabel">Meaning</div><div class="rval">${w.meaning}</div></div></div>
        <div class="sentence-block">
          <div class="jp">${ex.jp} ${TTS.buttons(ex.jp)}</div>
          ${ex.en ? `<div class="en">${ex.en}</div>` : ''}
        </div>
      </div>
    `;
    if (prevRef) document.getElementById('prev-word-btn').addEventListener('click', () => replaceView(() => renderVocabWordDetail(prevRef.catIdx, prevRef.wordIdx)));
    if (nextRef) document.getElementById('next-word-btn').addEventListener('click', () => replaceView(() => renderVocabWordDetail(nextRef.catIdx, nextRef.wordIdx)));
  }, `${w.term} — ${w.meaning}`, cat.title.replace('Vocabulary — ', ''));
}

// ---------- Grammar ----------

function renderGrammarHome() {
  pushView(async () => {
    main.innerHTML = '<p>Loading…</p>';
    const points = await loadGrammar();
    main.innerHTML = points.map(p => `<div class="list-note" data-slug="${p.slug}"><div class="title">${p.title}</div>${jlptBadge(p.jlpt)}</div>`).join('');
    main.querySelectorAll('[data-slug]').forEach(el => el.addEventListener('click', () => renderNoteBody('grammar', el.dataset.slug)));
  }, 'Grammar', 'N5–N3 points');
}

// ---------- Readings ----------

function renderReadingsHome() {
  pushView(async () => {
    main.innerHTML = '<p>Loading…</p>';
    const items = await loadReadings();
    main.innerHTML = items.map(p => `<div class="list-note" data-slug="${p.slug}"><div class="title">${p.title}</div>${jlptBadge(p.jlpt)}</div>`).join('');
    main.querySelectorAll('[data-slug]').forEach(el => el.addEventListener('click', () => renderNoteBody('readings', el.dataset.slug)));
  }, 'Readings', 'Short passages');
}

// ---------- Other ----------

function renderOtherHome() {
  pushView(async () => {
    main.innerHTML = '<p>Loading…</p>';
    const items = await loadOther();
    main.innerHTML = items.map(p => `<div class="list-note" data-slug="${p.slug}"><div class="title">${p.title}</div></div>`).join('');
    main.querySelectorAll('[data-slug]').forEach(el => el.addEventListener('click', () => renderNoteBody('other', el.dataset.slug)));
  }, 'Other', 'Roadmap & notes');
}

// ---------- Generic note body renderer (grammar/readings/other) ----------

function renderNoteBody(section, slug) {
  const list = section === 'grammar' ? state.grammarPoints : section === 'readings' ? state.readings : state.otherNotes;
  const note = list.find(n => n.slug === slug);
  pushView(() => {
    main.innerHTML = `<div class="md-body">${renderMarkdown(note.body)}</div>`;
    // Add listen buttons to lines containing Japanese text
    main.querySelectorAll('.md-body p').forEach(p => {
      if (/[぀-ヿ一-鿿]/.test(p.textContent)) {
        const btn = document.createElement('span');
        btn.innerHTML = ' ' + TTS.buttons(p.textContent.replace(/<[^>]+>/g, ''));
        p.appendChild(btn);
      }
    });
  }, note.title, section);
}

// ---------- Boot ----------

(async function boot() {
  try {
    await loadFileList();
    renderHome();
  } catch (e) {
    main.innerHTML = `<div class="empty-state">Couldn't load content.<br>${e.message}</div>`;
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
})();
