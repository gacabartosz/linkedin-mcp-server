#!/usr/bin/env node
/**
 * LinkedIn Post Banner Generator v2
 * Professional, scroll-stopping banners with CTA, bold colors, mobile-friendly.
 *
 * Usage:
 *   node scripts/generate-banner.mjs --preset all
 *   node scripts/generate-banner.mjs --preset post5
 */

import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const W = 1200;
const H = 627;
const OUT_DIR = '/Users/gaca/output/personal/linkedin-mcp';
const BRAND = 'Bartosz Gaca';

function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

// ── Design System ────────────────────────────────────────────────────────────

const GRADIENTS = {
  ocean:    'linear-gradient(135deg, #0077B5 0%, #00A0DC 50%, #0E76A8 100%)',
  sunset:   'linear-gradient(135deg, #FF6B35 0%, #F7C948 100%)',
  purple:   'linear-gradient(135deg, #5B21B6 0%, #7C3AED 40%, #A78BFA 100%)',
  emerald:  'linear-gradient(135deg, #059669 0%, #10B981 50%, #34D399 100%)',
  fire:     'linear-gradient(135deg, #DC2626 0%, #F97316 100%)',
  midnight: 'linear-gradient(135deg, #1E1B4B 0%, #312E81 50%, #4338CA 100%)',
  teal:     'linear-gradient(135deg, #0D9488 0%, #14B8A6 100%)',
  rose:     'linear-gradient(135deg, #BE185D 0%, #EC4899 100%)',
};

function baseStyle(gradient) {
  return `margin:0;padding:0;width:${W}px;height:${H}px;background:${gradient};display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;position:relative;overflow:hidden`;
}

function ctaBar(text = 'Link in comments') {
  return `<div style="position:absolute;bottom:0;left:0;right:0;padding:14px 40px;background:rgba(0,0,0,0.35);display:flex;justify-content:space-between;align-items:center">
    <span style="color:rgba(255,255,255,0.9);font-size:15px;font-weight:600">${esc(BRAND)}</span>
    <span style="color:#fff;font-size:15px;font-weight:700;display:flex;align-items:center;gap:6px">${esc(text)} <span style="font-size:20px">↓</span></span>
  </div>`;
}

function decorCircles() {
  return `<div style="position:absolute;top:-80px;right:-80px;width:300px;height:300px;border-radius:50%;background:rgba(255,255,255,0.06)"></div>
  <div style="position:absolute;bottom:-120px;left:-60px;width:350px;height:350px;border-radius:50%;background:rgba(255,255,255,0.04)"></div>`;
}

// ── Templates ────────────────────────────────────────────────────────────────

function heroHTML({ gradient, headline, subline, stat, statLabel, cta }) {
  return `<!DOCTYPE html><html><body style="${baseStyle(gradient)}">
    ${decorCircles()}
    ${stat ? `<div style="font-size:80px;font-weight:900;color:#fff;letter-spacing:-2px;margin-bottom:4px;text-shadow:0 4px 20px rgba(0,0,0,0.3)">${esc(stat)}</div>` : ''}
    ${statLabel ? `<div style="font-size:18px;color:rgba(255,255,255,0.8);font-weight:500;margin-bottom:20px;text-transform:uppercase;letter-spacing:3px">${esc(statLabel)}</div>` : ''}
    <div style="font-size:46px;font-weight:800;color:#fff;text-align:center;max-width:900px;line-height:1.2;text-shadow:0 2px 12px rgba(0,0,0,0.2);padding:0 40px">${esc(headline)}</div>
    ${subline ? `<div style="font-size:22px;color:rgba(255,255,255,0.85);margin-top:16px;font-weight:500;text-align:center;max-width:800px;padding:0 40px">${esc(subline)}</div>` : ''}
    ${ctaBar(cta || 'Link in comments')}
  </body></html>`;
}

function splitHTML({ gradient, headline, bullets, cta }) {
  const left = `<div style="flex:1;padding:50px;display:flex;flex-direction:column;justify-content:center">
    <div style="font-size:40px;font-weight:800;color:#fff;line-height:1.15;margin-bottom:24px;text-shadow:0 2px 8px rgba(0,0,0,0.15)">${esc(headline)}</div>
    ${bullets.map(b => `<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
      <span style="width:28px;height:28px;border-radius:50%;background:rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;flex-shrink:0">✓</span>
      <span style="color:rgba(255,255,255,0.92);font-size:18px;font-weight:500">${esc(b)}</span>
    </div>`).join('')}
  </div>`;
  const right = `<div style="flex:0.7;display:flex;align-items:center;justify-content:center">
    <div style="width:280px;height:280px;border-radius:24px;background:rgba(255,255,255,0.12);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;font-size:120px;text-shadow:0 4px 20px rgba(0,0,0,0.2)">🚀</div>
  </div>`;
  return `<!DOCTYPE html><html><body style="${baseStyle(gradient)};flex-direction:row">
    ${decorCircles()}${left}${right}${ctaBar(cta || 'Link in comments')}
  </body></html>`;
}

