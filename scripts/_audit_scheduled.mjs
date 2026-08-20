// Audyt wszystkich scheduled posts pod kątem antypatternów z humanizer.md
// Output: raport per post z listą issues + severity.
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { homedir } from 'node:os';

const db = new Database(join(homedir(), '.linkedin-mcp', 'scheduler.db'), { readonly: true });

const posts = db.prepare(`
  SELECT sp.id, sp.text, sp.publish_at, sp.language, sp.media_preview_path,
         mpi.slug, mpi.topic_number, mpi.title
  FROM scheduled_posts sp
  LEFT JOIN media_plan_items mpi ON mpi.scheduled_post_id = sp.id
  WHERE sp.status='scheduled'
  ORDER BY sp.publish_at ASC
`).all();
db.close();

// Antypatterny per kategoria
const HARD_BANS = [
  { name: 'em-dash', regex: /—/g, severity: 'BLOCKER' },
  { name: 'en-dash', regex: /–/g, severity: 'BLOCKER' },
  { name: 'emoji-unicode', regex: /[\u{1F300}-\u{1FAFF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{27BF}\u{1F900}-\u{1F9FF}]/gu, severity: 'BLOCKER' },
  { name: 'emoji-text', regex: /(?<![A-Za-z0-9])[:;]-?[\)\(DPpOo](?![A-Za-z0-9])/g, severity: 'BLOCKER' },
  { name: 'double-space', regex: /  /g, severity: 'WARN' },
];

const LI_CLICHE = [
  { name: 'szybciej-niż-myślisz', regex: /szybciej niż myślisz/i, severity: 'BLOCKER' },
  { name: 'co-zrobiłem-w-24h', regex: /co zrobiłem w \d+h:/i, severity: 'WARN' },
  { name: 'DM-słowem-X', regex: /DM ze słowem|napisz DM ze słowem|wyślij DM (z |ze )/i, severity: 'BLOCKER' },
  { name: 'jak-X-bez-Y', regex: /to jak \w+ bez \w+/i, severity: 'WARN' },
  { name: 'do-momentu-aż', regex: /do momentu aż/i, severity: 'WARN' },
  { name: 'tyle-kropka', regex: /^Tyle\.$/m, severity: 'WARN' },
  { name: 'game-changer', regex: /game.changer|must.have|no.brainer|rewolucj/i, severity: 'BLOCKER' },
  { name: 'pierwsze-próby-podręcznikowe', regex: /pierwsze próby.*podręcznikow/i, severity: 'WARN' },
];

const AI_OPENERS = [
  { name: 'w-dzisiejszym', regex: /w dzisiejszym (dynamicznym )?świecie/i, severity: 'BLOCKER' },
  { name: 'w-erze', regex: /^w erze (cyfryzacji|cyfrowej|ai)/im, severity: 'BLOCKER' },
  { name: 'należy-pamiętać', regex: /należy (pamiętać|zaznaczyć|zauważyć|podkreślić)/i, severity: 'WARN' },
  { name: 'warto-zauważyć', regex: /warto (zauważyć|podkreślić|wspomnieć|zaznaczyć)/i, severity: 'WARN' },
  { name: 'zagłębmy-się', regex: /zagłębmy się|przyjrzyjmy się bliżej/i, severity: 'BLOCKER' },
  { name: 'niewątpliwie', regex: /niewątpliwie/i, severity: 'WARN' },
];

const EMPTY_ADJ = [
  { name: 'puste-przymiotniki', regex: /\b(kluczow[aoyei]|istotn[aoyei]|fundamentaln[aoyei]|rewolucyjn[aoyei]|przełomow[aoyei]|kompleksow[aoyei])\b/gi, severity: 'INFO' },
];

const STRUCTURE = [
  { name: 'hashtags-count', check: (t) => {
      const tags = (t.match(/#\w+/g) || []).length;
      if (tags === 0) return 'BLOCKER: no hashtags';
      if (tags !== 3) return `WARN: ${tags} hashtags (expected 3)`;
      return null;
    }
  },
  { name: 'length', check: (t) => {
      const chars = t.length;
      if (chars < 800) return `BLOCKER: too short (${chars}c, want 1300-1600)`;
      if (chars < 1000) return `WARN: short (${chars}c)`;
      if (chars > 2000) return `WARN: too long (${chars}c)`;
      return null;
    }
  },
  { name: 'hook-length', check: (t) => {
      const hook = t.split('\n')[0].length;
      if (hook > 220) return `BLOCKER: hook too long (${hook}c)`;
      if (hook > 180) return `WARN: hook long (${hook}c, optimal 62-100)`;
      return null;
    }
  },
];

function audit(text) {
  const issues = [];
  for (const set of [HARD_BANS, LI_CLICHE, AI_OPENERS, EMPTY_ADJ]) {
    for (const rule of set) {
      const matches = text.match(rule.regex);
      if (matches && matches.length > 0) {
        issues.push({ severity: rule.severity, rule: rule.name, count: matches.length, sample: matches[0].slice(0, 50) });
      }
    }
  }
  for (const rule of STRUCTURE) {
    const r = rule.check(text);
    if (r) issues.push({ severity: r.startsWith('BLOCKER') ? 'BLOCKER' : 'WARN', rule: rule.name, message: r });
  }
  return issues;
}

const results = posts.map((p) => ({
  id: p.id.slice(0, 8),
  topic: p.topic_number,
  slug: p.slug,
  publish_at: p.publish_at,
  chars: p.text.length,
  issues: audit(p.text),
}));

console.log(`\n📋 Audyt ${results.length} scheduled posts\n`);
console.log('─'.repeat(80));

const summary = { BLOCKER: 0, WARN: 0, INFO: 0 };
const cleanCount = results.filter((r) => r.issues.length === 0).length;

for (const r of results) {
  const blockers = r.issues.filter((i) => i.severity === 'BLOCKER').length;
  const warns = r.issues.filter((i) => i.severity === 'WARN').length;
  const infos = r.issues.filter((i) => i.severity === 'INFO').length;
  const status = blockers > 0 ? '❌' : warns > 0 ? '⚠️ ' : infos > 0 ? '🟡' : '✅';
  console.log(`${status} #${r.topic} ${r.slug || r.id} (${r.chars}c, ${r.publish_at.slice(0,10)})`);
  for (const i of r.issues) {
    const tag = i.severity === 'BLOCKER' ? '❌' : i.severity === 'WARN' ? '⚠️ ' : '🟡';
    console.log(`    ${tag} ${i.rule}: ${i.message || i.sample}${i.count > 1 ? ` (×${i.count})` : ''}`);
  }
  summary.BLOCKER += blockers;
  summary.WARN += warns;
  summary.INFO += infos;
}

console.log('─'.repeat(80));
console.log(`\n📊 SUMMARY: ${cleanCount}/${results.length} clean | ${summary.BLOCKER} BLOCKERS | ${summary.WARN} WARNS | ${summary.INFO} INFOS\n`);
