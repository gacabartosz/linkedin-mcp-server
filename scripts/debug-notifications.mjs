#!/usr/bin/env node
import { chromium } from 'playwright';
import { join } from 'node:path';
import { homedir } from 'node:os';

const PROFILE = join(homedir(), '.linkedin-mcp', 'browser-profile');

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false, channel: 'chrome',
  viewport: { width: 1280, height: 800 },
  args: ['--disable-blink-features=AutomationControlled'],
});
const page = ctx.pages()[0] || await ctx.newPage();
await page.addInitScript(() => Object.defineProperty(navigator, 'webdriver', { get: () => undefined }));

await page.goto('https://www.linkedin.com/notifications/?filter=all', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(8000);
console.log('URL:', page.url());

const all = await page.evaluate(() => {
  function classify(text) {
    if (/skomentował.{0,40}(twoj|twój)/i.test(text)) return 'OUR_POST_COMMENT';
    if (/odpisał.{0,40}(twoj|twój|tobie)/i.test(text)) return 'OUR_COMMENT_REPLY';
    if (/(wspomniał|@.{0,20}bartosz|mentioned)/i.test(text)) return 'MENTION';
    if (/zareagował.{0,40}(twoj|twój)/i.test(text)) return 'OUR_POST_REACTION';
    if (/(skomentował|commented)/i.test(text)) return 'OTHER_COMMENT';
    if (/(wyświetlił|viewed.*profile)/i.test(text)) return 'PROFILE_VIEW';
    if (/(teraz obserwujesz|following|now following)/i.test(text)) return 'FOLLOW';
    if (/(zarejestruj|event|wydarzenie)/i.test(text)) return 'EVENT';
    if (/(popularna|trending|popular)/i.test(text)) return 'TREND';
    if (/(zaprosił|invitation|invited)/i.test(text)) return 'INVITATION';
    return 'OTHER';
  }
  const cards = document.querySelectorAll('article.nt-card');
  return Array.from(cards).map((card, i) => {
    const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
    const links = Array.from(card.querySelectorAll('a')).map(a => a.href);
    return {
      idx: i + 1, type: classify(text),
      text: text.slice(0, 250), links: links.slice(0, 3),
      unread: card.classList.contains('nt-card--unread'),
    };
  });
});

console.log(`\n=== ZNALAZŁEM ${all.length} NOTYFIKACJI ===\n`);
all.forEach(n => {
  const flag = ['OUR_POST_COMMENT', 'OUR_COMMENT_REPLY', 'MENTION'].includes(n.type) ? '🎯' : '  ';
  console.log(`${flag} #${n.idx} [${n.type}]${n.unread ? ' UNREAD' : ''}`);
  console.log(`   Text: ${n.text.slice(0, 180)}`);
  console.log(`   Link: ${n.links[1] || n.links[0] || '(brak)'}`);
  console.log('');
});

const byType = {};
all.forEach(n => { byType[n.type] = (byType[n.type] || 0) + 1; });
console.log('=== PODSUMOWANIE ===');
Object.entries(byType).sort((a,b) => b[1]-a[1]).forEach(([t, c]) => console.log(`  ${t}: ${c}`));

const ints = all.filter(n => ['OUR_POST_COMMENT', 'OUR_COMMENT_REPLY', 'MENTION'].includes(n.type));
console.log(`\n>>> Do odpowiedzi: ${ints.length} <<<`);

await page.waitForTimeout(3000);
await ctx.close();