function numbersHTML({ gradient, numbers, headline, cta }) {
  const numEls = numbers.map(n => `<div style="text-align:center">
    <div style="font-size:52px;font-weight:900;color:#fff">${esc(n.value)}</div>
    <div style="font-size:14px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:2px;margin-top:4px">${esc(n.label)}</div>
  </div>`).join('');
  return `<!DOCTYPE html><html><body style="${baseStyle(gradient)}">
    ${decorCircles()}
    <div style="font-size:42px;font-weight:800;color:#fff;text-align:center;max-width:900px;line-height:1.15;margin-bottom:36px;padding:0 40px;text-shadow:0 2px 12px rgba(0,0,0,0.2)">${esc(headline)}</div>
    <div style="display:flex;gap:60px;align-items:center">${numEls}</div>
    ${ctaBar(cta || 'Link in comments')}
  </body></html>`;
}

function vsHTML({ gradient, before, after, headline, cta }) {
  const box = (title, items, opacity) => `<div style="background:rgba(255,255,255,${opacity});border-radius:16px;padding:28px;width:400px">
    <div style="font-size:22px;font-weight:800;color:#fff;margin-bottom:16px">${esc(title)}</div>
    ${items.map(i => `<div style="color:rgba(255,255,255,0.85);font-size:16px;margin-bottom:8px;display:flex;align-items:center;gap:8px">${esc(i)}</div>`).join('')}
  </div>`;
  return `<!DOCTYPE html><html><body style="${baseStyle(gradient)}">
    ${decorCircles()}
    <div style="font-size:38px;font-weight:800;color:#fff;margin-bottom:28px;text-shadow:0 2px 8px rgba(0,0,0,0.2)">${esc(headline)}</div>
    <div style="display:flex;gap:24px;align-items:stretch">
      ${box(before.title, before.items, '0.08')}
      <div style="display:flex;align-items:center;font-size:36px;color:rgba(255,255,255,0.6);font-weight:900">→</div>
      ${box(after.title, after.items, '0.15')}
    </div>
    ${ctaBar(cta || 'Link in comments')}
  </body></html>`;
}

// ── Presets ───────────────────────────────────────────────────────────────────

