import {
  STORAGE_KEY,
  chooseQuestions,
  emptyProgress,
  isDue,
  isWeak,
  normalizeProgress,
  recordResult,
  scoreSession,
  topicSummary,
} from './logic.js';

const app = document.querySelector('#app');
const SESSION_KEY = 'epa-revision-active-session-v1';
const papers = [
  { id: 'ncfe-002', label: 'NCFE sample paper' },
  { id: 'city-guilds-1', label: 'City & Guilds practice paper 1' },
  { id: 'city-guilds-2', label: 'City & Guilds practice paper 2' },
];
const navigation = [
  ['dashboard', 'Overview', '◫'],
  ['practice', 'Practice', '✎'],
  ['mock', 'Mock exam', '◷'],
  ['glossary', 'Glossary', '▤'],
  ['mistakes', 'Needs work', '↺'],
];

let questions = [];
let practiceQuestions = [];
let cards = [];
let topics = [];
let progress = loadProgress();
let storageError = false;
const state = {
  view: 'dashboard',
  topic: 'All topics',
  mockPaperId: papers[0].id,
  glossaryTopic: 'All topics',
  glossaryQuery: '',
  glossaryLimit: 12,
  cardId: null,
  cardRevealed: false,
  session: null,
  notice: '',
};

function loadProgress() {
  try { return normalizeProgress(JSON.parse(localStorage.getItem(STORAGE_KEY))); }
  catch { return emptyProgress(); }
}

function saveProgress() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(progress)); storageError = false; }
  catch { storageError = true; }
}

