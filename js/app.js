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

async function fetchText(path, opts = {}) {
  const res = await fetch(path, opts.noStore ? { cache: 'no-store' } : undefined);
  if (!res.ok) throw new Error('Failed to fetch ' + path);
  return res.text();
}

async function loadFileList() {
  // The index itself must always be fresh (see PROJECT_LOG "browser HTTP
  // cache" note) so newly-added content is discovered immediately. Individual
  // note files below are fetched with normal caching so repeat visits are
  // fast — the tradeoff (an edited-in-place note staying stale until the
  // browser's cache expires) is minor compared to the index.md staleness bug.
  const text = await fetchText(CONTENT + 'index.md', { noStore: true });
  const lines = text.split(/\r?\n/).filter(l => l.startsWith('- '));
  state.fileList = lines.map(l => l.slice(2).trim());
}

// Parses one or more example blocks from a kanji note body. Supports two
// formats: the original single-example format used by the 1,026 elementary
// kanji ("## Example sentence" with one JP/Reading/EN triple), and the
// per-reading format used from N3 onward ("## Example: On-yomi (sei)" /
// "## Example: Kun-yomi (matsurigoto)", one block per on'yomi/kun'yomi
// reading — see PROJECT_LOG "kanji reading examples" note). Both formats
// produce the same `examples` array shape so the renderer doesn't need to
// know which format a given note used.
function parseKanjiExamples(body) {
  const sections = body.split(/\n(?=##\s)/);
  const examples = [];
  sections.forEach(sec => {
    const headingMatch = sec.match(/^##\s*Example(?:\s*:\s*(On-yomi|Kun-yomi)\s*\(([^)]*)\))?/i);
    if (!headingMatch) return;
    const jpMatch = sec.match(/\*\*JP:\*\*\s*(.+)/);
    if (!jpMatch) return;
    const readingMatch = sec.match(/\*\*Reading:\*\*\s*(.+)/);
    const enMatch = sec.match(/\*\*EN:\*\*\s*(.+)/);
    examples.push({
      type: headingMatch[1] ? headingMatch[1].replace('-yomi', '').toLowerCase() : '', // 'on' | 'kun' | ''
      reading: headingMatch[2] || '',
      jp: jpMatch[1].trim(),
      reading_text: readingMatch ? readingMatch[1].trim() : '',
      en: enMatch ? enMatch[1].trim() : ''
    });
  });
  return examples;
}

async function loadKanjiGrade(grade) {
  if (state.kanjiByGrade[grade]) return state.kanjiByGrade[grade];
  const files = state.fileList.filter(f => new RegExp(`^kanji/grade${grade}/\\d+-.+\\.md$`).test(f));
  const items = await Promise.all(files.map(async (f) => {
    const text = await fetchText(CONTENT + f);
    const { data, body } = parseFrontmatter(text);
    const examples = parseKanjiExamples(body);
    const orderMatch = f.match(/\/(\d+)-[^/]+\.md$/);
    return {
      kanji: data.kanji,
      strokes: data.strokes,
      onyomi: Array.isArray(data.onyomi) ? data.onyomi : [],
      kunyomi: Array.isArray(data.kunyomi) ? data.kunyomi : [],
      meaning: data.meaning,
      grade: data.grade,
      jlpt: data.jlpt,
      group: data.group,
      order: orderMatch ? parseInt(orderMatch[1], 10) : 0,
      examples,
      // Backward-compat single-sentence accessor: quiz.js and older code
      // just want "a" sentence, so give it the first example.
      sentence: examples[0] || { jp: '', reading: '', en: '' }
    };
  }));
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
  const cats = await Promise.all(files.map(async (f) => {
    const text = await fetchText(CONTENT + f);
    const { data, body } = parseFrontmatter(text);
    const titleMatch = body.match(/^#\s+Vocabulary\s+—\s+(.+)$/m);
    const rows = parseMarkdownTable(body).slice(1); // skip header row
    return {
      slug: f,
      title: titleMatch ? titleMatch[1].trim() : f,
      tags: data.tags || [],
      words: rows.map(r => ({ term: r[0], reading: r[1], meaning: r[2], jlpt: (r[3] || '').replace('#', ''), example: r[4] }))
    };
  }));
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
          const h2Count = (body.match(/^##\s+/gm) || []).length;
          if (h2Count >= 2) {
                const parts = body.split(/^##\s+/m).slice(1);
                parts.forEach((part, i) => {
                      const nl = part.indexOf('\n');
                      const title = (nl === -1 ? part : part.slice(0, nl)).trim();
                      const rest = (nl === -1 ? '' : part.slice(nl + 1)).trim();
                      const jlptMatch = rest.match(/\*\*JLPT:\*\*\s*(N\d)/);
                      points.push({ slug: f + '::' + i, title, jlpt: jlptMatch ? jlptMatch[1] : data.jlpt, body: rest });
                });
          } else {
                const titleMatch = body.match(/^#\s+(.+)$/m);
                points.push({ slug: f, title: titleMatch ? titleMatch[1].trim() : f, jlpt: data.jlpt, body });
          }
    }
    points.sort((a, b) => parseInt((b.jlpt||'N0').replace('N',''),10) - parseInt((a.jlpt||'N0').replace('N',''),10));
    state.grammarPoints = points;
    return points;
}

async function loadReadings() {
  if (state.readings.length) return state.readings;
  const files = state.fileList.filter(f => /^readings\/.+\.md$/.test(f) && f !== 'readings/index.md');
  const items = await Promise.all(files.map(async (f) => {
    const text = await fetchText(CONTENT + f);
    const { data, body } = parseFrontmatter(text);
    const titleMatch = body.match(/^#\s+(.+)$/m);
    return { slug: f, title: titleMatch ? titleMatch[1].trim() : f, jlpt: data.jlpt, body };
  }));
  state.readings = items;
  return items;
}

async function loadOther() {
  if (state.otherNotes.length) return state.otherNotes;
  const files = state.fileList.filter(f => /^other\/.+\.md$/.test(f) && f !== 'other/index.md');
  const items = await Promise.all(files.map(async (f) => {
    const text = await fetchText(CONTENT + f);
    const { data, body } = parseFrontmatter(text);
    const titleMatch = body.match(/^#\s+(.+)$/m);
    return { slug: f, title: titleMatch ? titleMatch[1].trim() : f, body };
  }));
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
        <div class="tile" data-go="kanji"><span class="glyph">漢字</span><span class="label">Kanji</span><span class="sub">1,026 elementary + remaining jōyō in progress</span></div>
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

// Grades 1-6 are the MEXT elementary kyoiku kanji. Grades 7-9 are a
// repurposing of the same "grade" plumbing to carry the remaining jouyou
// kanji (the ones NOT taught in elementary school).
//
// Note (2026-07-28): the original plan was to source these tier-by-tier
// from jlptsensei's per-level N3/N2/N1 kanji lists. That backfired — a
// dedup check showed jlptsensei's "N3" list of 370 kanji overlaps the
// existing 1,026 elementary kanji by 320 (86%), because JLPT level and
// school grade are independent classifications; a kanji can be taught in
// grade 4 and still be legitimately "N3 material" for exam purposes. So
// per-JLPT-level lists are a bad source for "what's left to build."
//
// Fixed by switching to KANJIDIC2's grade classification (via kanjiapi.dev):
// grade 8 = jouyou kanji taught in secondary school, i.e. exactly "every
// jouyou kanji not in the elementary 1,026" (1,134 kanji, only 20 overlap
// with elementary -- the 47 prefecture-name kanji, which MEXT teaches in
// grade 4 as a special exception -- leaving 1,114 genuinely new kanji).
// That 1,114-kanji pool is what grades 7/8/9 are built from now, in
// KANJIDIC's canonical (radical/stroke) order, split into three batches.
//
// Because this pool isn't JLPT-level-exclusive, individual kanji are
// tagged with their own true jlpt value (kanjiapi's per-character field,
// old 4-level scale 1=hardest..4=easiest, mapped 3->N3, 2->N2, 1 or
// null->N1) rather than assuming every kanji in a tier is the same level --
// see GRADE_LABEL below, which no longer claims a single JLPT level per
// tier.
const ELEMENTARY_GRADES = [1, 2, 3, 4, 5, 6];
const TIER_GRADES = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29];
const ALL_KANJI_GRADES = ELEMENTARY_GRADES.concat(TIER_GRADES);
const BUILT_KANJI_GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]; // grades with content available so far — grade29 (2026-08-13) completes the full 1,114-kanji remaining-jouyou pool
const GRADE_KANJI_COUNTS = { 1: 80, 2: 160, 3: 200, 4: 202, 5: 193, 6: 191 }; // final counts for finished grades; tiers use live counts instead (see kanjiCountLabel)
const GRADE_KANJI_TARGET = { 7: 50, 8: 50, 9: 50, 10: 50, 11: 50, 12: 50, 13: 50, 14: 50, 15: 50, 16: 50, 17: 50, 18: 50, 19: 50, 20: 50, 21: 50, 22: 50, 23: 50, 24: 50, 25: 50, 26: 50, 27: 50, 28: 50, 29: 14 }; // each remaining-jouyou batch is a fixed 50 kanji (fixed 2026-07-30: was a stale ~371/372 split left over from an abandoned 3-batch plan, which made every finished batch's tile misleadingly read "50 of 371/372 kanji") — grade29 is the final, smaller tail batch (14 kanji) that exhausts the pool
const GRADE_JLPT = { 1: 'N5', 2: 'N4', 3: 'N4', 4: 'N3', 5: 'N3', 6: 'N2' }; // tiers 7+ intentionally omitted: each kanji carries its own true jlpt tag instead (see note above)
const GRADE_LABEL = { 1: 'Grade 1', 2: 'Grade 2', 3: 'Grade 3', 4: 'Grade 4', 5: 'Grade 5', 6: 'Grade 6', 7: 'Remaining kanji (1)', 8: 'Remaining kanji (2)', 9: 'Remaining kanji (3)', 10: 'Remaining kanji (4)', 11: 'Remaining kanji (5)', 12: 'Remaining kanji (6)', 13: 'Remaining kanji (7)', 14: 'Remaining kanji (8)', 15: 'Remaining kanji (9)', 16: 'Remaining kanji (10)', 17: 'Remaining kanji (11)', 18: 'Remaining kanji (12)', 19: 'Remaining kanji (13)', 20: 'Remaining kanji (14)', 21: 'Remaining kanji (15)', 22: 'Remaining kanji (16)', 23: 'Remaining kanji (17)', 24: 'Remaining kanji (18)', 25: 'Remaining kanji (19)', 26: 'Remaining kanji (20)', 27: 'Remaining kanji (21)', 28: 'Remaining kanji (22)', 29: 'Remaining kanji (23, final)' };
const GRADE_TAB_LABEL = { 1: 'G1', 2: 'G2', 3: 'G3', 4: 'G4', 5: 'G5', 6: 'G6', 7: 'R1', 8: 'R2', 9: 'R3', 10: 'R4', 11: 'R5', 12: 'R6', 13: 'R7', 14: 'R8', 15: 'R9', 16: 'R10', 17: 'R11', 18: 'R12', 19: 'R13', 20: 'R14', 21: 'R15', 22: 'R16', 23: 'R17', 24: 'R18', 25: 'R19', 26: 'R20', 27: 'R21', 28: 'R22', 29: 'R23' };

// Display-only consolidation (2026-08-13): the 23 individual "Remaining
// kanji" tiles above (one per ~50-kanji batch/grade) made the Kanji home
// screen's second section unwieldy at full scale. Luc asked to regroup the
// HOME SCREEN into ~200-kanji tiles, with zero changes to underlying
// content, folders, or per-grade group/quiz data. So this is purely a
// display layer: each bucket below just lists which real grades it spans;
// every real (grade, groupNum) pair still flows into the unchanged
// renderGroupDetail/buildQuizForGroup exactly as before. Batch numbers in
// the labels (1–4, 5–8, ...) trace back to GRADE_LABEL's original
// "Remaining kanji (N)" numbering so history stays traceable.
const TIER_DISPLAY_GROUPS = [
  { grades: [7, 8, 9, 10], label: 'Remaining kanji (1–4)', tabLabel: 'R1-4' },
  { grades: [11, 12, 13, 14], label: 'Remaining kanji (5–8)', tabLabel: 'R5-8' },
  { grades: [15, 16, 17, 18], label: 'Remaining kanji (9–12)', tabLabel: 'R9-12' },
  { grades: [19, 20, 21, 22], label: 'Remaining kanji (13–16)', tabLabel: 'R13-16' },
  { grades: [23, 24, 25, 26], label: 'Remaining kanji (17–20)', tabLabel: 'R17-20' },
  { grades: [27, 28, 29], label: 'Remaining kanji (21–23, final)', tabLabel: 'R21-23' },
];

function tierIndexForGrade(grade) {
  return TIER_DISPLAY_GROUPS.findIndex(t => t.grades.includes(grade));
}

function tierKanjiCount(tier) {
  return tier.grades.reduce((sum, g) => sum + (GRADE_KANJI_TARGET[g] || 0), 0);
}

// Shared tab bar for both the single-grade (elementary) and tier-bucket
// (consolidated remaining-jōyō) group-list screens, so navigation is
// consistent everywhere in the Kanji section: 6 elementary tabs + 6 tier
// tabs, never the old 29 individual-grade tabs.
function kanjiNavTabsHtml(activeGrade, activeTierIndex) {
  const elementaryTabs = ELEMENTARY_GRADES.map(g => {
    const built = BUILT_KANJI_GRADES.includes(g);
    return `<button class="grade-tab ${g === activeGrade ? 'active' : ''}" data-nav="grade:${g}" ${built ? '' : 'disabled'}>${GRADE_TAB_LABEL[g]}</button>`;
  }).join('');
  const tierTabs = TIER_DISPLAY_GROUPS.map((t, i) => {
    const built = t.grades.every(g => BUILT_KANJI_GRADES.includes(g));
    return `<button class="grade-tab ${i === activeTierIndex ? 'active' : ''}" data-nav="tier:${i}" ${built ? '' : 'disabled'}>${t.tabLabel}</button>`;
  }).join('');
  return elementaryTabs + tierTabs;
}

function wireKanjiNavTabs(container) {
  container.querySelectorAll('.grade-tab').forEach(el => {
    el.addEventListener('click', async () => {
      if (el.disabled || el.classList.contains('active')) return;
      const [kind, val] = el.dataset.nav.split(':');
      if (kind === 'grade') {
        const g = Number(val);
        await loadKanjiGrade(g);
        replaceView(() => renderGroupList(g));
      } else {
        replaceView(() => renderTierGroupList(Number(val)));
      }
    });
  });
}

function kanjiCountLabel(g) {
  // Use a static count (GRADE_KANJI_COUNTS for elementary, GRADE_KANJI_TARGET
  // for remaining-jouyou tiers, which is always the true final count once a
  // batch is complete) whenever the grade hasn't been loaded yet, so the
  // Kanji home screen can render tile counts WITHOUT fetching every kanji
  // file first. See the 2026-08-13 fix below on why this matters at scale.
  const loaded = state.kanjiByGrade[g] ? state.kanjiByGrade[g].length : (GRADE_KANJI_COUNTS[g] || GRADE_KANJI_TARGET[g]);
  const target = GRADE_KANJI_TARGET[g];
  return (target && loaded !== target) ? `${loaded} of ${target} kanji` : `${loaded} kanji`;
}

function renderKanjiHome() {
  pushView(() => {
    // Fixed 2026-08-13: this used to `await Promise.all(BUILT_KANJI_GRADES.map(loadKanjiGrade))`
    // before rendering anything — i.e. fetch every one of the (now) 2,140
    // kanji files across all 29 grades just to show a list of tiles. That
    // was fine back when there were ~150-1,026 kanji total, but at 2,140 a
    // cold-cache visit fires that many concurrent fetch() calls at once,
    // which can exceed the browser's connection limits and throw "Failed to
    // fetch" on some of them — with no per-grade error handling, that
    // rejects the whole Promise.all and leaves the screen stuck on
    // "Loading…" forever, i.e. the Kanji section never renders at all. The
    // fix: render the tile list immediately from static counts
    // (kanjiCountLabel already falls back to GRADE_KANJI_COUNTS/
    // GRADE_KANJI_TARGET when a grade isn't loaded yet), and only fetch a
    // given grade's actual kanji content lazily, on demand, when the user
    // taps into that one grade (see renderGroupList below) — one grade is
    // at most 202 files, never thousands at once.
    main.innerHTML = `
      <div class="section-title">Elementary grades</div>
      ${ELEMENTARY_GRADES.map(g => {
        const built = BUILT_KANJI_GRADES.includes(g);
        return built
          ? `<div class="card" data-grade="${g}">${GRADE_LABEL[g]} — ${kanjiCountLabel(g)} ${jlptBadge(GRADE_JLPT[g])}</div>`
          : `<div class="card coming-soon">${GRADE_LABEL[g]} — coming soon</div>`;
      }).join('')}
      <div class="section-title">Remaining jōyō kanji</div>
      ${TIER_DISPLAY_GROUPS.map((t, i) => {
        const built = t.grades.every(g => BUILT_KANJI_GRADES.includes(g));
        return built
          ? `<div class="card" data-tier="${i}">${t.label} — ${tierKanjiCount(t)} kanji</div>`
          : `<div class="card coming-soon">${t.label} — coming soon</div>`;
      }).join('')}
    `;
    main.querySelectorAll('[data-grade]').forEach(el => {
      el.addEventListener('click', () => renderGroupList(Number(el.dataset.grade)));
    });
    main.querySelectorAll('[data-tier]').forEach(el => {
      el.addEventListener('click', () => renderTierGroupList(Number(el.dataset.tier)));
    });
  }, 'Kanji', 'Grades 1–6 & remaining jōyō kanji');
}

function renderGroupList(grade) {
  pushView(async () => {
    // Lazily load just this one grade (see the 2026-08-13 fix note in
    // renderKanjiHome above) instead of assuming every grade was already
    // pre-loaded. loadKanjiGrade() itself no-ops if this grade is already
    // in state.kanjiByGrade, so re-visiting a grade is instant.
    main.innerHTML = '<p>Loading…</p>';
    await loadKanjiGrade(grade);
    const groups = state.groupsByGrade[grade];
    const groupNums = Object.keys(groups).map(Number).sort((a, b) => a - b);
    headerSub.textContent = `${groupNums.length} groups of 5`;
    main.innerHTML = `
      <div class="grade-tabs">${kanjiNavTabsHtml(grade, undefined)}</div>
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
    wireKanjiNavTabs(main);
  }, `${GRADE_LABEL[grade]} Kanji`, '');
}

// Consolidated view for one ~200-kanji tier bucket (display-only grouping
// of several real grades — see TIER_DISPLAY_GROUPS above). Loads every
// real grade in the bucket (at most 4 grades = ~200 files, well under the
// scale that caused the 2026-08-13 "Failed to fetch" bug), then renders a
// single combined group list spanning all of them. Each card still carries
// its true (grade, groupNum) so renderGroupDetail/quiz logic is untouched.
function renderTierGroupList(tierIndex) {
  const tier = TIER_DISPLAY_GROUPS[tierIndex];
  pushView(async () => {
    main.innerHTML = '<p>Loading…</p>';
    await Promise.all(tier.grades.map(loadKanjiGrade));
    const combined = [];
    tier.grades.forEach(g => {
      Object.keys(state.groupsByGrade[g]).map(Number).sort((a, b) => a - b).forEach(gn => {
        combined.push({ grade: g, groupNum: gn });
      });
    });
    headerSub.textContent = `${combined.length} groups of 5 · ${tierKanjiCount(tier)} kanji`;
    main.innerHTML = `
      <div class="grade-tabs">${kanjiNavTabsHtml(undefined, tierIndex)}</div>
      <div class="group-list">` + combined.map((c, i) => {
      const kanjiStr = state.groupsByGrade[c.grade][c.groupNum].map(k => k.kanji).join('');
      return `<div class="card" data-grade="${c.grade}" data-group="${c.groupNum}">
        <div><div class="group-kanji-preview">${kanjiStr}</div><div class="group-meta">Group ${i + 1} of ${combined.length} · 5 kanji</div></div>
        <span>›</span>
      </div>`;
    }).join('') + `</div>`;
    main.querySelectorAll('.group-list [data-group]').forEach(el => {
      el.addEventListener('click', () => renderGroupDetail(Number(el.dataset.grade), Number(el.dataset.group), tierIndex));
    });
    wireKanjiNavTabs(main);
  }, tier.label, '');
}

// tierIndex is optional: pass it when arriving from a consolidated
// ~200-kanji tier tile (renderTierGroupList) so prev/next flips seamlessly
// across the real grade boundaries WITHIN that bucket, matching the "one
// big tile" mental model the consolidated home-screen tiles present. Every
// grade in the bucket was already loaded by renderTierGroupList before
// entry, so this cross-grade lookup never needs to await anything. Omit
// tierIndex (as renderGroupList does for elementary grades) to keep
// prev/next scoped to a single real grade, unchanged from before.
function renderGroupDetail(grade, groupNum, tierIndex) {
  pushView(() => {
    const kanjiList = state.groupsByGrade[grade][groupNum];
    let idx, total, prevRef, nextRef;
    if (tierIndex !== undefined) {
      const tier = TIER_DISPLAY_GROUPS[tierIndex];
      const combined = [];
      tier.grades.forEach(g => {
        Object.keys(state.groupsByGrade[g]).map(Number).sort((a, b) => a - b).forEach(gn => {
          combined.push({ grade: g, groupNum: gn });
        });
      });
      idx = combined.findIndex(c => c.grade === grade && c.groupNum === groupNum);
      total = combined.length;
      prevRef = idx > 0 ? combined[idx - 1] : null;
      nextRef = idx < combined.length - 1 ? combined[idx + 1] : null;
    } else {
      const groupNums = Object.keys(state.groupsByGrade[grade]).map(Number).sort((a, b) => a - b);
      idx = groupNums.indexOf(groupNum);
      total = groupNums.length;
      prevRef = idx > 0 ? { grade, groupNum: groupNums[idx - 1] } : null;
      nextRef = idx < groupNums.length - 1 ? { grade, groupNum: groupNums[idx + 1] } : null;
    }
    main.innerHTML = `
      <div class="detail-nav">
        <button class="nav-arrow" id="prev-group-btn" ${prevRef ? '' : 'disabled'}>‹ Group ${prevRef ? String(prevRef.groupNum).padStart(2, '0') : ''}</button>
        <span class="nav-pos">Group ${idx + 1} / ${total}</span>
        <button class="nav-arrow" id="next-group-btn" ${nextRef ? '' : 'disabled'}>Group ${nextRef ? String(nextRef.groupNum).padStart(2, '0') : ''} ›</button>
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
    if (prevRef) {
      document.getElementById('prev-group-btn').addEventListener('click', () => replaceView(() => renderGroupDetail(prevRef.grade, prevRef.groupNum, tierIndex)));
    }
    if (nextRef) {
      document.getElementById('next-group-btn').addEventListener('click', () => replaceView(() => renderGroupDetail(nextRef.grade, nextRef.groupNum, tierIndex)));
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
  }, `Group ${String(groupNum).padStart(2, '0')}`, subtitleFor(grade, tierIndex));
}

function subtitleFor(grade, tierIndex) {
  return tierIndex !== undefined ? TIER_DISPLAY_GROUPS[tierIndex].label : GRADE_LABEL[grade];
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
        <div class="kanji-top-row">
          <div class="kanji-glyph-big">${k.kanji}</div>
          <div class="kanji-stroke-inline" id="kanji-stroke-anim"></div>
        </div>
        <div class="kanji-meaning">${k.meaning} ${jlptBadge(k.jlpt)}</div>
        <div class="readings-row">
          <div><div class="rlabel">Strokes</div><div class="rval">${k.strokes}</div></div>
          <div><div class="rlabel">On-yomi</div><div class="rval">${k.onyomi.join('、') || '—'}</div></div>
          <div><div class="rlabel">Kun-yomi</div><div class="rval">${k.kunyomi.join('、') || '—'}</div></div>
        </div>
        ${(k.examples && k.examples.length ? k.examples : [k.sentence]).map(ex => `
        <div class="sentence-block">
          ${ex.type ? `<div class="example-label">${ex.type === 'on' ? 'On-yomi' : 'Kun-yomi'}${ex.reading ? ': ' + ex.reading : ''}</div>` : ''}
          <div class="jp">${ex.jp} ${TTS.buttons(ex.jp)}</div>
          <div class="reading">${ex.reading_text || ''}</div>
          <div class="en">${ex.en}</div>
        </div>`).join('')}
        <div class="btn-row">
          <button class="btn secondary" id="practice-btn">✍️ Practice writing</button>
          <button class="btn" id="quiz-btn">Quiz me on this kanji</button>
        </div>
        <div id="kanji-extra"></div>
      </div>
    `;
    mountStrokeOrder(document.getElementById('kanji-stroke-anim'), k.kanji, { size: 150 });
    if (prevK) {
      document.getElementById('prev-kanji-btn').addEventListener('click', () => replaceView(() => renderKanjiDetail(grade, prevK.kanji)));
    }
    if (nextK) {
      document.getElementById('next-kanji-btn').addEventListener('click', () => replaceView(() => renderKanjiDetail(grade, nextK.kanji)));
    }
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
  }, `${k.kanji} — ${k.meaning}`, GRADE_LABEL[grade]);
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