const PRESETS = {
  post5: () => heroHTML({
    gradient: GRADIENTS.midnight,
    stat: '0',
    statLabel: 'manual steps to publish',
    headline: 'This Post Published Itself',
    subline: 'Written Sunday → Auto-published Tuesday 9:30 → GitHub link added 15 min later',
    cta: 'See how it works ↓',
  }),

  post6: () => numbersHTML({
    gradient: GRADIENTS.ocean,
    headline: 'Jedyny Open-Source LinkedIn MCP',
    numbers: [
      { value: '25', label: 'narzedzi MCP' },
      { value: '12', label: 'szablonow' },
      { value: '0', label: 'oplat' },
    ],
    cta: 'Kod zrodlowy w komentarzu ↓',
  }),

  post7: () => splitHTML({
    gradient: GRADIENTS.purple,
    headline: '12 Templates That Write LinkedIn Posts For You',
    bullets: [
      'Hook optimized for 210-char cutoff',
      'Algorithm rules built-in',
      'Link in comment, never in body',
      'Max 3 hashtags, CTA as last line',
      'Auto-scheduled + auto-published',
    ],
    cta: 'Get all 12 templates free ↓',
  }),

  post8: () => numbersHTML({
    gradient: GRADIENTS.fire,
    headline: 'From Zero to 25 LinkedIn Tools',
    numbers: [
      { value: '48h', label: 'build time' },
      { value: '25', label: 'MCP tools' },
      { value: '1', label: 'developer + AI' },
    ],
    cta: 'Full git history in comments ↓',
  }),

  post9: () => vsHTML({
    gradient: GRADIENTS.teal,
    headline: 'MCP zmienia wszystko',
    before: {
      title: '❌ Przed MCP',
      items: ['→ AI pisze tekst', '→ Ty sam wklejasz', '→ Ty sam publikujesz', '→ Ty sam dodajesz link'],
    },
    after: {
      title: '✅ Z MCP',
      items: ['→ "Zaplanuj post na czwartek"', '→ Gotowe. Opublikowany.', '→ Z grafika i komentarzem.', '→ Zero recznej pracy.'],
    },
    cta: 'Kod zrodlowy w komentarzu ↓',
  }),

  post10: () => splitHTML({
    gradient: GRADIENTS.ocean,
    headline: 'LinkedIn Algorithm Rules I Coded Into a Tool',
    bullets: [
      'Hook in first 210 characters',
      '1300-1600 chars sweet spot',
      'Link in comment after 15 min',
      'Post Tue-Thu at 8:00 / 9:30 / 17:00',
      'Max 3 hashtags at the end',
    ],
    cta: 'Open source — link in comments ↓',
  }),

  post11: () => numbersHTML({
    gradient: GRADIENTS.emerald,
    headline: 'My Entire Content Stack\nas a Solo Founder',
    numbers: [
      { value: '2h', label: 'per week' },
      { value: '4', label: 'posts auto-published' },
      { value: '0', label: 'manual work' },
    ],
    cta: 'Full stack is open source ↓',
  }),

  post12: () => numbersHTML({
    gradient: GRADIENTS.sunset,
    headline: '3 Weeks of MCP-Powered LinkedIn',
    numbers: [
      { value: '12', label: 'posts published' },
      { value: '100%', label: 'automated' },
      { value: '6h', label: 'total time spent' },
    ],
    cta: 'Real numbers in comments ↓',
  }),

  post13: () => heroHTML({
    gradient: GRADIENTS.purple,
    stat: '33',
    statLabel: 'SEO audit tools in one MCP',
    headline: 'Run a Full SEO Audit From a Single AI Conversation',
    subline: 'Technical SEO + Core Web Vitals + Schema + GEO — all open source',
    cta: 'GitHub link in comments ↓',
  }),

  post14: () => heroHTML({
    gradient: GRADIENTS.midnight,
    stat: '69+',
    statLabel: 'free AI models, one API',
    headline: 'G.A.C.A. — Drop-In OpenAI Replacement',
    subline: '11 providers, auto-failover, smart routing. Your app doesn\'t change a line of code.',
    cta: 'Open source — link in comments ↓',
  }),

  post15: () => vsHTML({
    gradient: GRADIENTS.emerald,
    headline: 'The Full Auto-Publish Pipeline',
    before: {
      title: '🕐 Sunday',
      items: ['→ Write 4 posts with Claude', '→ Review + approve', '→ Schedule via MCP', '→ Done. Close laptop.'],
    },
    after: {
      title: '🤖 Mon-Fri (auto)',
      items: ['→ Daemon checks every 60s', '→ Publish at optimal time', '→ Upload image automatically', '→ Add GitHub link after 15min'],
    },
    cta: 'This post was automated too ↓',
  }),

  post16: () => heroHTML({
    gradient: GRADIENTS.rose,
    stat: '28',
    statLabel: 'typow danych PII do anonimizacji',
    headline: 'Przestań wklejać dane klientów do ChatGPT',
    subline: 'Presidio Browser Anonymizer — 100% offline, Chrome Extension, Docker',
    cta: 'Link w komentarzu ↓',
  }),

  post17: () => numbersHTML({
    gradient: GRADIENTS.ocean,
    headline: 'My Open Source MCP Ecosystem',
    numbers: [
      { value: '25', label: 'LinkedIn tools' },
      { value: '28', label: 'Facebook tools' },
      { value: '33', label: 'SEO tools' },
    ],
    cta: 'All repos in comments ↓',
  }),
};

// ── Render ────────────────────────────────────────────────────────────────────

async function renderPNG(html, outPath) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  mkdirSync(dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, type: 'png' });
  await browser.close();
  console.log('Generated: ' + outPath);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    preset: { type: 'string' },
    out: { type: 'string' },
    outdir: { type: 'string', default: OUT_DIR },
  },
});

async function main() {
  if (values.preset === 'all') {
    for (const [name, fn] of Object.entries(PRESETS)) {
      await renderPNG(fn(), join(values.outdir, name + '-banner.png'));
    }
    console.log('\nAll ' + Object.keys(PRESETS).length + ' banners generated!');
    return;
  }

  if (values.preset && PRESETS[values.preset]) {
    const out = values.out || join(values.outdir, values.preset + '-banner.png');
    await renderPNG(PRESETS[values.preset](), out);
    return;
  }

  console.log('Available presets: ' + Object.keys(PRESETS).join(', '));
  console.log('Usage: --preset post5|all [--outdir path]');
}

main().catch(console.error);
