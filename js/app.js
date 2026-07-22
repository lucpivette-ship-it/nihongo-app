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

function renderGroupList(grade) {
    pushView(() => {
          const groups = state.groupsByGrade[grade];
          const groupNums = Object.keys(groups).map(Number).sort((a, b) => a - b);
          main.innerHTML = `<div class="group-list">` + groupNums.map(g => {
                  const kanjiStr = groups[g].map(k => k.kanji).join('');
                  return `<div class="card" data-group="${g}">
                          <div><div class="group-kanji-preview">${kanjiStr}</div><div class="group-meta">Group ${String(g).padStart(2, '0')} · 5 kanji</div></div>
                                  <span>›</span>
                                        </div>`;
          }).join('') + `</div>`;
          main.querySelectorAll('[data-group]').forEach(el => {
                  el.addEventListener('click', () => renderGroupDetail(grade, Number(el.dataset.group)));
          });
    }, 'Grade 1 Kanji', '16 groups of 5');
}

function renderGroupDetail(grade, groupNum) {
    pushView(() => {
          const kanjiList = state.groupsByGrade[grade][groupNum];
          main.innerHTML = `
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
          document.getElementById('quiz-group-btn').addEventListener('click', () => {
                  const area = document.getElementById('quiz-area');
                  const questions = buildQuizForGroup(kanjiList, state.kanjiByGrade[grade]);
                  runQuiz(area, questions, (score, total) => {
                            area.innerHTML = `<div class="quiz-score">${score} / ${total}</div><p style="text-align:center">${score === total ? 'Perfect! 🎉' : 'Good effort — review and try again.'}</p>
                                      <div class="btn-row"><button class="btn secondary" id="retry-quiz">Retry</button></div>`;
                            document.getElementById('retry-quiz').addEventListener('click', () => document.getElementById('quiz-group-btn').click());
                  });
          });
    }, `Group ${String(groupNum).padStart(2, '0')}`, 'Grade 1');
}

function renderKanjiDetail(grade, kanjiChar) {
    const k = state.kanjiByGrade[grade].find(x => x.kanji === kanjiChar);
    pushView(() => {
          main.innerHTML = `
                <div class="kanji-detail">
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
                                                                                                                                              <button class="btn secondary" id="practice-btn">✍️ Practice writing</button>
                                                                                                                                                        <button class="btn" id="quiz-btn">Quiz me on this kanji</button>
                                                                                                                                                                </div>
                                                                                                                                                                        <div id="kanji-extra"></div>
                                                                                                                                                                              </div>
                                                                                                                                                                                  `;
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

function renderVocabCategory(slug) {
    pushView(() => {
          const cat = state.vocabCategories.find(c => c.slug === slug);
          main.innerHTML = cat.words.map(w => {
                  const ex = splitExample(w.example || '');
                  return `
                        <div class="card">
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
    }, state.vocabCategories.find(c => c.slug === slug).title.replace('Vocabulary — ', ''), 'Vocabulary');
}

function renderGrammarHome() {
    pushView(async () => {
          main.innerHTML = '<p>Loading…</p>';
          const points = await loadGrammar();
          main.innerHTML = points.map(p => `<div class="list-note" data-slug="${p.slug}"><div class="title">${p.title}</div>${jlptBadge(p.jlpt)}</div>`).join('');
          main.querySelectorAll('[data-slug]').forEach(el => el.addEventListener('click', () => renderNoteBody('grammar', el.dataset.slug)));
    }, 'Grammar', 'N5–N3 points');
}

function renderReadingsHome() {
    pushView(async () => {
          main.innerHTML = '<p>Loading…</p>';
          const items = await loadReadings();
          main.innerHTML = items.map(p => `<div class="list-note" data-slug="${p.slug}"><div class="title">${p.title}</div>${jlptBadge(p.jlpt)}</div>`).join('');
          main.querySelectorAll('[data-slug]').forEach(el => el.addEventListener('click', () => renderNoteBody('readings', el.dataset.slug)));
    }, 'Readings', 'Short passages');
}

function renderOtherHome() {
    pushView(async () => {
          main.innerHTML = '<p>Loading…</p>';
          const items = await loadOther();
          main.innerHTML = items.map(p => `<div class="list-note" data-slug="${p.slug}"><div class="title">${p.title}</div></div>`).join('');
          main.querySelectorAll('[data-slug]').forEach(el => el.addEventListener('click', () => renderNoteBody('other', el.dataset.slug)));
    }, 'Other', 'Roadmap & notes');
}

function renderNoteBody(section, slug) {
    const list = section === 'grammar' ? state.grammarPoints : section === 'readings' ? state.readings : state.otherNotes;
    const note = list.find(n => n.slug === slug);
    pushView(() => {
          main.innerHTML = `<div class="md-body">${renderMarkdown(note.body)}</div>`;
          main.querySelectorAll('.md-body p').forEach(p => {
                  if (/[぀-ヿ一-鿿]/.test(p.textContent)) {
                            const btn = document.createElement('span');
                            btn.innerHTML = ' ' + TTS.buttons(p.textContent.replace(/<[^>]+>/g, ''));
                            p.appendChild(btn);
                  }
          });
    }, note.title, section);
}

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
