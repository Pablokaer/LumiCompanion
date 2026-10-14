import type { EmailSummary, ImportanceLevel, ScoredEmail } from '../../shared/types';

// Keywords that usually signal something time-sensitive (English + Portuguese).
const URGENT_KEYWORDS = [
  'urgent', 'asap', 'deadline', 'action required', 'overdue', 'reminder', 'invoice', 'payment', 'contract',
  'interview', 'meeting', 'today', 'tomorrow', 'expires', 'final notice', 'approval', 'sign',
  'urgente', 'prazo', 'hoje', 'amanhã', 'amanha', 'reunião', 'reuniao', 'fatura', 'pagamento', 'contrato',
  'entrevista', 'vencimento', 'aprovação', 'aprovacao', 'assinatura',
];

/** One pattern per keyword, built once (building them for every email on every sync was wasted work). */
const URGENT_PATTERNS: [string, RegExp][] = URGENT_KEYWORDS.map((k) => [k, new RegExp(`(^|[^\\p{L}])${escapeRe(k)}([^\\p{L}]|$)`, 'iu')]);

const CATEGORY_WEIGHTS: Record<string, [number, string]> = {
  CATEGORY_PROMOTIONS: [-40, 'Promotion'],
  CATEGORY_SOCIAL: [-25, 'Social'],
  CATEGORY_FORUMS: [-15, 'Forum / mailing list'],
  CATEGORY_UPDATES: [-10, 'Automated update'],
};

export function levelFor(score: number): ImportanceLevel {
  if (score >= 60) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

export function gmailUrl(threadId: string, account?: string) {
  const user = account ? `?authuser=${encodeURIComponent(account)}` : '';
  return `https://mail.google.com/mail/u/0/${user}#all/${threadId}`;
}

/** Heuristic importance score 0–100 with human-readable reasons. */
export function scoreEmail(email: EmailSummary, myEmail = '', now = new Date()): ScoredEmail {
  let score = 20;
  const reasons: string[] = [];
  const labels = new Set(email.labelIds);
  const text = `${email.subject} ${email.snippet}`.toLowerCase();

  if (labels.has('IMPORTANT')) { score += 30; reasons.push('Marked important by Gmail'); }
  if (labels.has('STARRED')) { score += 25; reasons.push('Starred'); }
  if (labels.has('UNREAD')) { score += 10; reasons.push('Unread'); }

  const category = Object.keys(CATEGORY_WEIGHTS).find((c) => labels.has(c));
  if (category) {
    const [w, label] = CATEGORY_WEIGHTS[category];
    score += w;
    reasons.push(label);
  } else if (labels.has('CATEGORY_PERSONAL') || !email.labelIds.some((l) => l.startsWith('CATEGORY_'))) {
    score += 10;
    reasons.push('Personal');
  }

  if (email.hasListUnsubscribe) { score -= 20; reasons.push('Newsletter'); }
  if (/no-?reply|do-?not-?reply|notifications?@|mailer-daemon/i.test(email.fromEmail)) {
    score -= 15;
    reasons.push('Automated sender');
  }

  const hits = URGENT_PATTERNS.filter(([, re]) => re.test(text)).map(([k]) => k);
  if (hits.length) {
    score += Math.min(25, 12 + 5 * (hits.length - 1));
    reasons.push(`Mentions “${hits.slice(0, 2).join('”, “')}”`);
  }

  if (myEmail && email.to.toLowerCase().includes(myEmail.toLowerCase())) {
    score += 10;
    reasons.push('Sent directly to you');
  }

  const ageH = (now.getTime() - new Date(email.date).getTime()) / 3_600_000;
  if (ageH >= 0 && ageH <= 6) { score += 5; reasons.push('Recent'); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  return { ...email, score, level: levelFor(score), reasons, url: gmailUrl(email.threadId, myEmail) };
}

/** Blends heuristic scores with optional AI scores (0–100) and sorts most important first. */
export function rankEmails(emails: ScoredEmail[], ai: Record<string, { score: number; reason?: string }> = {}) {
  return emails
    .map((e) => {
      const a = ai[e.id];
      if (!a || !Number.isFinite(a.score)) return e;
      const score = Math.round(0.5 * e.score + 0.5 * Math.max(0, Math.min(100, a.score)));
      return { ...e, score, level: levelFor(score), aiReason: a.reason };
    })
    .sort((a, b) => b.score - a.score || +new Date(b.date) - +new Date(a.date));
}

function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
