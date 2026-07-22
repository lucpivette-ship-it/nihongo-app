// QCM (multiple-choice quiz) generation for kanji: one stroke-count question and one
// situational (fill-the-blank sentence) question per kanji. Distractors are generated
// at runtime from the rest of the loaded kanji set, so no per-kanji distractor data
// needs to be hand-authored.

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildStrokeQuestion(target, allKanji) {
  const pool = allKanji.filter(k => k.kanji !== target.kanji && k.strokes !== target.strokes);
  const distractorStrokes = shuffle([...new Set(pool.map(k => k.strokes))]).slice(0, 3);
  const options = shuffle([target.strokes, ...distractorStrokes]);
  return {
    type: 'stroke',
    kanji: target.kanji,
    prompt: `How many strokes does ${target.kanji} have?`,
    options,
    answer: target.strokes
  };
}

function buildSituationalQuestion(target, allKanji) {
  const sentence = target.sentence.jp;
  const blanked = sentence.split(target.kanji).join('＿');
  const pool = shuffle(allKanji.filter(k => k.kanji !== target.kanji)).slice(0, 3).map(k => k.kanji);
  const options = shuffle([target.kanji, ...pool]);
  return {
    type: 'situational',
    kanji: target.kanji,
    prompt: blanked,
    hint: target.sentence.en,
    options,
    answer: target.kanji
  };
}

function buildQuizForGroup(groupKanji, allKanji) {
  const questions = [];
  groupKanji.forEach(k => {
    questions.push(buildStrokeQuestion(k, allKanji));
    questions.push(buildSituationalQuestion(k, allKanji));
  });
  return shuffle(questions);
}

function buildQuizForKanji(target, allKanji) {
  return [buildStrokeQuestion(target, allKanji), buildSituationalQuestion(target, allKanji)];
}

// Renders an interactive quiz session into `container`. Calls onDone(score, total) at the end.
function runQuiz(container, questions, onDone) {
  let idx = 0;
  let score = 0;

  function renderQuestion() {
    const q = questions[idx];
    const isSituational = q.type === 'situational';
    container.innerHTML = `
      <div class="quiz-question">
        <div class="quiz-progress">Question ${idx + 1} / ${questions.length}</div>
        ${isSituational
          ? `<div class="quiz-sentence">${q.prompt}</div><div class="kanji-meaning">${q.hint}</div>`
          : `<div class="kanji-glyph-big">${q.kanji}</div><div class="quiz-prompt">${q.prompt}</div>`}
        <div class="quiz-options">
          ${q.options.map(o => `<div class="quiz-option" data-value="${o}">${o}</div>`).join('')}
        </div>
      </div>
    `;
    container.querySelectorAll('.quiz-option').forEach(el => {
      el.addEventListener('click', () => {
        if (container.dataset.locked) return;
        container.dataset.locked = '1';
        const chosen = el.dataset.value;
        const correct = String(q.answer) === chosen;
        if (correct) score++;
        container.querySelectorAll('.quiz-option').forEach(opt => {
          if (String(opt.dataset.value) === String(q.answer)) opt.classList.add('correct');
          else if (opt === el) opt.classList.add('wrong');
        });
        setTimeout(() => {
          delete container.dataset.locked;
          idx++;
          if (idx < questions.length) renderQuestion();
          else onDone(score, questions.length);
        }, 900);
      });
    });
  }

  renderQuestion();
}