function saveSession() {
  try {
    if (!state.session || state.session.complete) {
      localStorage.removeItem(SESSION_KEY);
      return;
    }
    const { mode, label, topic, questions: deck, answers, index, startedAt, deadline } = state.session;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ mode, label, topic, questionIds: deck.map((question) => question.id), answers, index, startedAt, deadline }));
  } catch { /* Progress storage warning is shown if the browser blocks saves. */ }
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY));
    if (!saved || !['quick', 'due', 'mistakes', 'mock'].includes(saved.mode) || !Array.isArray(saved.questionIds) || !saved.questionIds.length) return;
    const deck = saved.questionIds.map((id) => questions.find((question) => question.id === id));
    if (deck.some((question) => !question)) return;
    if (saved.mode !== 'mock' && deck.some((question) => question.review?.excludeFromPractice)) return;
    state.session = {
      mode: saved.mode,
      label: saved.label,
      topic: saved.topic,
      questions: deck,
      answers: saved.answers && typeof saved.answers === 'object' ? saved.answers : {},
      index: Math.max(0, Math.min(Number(saved.index) || 0, deck.length - 1)),
      startedAt: saved.startedAt,
      deadline: saved.mode === 'mock' ? Number(saved.deadline) : null,
      complete: false,
    };
    if (saved.mode === 'mock') state.mockPaperId = deck[0].paperId;
    state.view = saved.mode === 'mock' ? 'mock' : 'practice';
  } catch { /* A damaged session can be safely ignored. */ }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function fmtDate(value) {
  return new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function sourceLabel(question) {
  const paper = papers.find((item) => item.id === question.paperId);
  return `${paper?.label || 'Sample paper'} · page ${question.source.page} · question ${question.number}`;
}

function referenceHtml(url) {
  if (!url) return '';
  try {
    const reference = new URL(url);
    if (reference.protocol !== 'https:') return '';
    return `<a href="${escapeHtml(reference.href)}" target="_blank" rel="noopener noreferrer">Check the source ↗</a>`;
  } catch { return ''; }
}

function reviewNoteHtml(question) {
  if (!question.review) return '';
  return `<div class="review-note"><strong>Source check</strong><p>${escapeHtml(question.review.note)}</p>${referenceHtml(question.review.reference)}</div>`;
}

function navHtml() {
  return navigation.map(([id, label, icon]) => `
    <button class="nav-item ${state.view === id ? 'active' : ''}" data-view="${id}" aria-current="${state.view === id ? 'page' : 'false'}">
      <span class="nav-icon" aria-hidden="true">${icon}</span><span>${label}</span>
    </button>`).join('');
}

function shell(content) {
  return `<div class="app-shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark">E</span><div><strong>EPA Studio</strong><small>Business Administrator · Level 3</small></div></div>
      <nav class="side-nav" aria-label="Main navigation">${navHtml()}</nav>
      <div class="sidebar-note"><span class="note-dot"></span><div><strong>Your progress stays here</strong><p>Saved privately in this browser.</p></div></div>
    </aside>
    <div class="main-wrap">
      <header class="topbar"><div class="mobile-brand"><span class="brand-mark">E</span><strong>EPA Studio</strong></div><span class="topbar-label">Level 3 Business Administrator</span><span class="topbar-pill">Study mode</span></header>
      <main id="main" class="content">${storageError ? '<div class="alert">Progress could not be saved in this browser. You can still practise, but your results may be lost.</div>' : ''}${state.notice ? `<div class="alert">${escapeHtml(state.notice)}</div>` : ''}${content}</main>
      <nav class="mobile-nav" aria-label="Main navigation">${navHtml()}</nav>
    </div>
  </div>`;
}

function statCard(label, value, caption, tone = '') {
  return `<div class="stat-card ${tone}"><span class="stat-label">${label}</span><strong>${value}</strong><span class="stat-caption">${caption}</span></div>`;
}

function dashboard() {
  const seen = practiceQuestions.filter((question) => progress.questionStats[question.id]).length;
  const due = practiceQuestions.filter((question) => isDue(progress.questionStats[question.id])).length;
  const weak = practiceQuestions.filter((question) => isWeak(progress.questionStats[question.id])).length;
  const learned = cards.filter((card) => progress.cardStats[card.id]?.lastResult === 'correct').length;
  const totals = practiceQuestions.reduce((sum, question) => {
    const item = progress.questionStats[question.id] || {};
    return { correct: sum.correct + (item.correct || 0), incorrect: sum.incorrect + (item.incorrect || 0) };
  }, { correct: 0, incorrect: 0 });
  const accuracy = totals.correct + totals.incorrect ? Math.round(totals.correct / (totals.correct + totals.incorrect) * 100) : 0;
  const rows = topicSummary(practiceQuestions, progress);
  const recent = [...progress.sessions].reverse().slice(0, 3);
  return `<div class="page-heading"><div><div class="eyebrow">Level 3 Business Administrator · knowledge test</div><h1>Make each session count.</h1><p>Practise unflagged questions from three historical sample papers, revisit what you missed, and build confidence with the glossary. Focus on regulations, business fundamentals and project management.</p></div><span class="heading-symbol" aria-hidden="true">✳</span></div>
    <section class="hero-card"><div><div class="eyebrow light">A good place to begin</div><h2>Ten focused questions.<br>One step closer.</h2><p>Quick practice gives instant feedback and saves your progress as you go.</p><button class="button button-light" data-start="quick">Start quick practice <span aria-hidden="true">→</span></button></div><div class="hero-art" aria-hidden="true"><span class="art-circle one"></span><span class="art-circle two"></span><span class="art-card">01 <i></i><i></i><i></i><b>✓</b></span></div></section>
    <section class="stats-grid" aria-label="Your progress">
      ${statCard('Questions explored', `${seen}<small> / ${practiceQuestions.length}</small>`, 'Unflagged practice items')}
      ${statCard('Answer accuracy', `${accuracy}%`, `${totals.correct + totals.incorrect} answers recorded`, 'accent')}
      ${statCard('Due for review', due, 'Ready to practise again')}
      ${statCard('Glossary learned', `${learned}<small> / ${cards.length}</small>`, 'Terms marked as known')}
    </section>
    <div class="two-column"><section class="panel"><div class="panel-title"><div><div class="eyebrow">Your coverage</div><h2>Knowledge areas</h2></div><span class="subtle">${rows.length} quiz topics</span></div><div class="topic-list">${rows.map((row) => `<div class="topic-row"><div class="topic-row-top"><strong>${escapeHtml(row.topic)}</strong><span>${row.seen} / ${row.total} seen</span></div><div class="bar"><span style="width:${row.total ? row.seen / row.total * 100 : 0}%"></span></div></div>`).join('')}</div></section>
      <div class="stack"><section class="panel callout"><div class="eyebrow">Your next move</div><h2>${weak ? `${weak} question${weak === 1 ? '' : 's'} need another look` : 'Stay curious'}</h2><p>${weak ? 'Questions you missed will stay easy to find here.' : 'Missed questions will appear in your review queue.'}</p><button class="text-button" data-view="mistakes">Open needs work <span aria-hidden="true">→</span></button></section>
      <section class="panel"><div class="eyebrow">Recent sessions</div>${recent.length ? recent.map((item) => `<div class="recent-row"><div><strong>${escapeHtml(item.label)}</strong><span>${fmtDate(item.completedAt)}</span></div><b>${item.correct}/${item.total}</b></div>`).join('') : '<p class="empty-small">Your completed practice sessions will appear here.</p>'}</section></div></div>
    <div class="page-foot"><span>Knowledge-test revision only. The EPA also includes a portfolio interview and project presentation. Historical source-key issues are flagged in full mocks.</span><button class="text-button small" data-export>Export progress</button><button class="text-button small" data-import>Import progress</button><input id="progress-import" type="file" accept="application/json,.json" hidden><button class="text-button small" data-reset>Reset progress</button></div>`;
}

function topicSelect(value, id, items) {
  return `<label class="field-label" for="${id}">Focus topic</label><select id="${id}" class="select">${['All topics', ...items].map((topic) => `<option value="${escapeHtml(topic)}" ${topic === value ? 'selected' : ''}>${escapeHtml(topic)}</option>`).join('')}</select>`;
}

function startPage(isMock = false) {
  const selectedQuestions = practiceQuestions.filter((question) => state.topic === 'All topics' || question.topic === state.topic);
  const due = selectedQuestions.filter((question) => isDue(progress.questionStats[question.id])).length;
  const weak = selectedQuestions.filter((question) => isWeak(progress.questionStats[question.id])).length;
  const selectedPaper = papers.find((paper) => paper.id === state.mockPaperId);
  const paperIssues = questions.filter((question) => question.paperId === state.mockPaperId && question.review?.excludeFromPractice).length;
  return `<div class="page-heading compact"><div><div class="eyebrow">${isMock ? 'Exam conditions' : 'Choose your session'}</div><h1>${isMock ? 'Try the full mock.' : 'What will you practise?'}</h1><p>${isMock ? 'All 50 questions, 60 minutes, and feedback at the end. You can change answers before submitting.' : 'Choose a topic, then pick a practice path. Your answers are saved automatically.'}</p></div></div>
  ${isMock ? `<div class="review-summary">The approved AP03 knowledge test is 50 questions in up to 60 minutes (30 for a pass, 40 for distinction). This historical paper has ${paperIssues} flagged source-key item${paperIssues === 1 ? '' : 's'}; its mock score is for practice, not a grade prediction.</div>` : ''}
  ${isMock ? `<div class="mock-intro panel"><div class="mock-badge">60<br><small>MIN</small></div><div><h2>${escapeHtml(selectedPaper.label)}</h2><p>50 questions · one answer per question · unanswered questions count as incorrect. The timer starts when you begin.</p><label class="field-label" for="mock-paper">Choose a paper</label><select id="mock-paper" class="select">${papers.map((paper) => `<option value="${paper.id}" ${paper.id === state.mockPaperId ? 'selected' : ''}>${escapeHtml(paper.label)}</option>`).join('')}</select><button class="button button-primary" data-start="mock">Start mock exam <span aria-hidden="true">→</span></button></div></div>` : `<div class="practice-layout"><div class="panel topic-picker"><div class="eyebrow">Step 01</div><h2>Set your focus</h2><p>Choose one area, or keep all topics mixed.</p>${topicSelect(state.topic, 'practice-topic', topics)}<div class="picker-note">${selectedQuestions.length} questions available in this selection</div></div><div class="mode-grid">
    <button class="mode-card" data-start="quick"><span class="mode-icon">✎</span><span class="mode-count">10 questions</span><strong>Quick practice</strong><span>Immediate feedback after every answer.</span><i>Start session →</i></button>
    <button class="mode-card" data-start="due" ${due ? '' : 'disabled'}><span class="mode-icon">◷</span><span class="mode-count">${due} due now</span><strong>Due for review</strong><span>Revisit questions on your review schedule.</span><i>${due ? 'Start review →' : 'Nothing due yet'}</i></button>
    <button class="mode-card" data-start="mistakes" ${weak ? '' : 'disabled'}><span class="mode-icon">↺</span><span class="mode-count">${weak} need work</span><strong>Work on mistakes</strong><span>Focus on questions you previously missed.</span><i>${weak ? 'Start review →' : 'No mistakes yet'}</i></button>
  </div></div>`}`;
}

function sessionPage() {
  const session = state.session;
  if (session.complete) return resultPage(session);
  const question = session.questions[session.index];
  const choice = session.answers[question.id];
  const isMock = session.mode === 'mock';
  const feedback = !isMock && choice;
  const answerText = question.options.find((option) => option.id === question.answer)?.text || '';
  const progressWidth = (session.index + 1) / session.questions.length * 100;
  return `<div class="session-top"><button class="text-button" data-leave>← Back to ${isMock ? 'mock exam' : 'practice'}</button>${isMock ? `<span class="timer" id="timer" role="timer">${timeLeft(session)}</span>` : `<span class="session-label">${escapeHtml(session.label)}</span>`}</div>
    <div class="question-head"><div><div class="eyebrow">${escapeHtml(question.topic)}</div><h1>Question ${session.index + 1} <span>of ${session.questions.length}</span></h1></div><div class="question-count">${Math.round(progressWidth)}%</div></div><div class="bar big"><span style="width:${progressWidth}%"></span></div>
    <section class="question-card"><div class="source-line">${escapeHtml(sourceLabel(question))}</div>${!isMock ? reviewNoteHtml(question) : ''}<h2>${escapeHtml(question.question)}</h2><div class="answers" role="group" aria-label="Answer choices">${question.options.map((option) => {
      const chosen = choice === option.id;
      const status = feedback && option.id === question.answer ? 'right' : feedback && chosen ? 'wrong' : chosen ? 'selected' : '';
      return `<button class="answer ${status}" data-choice="${option.id}" ${feedback ? 'disabled' : ''} aria-pressed="${chosen ? 'true' : 'false'}"><span class="answer-letter">${option.id}</span><span>${escapeHtml(option.text)}</span><span class="answer-mark" aria-hidden="true">${feedback && option.id === question.answer ? '✓' : feedback && chosen ? '×' : ''}</span></button>`;
    }).join('')}</div>
    ${feedback ? `<div class="feedback ${choice === question.answer ? 'correct' : 'incorrect'}" role="status"><strong>${choice === question.answer ? 'Correct – nicely done.' : 'Not quite. Keep this one in your review queue.'}</strong><p>Answer ${question.answer}: ${escapeHtml(answerText)}</p></div>` : ''}
    <div class="question-actions">${isMock ? `<button class="button button-quiet" data-prev ${session.index === 0 ? 'disabled' : ''}>← Previous</button><span>${Object.keys(session.answers).length} answered</span>${session.index < session.questions.length - 1 ? '<button class="button button-primary" data-next>Next question →</button>' : '<button class="button button-primary" data-finish>Submit mock →</button>'}` : `<span>${choice ? 'Your answer has been saved.' : 'Select one answer to continue.'}</span><button class="button button-primary" data-next ${choice ? '' : 'disabled'}>${session.index === session.questions.length - 1 ? 'See results →' : 'Next question →'}</button>`}</div>
    </section>`;
}

function timeLeft(session) {
  const seconds = Math.max(0, Math.ceil((session.deadline - Date.now()) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function resultPage(session) {
  const result = session.result;
  const percent = Math.round(result.correct / result.total * 100);
  const misses = result.details.filter((item) => !item.correct);
  const flagged = session.mode === 'mock' ? session.questions.filter((question) => question.review?.excludeFromPractice) : [];
  return `<div class="result-wrap"><div class="eyebrow">Session complete</div><h1>${session.mode === 'mock' ? 'Your mock result' : 'Nice work showing up.'}</h1><p>Every answer gives you a clearer idea of what to practise next.</p><div class="score-circle"><strong>${percent}%</strong><span>${result.correct} of ${result.total} correct</span></div><div class="result-actions"><button class="button button-primary" data-start="${session.mode === 'mock' ? 'mock' : 'quick'}">Try another session →</button><button class="button button-quiet" data-new-session>Choose a mode</button><button class="button button-quiet" data-view="dashboard">View progress</button></div></div>
  ${flagged.length ? `<section class="panel result-review"><div class="panel-title"><div><div class="eyebrow">Historical paper caveats</div><h2>${flagged.length} source-key item${flagged.length === 1 ? '' : 's'} to treat with care</h2></div></div><p>This score follows the paper's original answer key. These questions are excluded from everyday practice and progress tracking; the score is not an EPA grade prediction.</p>${flagged.map((question) => `<div class="review-row"><span class="review-number">${question.number}</span><div><strong>${escapeHtml(question.question)}</strong>${reviewNoteHtml(question)}</div></div>`).join('')}</section>` : ''}
  <section class="panel result-review"><div class="panel-title"><div><div class="eyebrow">Answer review</div><h2>${misses.length ? `${misses.length} to revisit` : 'Perfect score'}</h2></div></div>${misses.length ? misses.map((item) => {
    const q = questions.find((entry) => entry.id === item.id);
    const chosen = q.options.find((option) => option.id === item.choice);
    const answer = q.options.find((option) => option.id === q.answer);
    return `<div class="review-row"><span class="review-number">${q.number}</span><div><strong>${escapeHtml(q.question)}</strong><p>Your answer: ${chosen ? escapeHtml(chosen.text) : 'No answer'}<br>Correct: ${escapeHtml(answer.text)}</p></div></div>`;
  }).join('') : '<p class="empty-small">You answered every question correctly.</p>'}</section>`;
}

function glossaryPage() {
  const cardTopics = [...new Set(cards.map((card) => card.topic))];
  const query = state.glossaryQuery.toLowerCase();
  const filtered = cards.filter((card) => (state.glossaryTopic === 'All topics' || card.topic === state.glossaryTopic) && (!query || `${card.term} ${card.definition}`.toLowerCase().includes(query)));
  const active = filtered.find((card) => card.id === state.cardId) || filtered[0];
  state.cardId = active?.id || null;
  const learned = cards.filter((card) => progress.cardStats[card.id]?.lastResult === 'correct').length;
  return `<div class="page-heading compact"><div><div class="eyebrow">Build your vocabulary</div><h1>The glossary, made memorable.</h1><p>Search a term, reveal its definition, then mark what you know. Cards you miss return sooner.</p></div></div>
    <div class="glossary-toolbar"><div><label class="field-label" for="glossary-topic">Knowledge area</label><select id="glossary-topic" class="select">${['All topics', ...cardTopics].map((topic) => `<option value="${escapeHtml(topic)}" ${topic === state.glossaryTopic ? 'selected' : ''}>${escapeHtml(topic)}</option>`).join('')}</select></div><form id="glossary-form"><label class="field-label" for="glossary-search">Find a term</label><div class="search-box"><input id="glossary-search" type="search" value="${escapeHtml(state.glossaryQuery)}" placeholder="Search terms or definitions"><button type="submit" aria-label="Search glossary">⌕</button></div></form></div>
    <div class="glossary-layout"><section class="panel flash-panel"><div class="flash-meta"><span>${escapeHtml(active?.topic || 'Glossary')}</span><span>${learned} of ${cards.length} learned</span></div>${active ? `<div class="flash-card"><div class="eyebrow">Term</div><h2>${escapeHtml(active.term)}</h2><div class="definition ${state.cardRevealed ? 'visible' : ''}">${state.cardRevealed ? `<div class="eyebrow">Definition</div><p>${escapeHtml(active.definition)}</p>${referenceHtml(active.review?.reference)}` : '<p>Think of the definition, then reveal it.</p>'}</div></div><div class="flash-actions">${state.cardRevealed ? `<button class="button button-quiet" data-card-result="again">Review again</button><button class="button button-primary" data-card-result="known">I knew it ✓</button>` : '<button class="button button-primary" data-reveal>Reveal definition →</button>'}</div>` : '<div class="empty-state">No terms match your search.</div>'}</section>
    <section class="panel term-panel"><div class="panel-title"><div><div class="eyebrow">Browse</div><h2>${filtered.length} terms</h2></div></div><div class="term-list">${filtered.slice(0, state.glossaryLimit).map((card) => `<button class="term-row ${card.id === active?.id ? 'active' : ''}" data-card="${card.id}"><span><strong>${escapeHtml(card.term)}</strong><small>${escapeHtml(card.topic)}</small></span><span class="term-status">${progress.cardStats[card.id]?.lastResult === 'correct' ? '✓' : '→'}</span></button>`).join('')}</div>${filtered.length > state.glossaryLimit ? '<button class="text-button show-more" data-load-more>Show more terms ↓</button>' : ''}</section></div>`;
}

function mistakesPage() {
  const list = practiceQuestions.filter((question) => isWeak(progress.questionStats[question.id])).sort((a, b) => (progress.questionStats[b.id]?.incorrect || 0) - (progress.questionStats[a.id]?.incorrect || 0));
  return `<div class="page-heading compact"><div><div class="eyebrow">Personal review queue</div><h1>The questions worth another look.</h1><p>Missed questions stay here until your results improve. Review them in a short focused session.</p></div></div><div class="mistake-banner"><div><strong>${list.length} ${list.length === 1 ? 'question' : 'questions'} need work</strong><span>Each retry helps move them out of this queue.</span></div><button class="button button-primary" data-start="mistakes" ${list.length ? '' : 'disabled'}>Review mistakes →</button></div>${list.length ? `<div class="mistake-list">${list.map((question) => {
    const stats = progress.questionStats[question.id];
    const answer = question.options.find((option) => option.id === question.answer);
    const chosen = question.options.find((option) => option.id === stats.lastChoice);
    return `<article class="panel mistake-card"><div class="mistake-top"><span>${escapeHtml(question.topic)}</span><span>Missed ${stats.incorrect} ${stats.incorrect === 1 ? 'time' : 'times'}</span></div><h2>${escapeHtml(question.question)}</h2><div class="mistake-answer"><span>Correct answer</span><strong>${escapeHtml(answer?.text || '')}</strong></div>${stats.lastResult === 'incorrect' && chosen ? `<p class="last-choice">Your last choice: ${escapeHtml(chosen.text)}</p>` : ''}<small>${escapeHtml(sourceLabel(question))}</small></article>`;
  }).join('')}</div>` : '<div class="empty-state panel"><span class="empty-icon">✓</span><h2>Nothing here yet.</h2><p>When you miss a question, it will appear here for focused review.</p><button class="button button-primary" data-view="practice">Start practising →</button></div>'}`;
}

function render() {
  let content;
  if (state.view === 'dashboard') content = dashboard();
  else if (state.view === 'glossary') content = glossaryPage();
  else if (state.view === 'mistakes') content = mistakesPage();
  else if (state.session && state.session.mode === (state.view === 'mock' ? 'mock' : state.session.mode) && (state.view === 'mock' || state.session.mode !== 'mock')) content = sessionPage();
  else content = startPage(state.view === 'mock');
  app.innerHTML = shell(content);
  updateTimer();
}

function updateTimer() {
  const session = state.session;
  if (!session || session.complete || session.mode !== 'mock') return;
  const timer = document.querySelector('#timer');
  if (timer) timer.textContent = timeLeft(session);
  if (Date.now() >= session.deadline) finishSession();
}

function startSession(mode) {
  const topic = mode === 'mock' ? 'All topics' : state.topic;
  const pool = mode === 'mock' ? questions.filter((question) => question.paperId === state.mockPaperId) : practiceQuestions;
  const deck = chooseQuestions(pool, progress, mode, topic);
  if (!deck.length) { state.notice = 'No questions are available for that session. Try another topic or mode.'; render(); return; }
  state.notice = '';
  state.view = mode === 'mock' ? 'mock' : 'practice';
  state.session = {
    mode,
    label: mode === 'mock' ? `${papers.find((paper) => paper.id === state.mockPaperId).label} mock` : { quick: 'Quick practice', due: 'Due review', mistakes: 'Mistake review' }[mode],
    topic,
    questions: deck,
    answers: {},
    index: 0,
    startedAt: Date.now(),
    deadline: mode === 'mock' ? Date.now() + 60 * 60 * 1000 : null,
    complete: false,
  };
  saveSession();
  render();
}

function finishSession() {
  const session = state.session;
  if (!session || session.complete) return;
  const result = scoreSession(session.questions, session.answers);
  if (session.mode === 'mock') {
    for (const detail of result.details) {
      if (detail.choice && !session.questions.find((question) => question.id === detail.id)?.review?.excludeFromPractice) {
        progress = recordResult(progress, 'question', detail.id, detail.correct, new Date(), detail.choice);
      }
    }
  }
  progress.sessions = [...progress.sessions, {
    id: `${session.startedAt}-${session.mode}`,
    label: session.label,
    mode: session.mode,
    topic: session.topic,
    completedAt: new Date().toISOString(),
    correct: result.correct,
    total: result.total,
    answered: Object.keys(session.answers).length,
  }].slice(-100);
  saveProgress();
  session.result = result;
  session.complete = true;
  saveSession();
  render();
}

function nextQuestion() {
  const session = state.session;
  if (!session || session.complete) return;
  if (session.index >= session.questions.length - 1) finishSession();
  else { session.index++; saveSession(); render(); }
}

function chooseAnswer(letter) {
  const session = state.session;
  if (!session || session.complete) return;
  const question = session.questions[session.index];
  if (!question.options.some((option) => option.id === letter)) return;
  if (session.mode !== 'mock' && session.answers[question.id]) return;
  session.answers[question.id] = letter;
  if (session.mode !== 'mock') {
    progress = recordResult(progress, 'question', question.id, letter === question.answer, new Date(), letter);
    saveProgress();
  }
  saveSession();
  render();
}

function markCard(known) {
  if (!state.cardId || !state.cardRevealed) return;
  progress = recordResult(progress, 'card', state.cardId, known);
  saveProgress();
  const list = cards.filter((card) => (state.glossaryTopic === 'All topics' || card.topic === state.glossaryTopic) && (!state.glossaryQuery || `${card.term} ${card.definition}`.toLowerCase().includes(state.glossaryQuery.toLowerCase())));
  const index = list.findIndex((card) => card.id === state.cardId);
  state.cardId = list[(index + 1) % list.length]?.id || null;
  state.cardRevealed = false;
  render();
}

function exportProgress() {
  const blob = new Blob([JSON.stringify(progress, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `epa-revision-progress-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

app.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.view) { state.view = button.dataset.view; state.notice = ''; render(); }
  else if (button.dataset.start) startSession(button.dataset.start);
  else if (button.dataset.choice) chooseAnswer(button.dataset.choice);
  else if (button.hasAttribute('data-next')) nextQuestion();
  else if (button.hasAttribute('data-prev') && state.session?.index > 0) { state.session.index--; saveSession(); render(); }
  else if (button.hasAttribute('data-finish')) {
    const unanswered = state.session.questions.length - Object.keys(state.session.answers).length;
    if (!unanswered || confirm(`Submit now with ${unanswered} unanswered ${unanswered === 1 ? 'question' : 'questions'}?`)) finishSession();
  }
  else if (button.hasAttribute('data-leave')) {
    if (state.session?.mode !== 'mock' || confirm('Leave this mock exam? Your unfinished answers will be lost.')) {
      state.view = state.session?.mode === 'mock' ? 'mock' : 'practice'; state.session = null; saveSession(); render();
    }
  }
  else if (button.hasAttribute('data-reveal')) { state.cardRevealed = true; render(); }
  else if (button.dataset.cardResult) markCard(button.dataset.cardResult === 'known');
  else if (button.dataset.card) { state.cardId = button.dataset.card; state.cardRevealed = false; render(); }
  else if (button.hasAttribute('data-load-more')) { state.glossaryLimit += 24; render(); }
  else if (button.hasAttribute('data-export')) exportProgress();
  else if (button.hasAttribute('data-import')) document.querySelector('#progress-import')?.click();
  else if (button.hasAttribute('data-new-session')) { state.session = null; saveSession(); render(); }
  else if (button.hasAttribute('data-reset') && confirm('Reset all revision progress in this browser? This cannot be undone.')) { progress = emptyProgress(); saveProgress(); state.session = null; saveSession(); render(); }
});

app.addEventListener('change', async (event) => {
  if (event.target.id === 'practice-topic') { state.topic = event.target.value; render(); }
  if (event.target.id === 'mock-paper') { state.mockPaperId = event.target.value; render(); }
  if (event.target.id === 'glossary-topic') { state.glossaryTopic = event.target.value; state.cardId = null; state.cardRevealed = false; state.glossaryLimit = 12; render(); }
  if (event.target.id === 'progress-import' && event.target.files?.[0]) {
    try {
      const imported = JSON.parse(await event.target.files[0].text());
      if (imported.version !== 1 || !imported.questionStats || !imported.cardStats || !Array.isArray(imported.sessions)) throw new Error('Invalid backup');
      if (!confirm('Replace your current progress with this backup?')) return;
      progress = normalizeProgress(imported);
      state.session = null;
      state.notice = 'Progress restored from your backup.';
      saveSession();
      saveProgress();
      render();
    } catch {
      state.notice = 'That file is not a valid EPA Studio progress backup.';
      render();
    }
  }
});

app.addEventListener('submit', (event) => {
  if (event.target.id !== 'glossary-form') return;
  event.preventDefault();
  state.glossaryQuery = event.target.querySelector('input').value.trim();
  state.cardId = null;
  state.cardRevealed = false;
  state.glossaryLimit = 12;
  render();
});

async function init() {
  try {
    const paths = ['data/ncfe-sample-002.json', 'data/city-guilds-sample-1.json', 'data/city-guilds-sample-2.json', 'data/revision-glossary.json', 'data/question-topics.json', 'data/question-review.json'];
    const responses = await Promise.all(paths.map((path) => fetch(path)));
    if (responses.some((response) => !response.ok)) throw new Error('Content could not be loaded');
    const [ncfeQuestions, cityGuilds1, cityGuilds2, cardData, topicMap, reviewMap] = await Promise.all(responses.map((response) => response.json()));
    questions = [
      ...ncfeQuestions.map((question) => ({ ...question, paperId: 'ncfe-002', topic: topicMap[question.number] || 'Other' })),
      ...cityGuilds1,
      ...cityGuilds2,
    ].map((question) => ({ ...question, review: reviewMap[question.id] || null }));
    practiceQuestions = questions.filter((question) => !question.review?.excludeFromPractice);
    cards = cardData;
    topics = [...new Set(questions.map((question) => question.topic))].sort();
    restoreSession();
    render();
    setInterval(updateTimer, 1000);
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* The app still works online if offline setup fails. */ });
    }
  } catch {
    app.innerHTML = '<div class="fatal"><h1>Revision content could not be loaded.</h1><p>Start the app with <code>npm run dev</code> and refresh this page.</p></div>';
  }
}

init();
