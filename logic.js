export const STORAGE_KEY = 'epa-revision-studio-v1';

export function emptyProgress() {
  return { version: 1, questionStats: {}, cardStats: {}, sessions: [] };
}

export function normalizeProgress(value) {
  if (!value || value.version !== 1 || typeof value !== 'object') return emptyProgress();
  return {
    version: 1,
    questionStats: value.questionStats && typeof value.questionStats === 'object' ? value.questionStats : {},
    cardStats: value.cardStats && typeof value.cardStats === 'object' ? value.cardStats : {},
    sessions: Array.isArray(value.sessions) ? value.sessions.slice(-100) : [],
  };
}

export function nextReviewAt(previous = {}, correct, now = new Date()) {
  const streak = correct ? (previous.streak || 0) + 1 : 0;
  const hours = correct ? [0, 24, 72, 168, 336, 720][Math.min(streak, 5)] : 4;
  return new Date(now.getTime() + hours * 3_600_000).toISOString();
}

export function recordResult(progress, kind, id, correct, now = new Date(), choice = null) {
  const bucket = kind === 'card' ? 'cardStats' : 'questionStats';
  const previous = progress[bucket][id] || {};
  const updated = {
    correct: (previous.correct || 0) + Number(correct),
    incorrect: (previous.incorrect || 0) + Number(!correct),
    streak: correct ? (previous.streak || 0) + 1 : 0,
    lastResult: correct ? 'correct' : 'incorrect',
    lastAnsweredAt: now.toISOString(),
    nextReviewAt: nextReviewAt(previous, correct, now),
    ...(kind === 'question' ? { lastChoice: choice } : {}),
  };
  return { ...progress, [bucket]: { ...progress[bucket], [id]: updated } };
}

export function isDue(stats, now = new Date()) {
  return Boolean(stats?.nextReviewAt && new Date(stats.nextReviewAt).getTime() <= now.getTime());
}

export function isWeak(stats) {
  return Boolean(stats && stats.incorrect > 0 && (stats.lastResult === 'incorrect' || stats.incorrect >= stats.correct));
}

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function chooseQuestions(questions, progress, mode, topic = 'All topics', random = Math.random) {
  let pool = topic === 'All topics' ? questions : questions.filter((question) => question.topic === topic);
  if (mode === 'mistakes') pool = pool.filter((question) => isWeak(progress.questionStats[question.id]));
  if (mode === 'due') pool = pool.filter((question) => isDue(progress.questionStats[question.id]));
  return shuffle(pool, random).slice(0, mode === 'mock' ? pool.length : 10);
}

export function scoreSession(questions, answers) {
  const details = questions.map((question) => ({
    id: question.id,
    choice: answers[question.id] || null,
    correct: answers[question.id] === question.answer,
  }));
  return { correct: details.filter((item) => item.correct).length, total: questions.length, details };
}

export function topicSummary(questions, progress) {
  const byTopic = new Map();
  for (const question of questions) {
    const row = byTopic.get(question.topic) || { topic: question.topic, total: 0, seen: 0, correct: 0, incorrect: 0 };
    const stats = progress.questionStats[question.id];
    row.total++;
    if (stats) {
      row.seen++;
      row.correct += stats.correct || 0;
      row.incorrect += stats.incorrect || 0;
    }
    byTopic.set(question.topic, row);
  }
  return [...byTopic.values()].sort((a, b) => a.topic.localeCompare(b.topic));
}
