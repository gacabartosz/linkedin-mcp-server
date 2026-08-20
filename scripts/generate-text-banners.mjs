#!/usr/bin/env node
/**
 * Generator banerów tekstowych dla postów LinkedIn (1200×627, retina 2x)
 *
 * Tworzy proste banery z hookiem jako głównym tekstem:
 * - ciemne tło #0F172A
 * - duży hook (white, max 62 znaki = 1 linia)
 * - mały tag z nazwą projektu (cyan #00E5FF)
 * - na dole: "bartoszgaca.pl" branding
 *
 * Wykorzystuje Puppeteer (Chrome installed via puppeteer) lub Playwright.
 *
 * Usage: node generate-text-banners.mjs <slug> "<hook>" "<tag>"
 *   slug: 13-faq-bot-biznesbezklikania
 *   hook: "Każda firma ma te same pytania. Codziennie."
 *   tag:  "biznesbezklikania.pl"
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BANNERS_ROOT = '/Users/gaca/projects/personal/bartoszgaca.pl/banners/2026-Q2';

async function generateBanner({ slug, hook, tag }) {
  const outDir = join(BANNERS_ROOT, slug);
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'banner.png');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@500;700;900&family=JetBrains+Mono:wght@500;700&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 1200px; height: 627px; background: #0F172A; font-family: 'Inter', sans-serif; overflow: hidden; position: relative; }
  .grid { position: absolute; inset: 0; background-image:
    linear-gradient(rgba(0,229,255,0.04) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0,229,255,0.04) 1px, transparent 1px);
    background-size: 40px 40px; }
  .container { position: relative; padding: 80px 70px; height: 100%; display: flex; flex-direction: column; justify-content: space-between; z-index: 1; }
  .tag { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; background: rgba(0,229,255,0.1); border: 1px solid rgba(0,229,255,0.3); border-radius: 6px; color: #00E5FF; font-family: 'JetBrains Mono', monospace; font-size: 16px; font-weight: 500; align-self: flex-start; }
  .tag::before { content: '▋'; color: #00E5FF; animation: blink 1s step-end infinite; }
  @keyframes blink { 0%,50% {opacity:1} 50.01%,100%{opacity:0} }
  .hook { color: #FFFFFF; font-size: 72px; font-weight: 900; line-height: 1.05; letter-spacing: -0.02em; max-width: 1060px; }
  .footer { display: flex; justify-content: space-between; align-items: center; }
  .brand { color: #94A3B8; font-family: 'JetBrains Mono', monospace; font-size: 18px; font-weight: 500; }
  .accent { width: 12px; height: 12px; background: #00E5FF; border-radius: 50%; }
</style></head>
<body>
  <div class="grid"></div>
  <div class="container">
    <div>
      <div class="tag">${tag}</div>
    </div>
    <div class="hook">${hook}</div>
    <div class="footer">
      <div class="brand">bartoszgaca.pl</div>
      <div class="accent"></div>
    </div>
  </div>
</body></html>`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 627 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.screenshot({ path: outPath, fullPage: false, omitBackground: false });
  await browser.close();

  console.log(`✅ ${slug}/banner.png (${hook.length} char hook)`);
  return outPath;
}

const BANNERS = [
  // Posty z poprawionymi hookami (po usunięciu halucynacji)
  { slug: '14-flora-whatsapp-szkola-jezykowa', hook: 'Szkoła językowa odpisywała na WhatsApp wieczorami.', tag: 'zapiszsiedoflow.pl' },
  { slug: '15-panelszkoly-saas', hook: 'Szkoła prywatna potrzebuje 5 narzędzi. Włącza 5 aplikacji.', tag: 'panelszkoly.pl' },
  { slug: '17-aplikantai-5-specjalistow', hook: '5 specjalistów od polskiego prawa. Żaden nie bierze urlopu.', tag: 'aplikantai.pl' },
  { slug: '18-mcp-zus-pierwsze-polskie-api', hook: 'ZUS ma API. Nikt o tym nie wie.', tag: 'mcp-zus' },
  { slug: '19-odpisznapismo-pisma-urzedowe', hook: 'Polak dostaje pismo z urzędu. Panikuje.', tag: 'odpisznapismo.pl' },
  { slug: '20-gaca-core-cost-arbitrage', hook: 'Płacisz Anthropic 100 USD/mies. Używasz 12% mocy.', tag: 'gaca-core' },
  { slug: '21-wa-bot-bartoszgaca', hook: 'Mój WhatsApp odpowiada za mnie od miesięcy.', tag: 'bartoszgaca.pl' },
  { slug: '22-gacek-polski-cli-bielik', hook: 'Polski CLI asystent AI. Działa offline. 0 zł/mies.', tag: 'gacek.bartoszgaca.pl' },
];

(async () => {
  for (const b of BANNERS) {
    try { await generateBanner(b); }
    catch (e) { console.error(`❌ ${b.slug}: ${e.message}`); }
  }
  console.log(`\nGotowe: ${BANNERS.length} banerów w ${BANNERS_ROOT}`);
})();
