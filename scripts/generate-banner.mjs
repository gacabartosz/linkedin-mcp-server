#!/usr/bin/env node
/**
 * LinkedIn Post Banner Generator
 *
 * Generates 1200x627 PNG banners for LinkedIn posts using Puppeteer.
 *
 * Usage:
 *   node scripts/generate-banner.mjs --title "Title" --subtitle "Subtitle" --out banner.png
 *   node scripts/generate-banner.mjs --preset post5 --out post5.png
 *   node scripts/generate-banner.mjs --preset all --outdir /Users/gaca/output/personal/linkedin-mcp/
 */

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const WIDTH = 1200;
const HEIGHT = 627;

// ── Preset banners for each post ──────────────────────────────────────────────

const PRESETS = {
  post5: {
    style: 'terminal',
    title: 'This Post Published Itself',
    lines: [
      { text: '$ node auto-publish.mjs', color: '#4EC9B0' },
      { text: 'LinkedIn Auto-Publisher started', color: '#6A9955' },
      { text: 'Checking every 60 seconds...', color: '#6A9955' },
      { text: '', color: '' },
      { text: '[2026-03-10T08:30:02Z] Checking...', color: '#DCDCAA' },
      { text: 'Publishing scheduled post 7...', color: '#569CD6' },
      { text: 'Published: urn:li:share:743XXXXXXXXX', color: '#4EC9B0' },
      { text: 'Comment queued for 09:45 CET', color: '#CE9178' },
      { text: '', color: '' },
      { text: '[2026-03-10T08:45:01Z] Adding comment...', color: '#DCDCAA' },
      { text: 'Comment added: GitHub link ✓', color: '#4EC9B0' },
    ],
  },

  post7: {
    style: 'grid',
    title: '12 LinkedIn Post Templates',
    subtitle: 'Built into linkedin-mcp-server',
    items: [
      '📝 Thought Leadership', '📝 Thought Leadership PL',
      '📊 Case Study', '🎬 Behind the Scenes',
      '🎯 Engagement Hook', '🔥 Viral Trend',
      '❓ Community Question', '🧲 Lead Magnet',
      '📚 Carousel Edu', '📖 Carousel Text',
      '💡 Lesson Learned', '📢 Announcement',
    ],
  },

  post9: {
    style: 'diagram',
    title: 'MCP — Model Context Protocol',
    boxes: [
      { label: 'Claude Code', x: 50, icon: '🤖' },
      { label: 'MCP Server', x: 420, icon: '⚡' },
      { label: 'LinkedIn API', x: 790, icon: '💼' },
    ],
    arrows: ['→ JSON-RPC →', '→ REST API →'],
  },

  post10: {
    style: 'checklist',
    title: 'LinkedIn Algorithm Checklist',
    subtitle: 'Coded into linkedin-mcp-server',
    checks: [
      { text: 'Hook in first 210 chars', ok: true },
      { text: 'Post length 1300-1600 chars', ok: true },
      { text: 'Max 3 hashtags at end', ok: true },
      { text: 'Link in comment, not body', ok: true },
      { text: 'CTA as last line', ok: true },
      { text: 'Post Tue-Thu 8:00/9:30/17:00', ok: true },
      { text: 'Min 12h gap between posts', ok: true },
      { text: 'Comment with link after 15 min', ok: true },
    ],
  },

  post11: {
    style: 'stack',
    title: 'Solo Founder AI Stack',
    layers: [
      { label: 'Claude Code', desc: 'AI Assistant', color: '#D97706' },
      { label: 'LinkedIn MCP', desc: '25 Tools', color: '#0077B5' },
      { label: 'Facebook MCP', desc: 'Auto-Posts + Groups', color: '#1877F2' },
      { label: 'Auto-Publish', desc: 'Background Daemon', color: '#059669' },
    ],
  },
};

// ── HTML Templates ────────────────────────────────────────────────────────────

function terminalHTML({ title, lines }) {
  const lineRows = lines.map(l =>
    l.text ? `<div style="color:${l.color};font-family:'SF Mono','Fira Code',monospace;font-size:18px;line-height:1.6">${escHtml(l.text)}</div>` : '<div style="height:12px"></div>'
  ).join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;width:${WIDTH}px;height:${HEIGHT}px;background:#1E1E1E;display:flex;flex-direction:column">
    <div style="background:#323233;padding:10px 20px;display:flex;align-items:center;gap:8px">
      <div style="width:12px;height:12px;border-radius:50%;background:#FF5F56"></div>
      <div style="width:12px;height:12px;border-radius:50%;background:#FFBD2E"></div>
      <div style="width:12px;height:12px;border-radius:50%;background:#27C93F"></div>
      <span style="color:#999;font-family:sans-serif;font-size:14px;margin-left:12px">auto-publish.mjs — linkedin-mcp-server</span>
    </div>
    <div style="flex:1;padding:24px 30px;overflow:hidden">${lineRows}</div>
    <div style="padding:12px 30px;background:#252526;color:#0077B5;font-family:sans-serif;font-size:16px;font-weight:bold">${escHtml(title)} — github.com/gacabartosz/linkedin-mcp-server</div>
  </body></html>`;
}

function gridHTML({ title, subtitle, items }) {
  const cards = items.map(item =>
    `<div style="background:#252526;border:1px solid #3E3E42;border-radius:10px;padding:16px 14px;text-align:center;font-size:15px;color:#E0E0E0;font-family:sans-serif">${escHtml(item)}</div>`
  ).join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;width:${WIDTH}px;height:${HEIGHT}px;background:#1A1A2E;display:flex;flex-direction:column;align-items:center;justify-content:center">
    <h1 style="color:#fff;font-family:sans-serif;font-size:36px;margin:0 0 6px">${escHtml(title)}</h1>
    <p style="color:#0077B5;font-family:sans-serif;font-size:18px;margin:0 0 28px">${escHtml(subtitle)}</p>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;width:90%">${cards}</div>
    <p style="color:#666;font-family:sans-serif;font-size:14px;margin-top:20px">github.com/gacabartosz/linkedin-mcp-server</p>
  </body></html>`;
}

function diagramHTML({ title, boxes, arrows }) {
  const boxEls = boxes.map(b =>
    `<div style="position:absolute;left:${b.x}px;top:220px;width:280px;height:140px;background:#252526;border:2px solid #0077B5;border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center">
      <span style="font-size:48px">${b.icon}</span>
      <span style="color:#fff;font-family:sans-serif;font-size:22px;font-weight:bold;margin-top:8px">${escHtml(b.label)}</span>
    </div>`
  ).join('');
  const arrowEls = arrows.map((a, i) =>
    `<div style="position:absolute;left:${330 + i * 370}px;top:272px;color:#0077B5;font-family:sans-serif;font-size:16px;font-weight:bold;width:90px;text-align:center">${escHtml(a)}</div>`
  ).join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;width:${WIDTH}px;height:${HEIGHT}px;background:#1A1A2E;position:relative">
    <h1 style="color:#fff;font-family:sans-serif;font-size:38px;text-align:center;padding-top:40px;margin:0">${escHtml(title)}</h1>
    <p style="color:#0077B5;font-family:sans-serif;font-size:18px;text-align:center;margin:8px 0">How AI tools connect to real APIs</p>
    ${boxEls}${arrowEls}
    <p style="position:absolute;bottom:16px;width:100%;text-align:center;color:#666;font-family:sans-serif;font-size:14px;margin:0">github.com/gacabartosz/linkedin-mcp-server</p>
  </body></html>`;
}

function checklistHTML({ title, subtitle, checks }) {
  const rows = checks.map(c =>
    `<div style="display:flex;align-items:center;gap:14px;padding:10px 0;border-bottom:1px solid #2A2A3E">
      <span style="font-size:24px">${c.ok ? '✅' : '❌'}</span>
      <span style="color:#E0E0E0;font-family:sans-serif;font-size:19px">${escHtml(c.text)}</span>
    </div>`
  ).join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;width:${WIDTH}px;height:${HEIGHT}px;background:#1A1A2E;display:flex;flex-direction:column;align-items:center;padding-top:30px">
    <h1 style="color:#fff;font-family:sans-serif;font-size:34px;margin:0">${escHtml(title)}</h1>
    <p style="color:#0077B5;font-family:sans-serif;font-size:17px;margin:4px 0 20px">${escHtml(subtitle)}</p>
    <div style="width:75%">${rows}</div>
    <p style="color:#666;font-family:sans-serif;font-size:14px;margin-top:auto;margin-bottom:16px">github.com/gacabartosz/linkedin-mcp-server</p>
  </body></html>`;
}

function stackHTML({ title, layers }) {
  const layerEls = layers.map(l =>
    `<div style="background:${l.color};border-radius:12px;padding:18px 32px;display:flex;justify-content:space-between;align-items:center;width:80%">
      <span style="color:#fff;font-family:sans-serif;font-size:24px;font-weight:bold">${escHtml(l.label)}</span>
      <span style="color:rgba(255,255,255,0.8);font-family:sans-serif;font-size:17px">${escHtml(l.desc)}</span>
    </div>`
  ).join('');
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;width:${WIDTH}px;height:${HEIGHT}px;background:#1A1A2E;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px">
    <h1 style="color:#fff;font-family:sans-serif;font-size:36px;margin:0 0 16px">${escHtml(title)}</h1>
    ${layerEls}
    <p style="color:#666;font-family:sans-serif;font-size:14px;margin-top:12px">github.com/gacabartosz/linkedin-mcp-server</p>
  </body></html>`;
}

function genericHTML({ title, subtitle, style }) {
  const bg = style === 'light' ? '#FFFFFF' : '#1A1A2E';
  const fg = style === 'light' ? '#1A1A2E' : '#FFFFFF';
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;width:${WIDTH}px;height:${HEIGHT}px;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center">
    <h1 style="color:${fg};font-family:sans-serif;font-size:42px;text-align:center;margin:0;padding:0 60px">${escHtml(title)}</h1>
    ${subtitle ? `<p style="color:#0077B5;font-family:sans-serif;font-size:22px;margin:16px 0">${escHtml(subtitle)}</p>` : ''}
    <p style="color:#666;font-family:sans-serif;font-size:16px;margin-top:32px">github.com/gacabartosz/linkedin-mcp-server</p>
  </body></html>`;
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Render ────────────────────────────────────────────────────────────────────

function buildHTML(preset) {
  switch (preset.style) {
    case 'terminal': return terminalHTML(preset);
    case 'grid': return gridHTML(preset);
    case 'diagram': return diagramHTML(preset);
    case 'checklist': return checklistHTML(preset);
    case 'stack': return stackHTML(preset);
    default: return genericHTML(preset);
  }
}

async function renderPNG(html, outPath) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  mkdirSync(dirname(outPath), { recursive: true });
  await page.screenshot({ path: outPath, type: 'png' });
  await browser.close();
  console.log(`Generated: ${outPath}`);
}

// ── CLI ───────────────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    title: { type: 'string' },
    subtitle: { type: 'string', default: '' },
    style: { type: 'string', default: 'dark' },
    preset: { type: 'string' },
    out: { type: 'string' },
    outdir: { type: 'string', default: '/Users/gaca/output/personal/linkedin-mcp' },
  },
});

async function main() {
  if (values.preset === 'all') {
    for (const [name, preset] of Object.entries(PRESETS)) {
      const html = buildHTML(preset);
      await renderPNG(html, join(values.outdir, `${name}-banner.png`));
    }
    return;
  }

  if (values.preset && PRESETS[values.preset]) {
    const html = buildHTML(PRESETS[values.preset]);
    const out = values.out || join(values.outdir, `${values.preset}-banner.png`);
    await renderPNG(html, out);
    return;
  }

  if (values.title) {
    const html = genericHTML({ title: values.title, subtitle: values.subtitle, style: values.style });
    const out = values.out || join(values.outdir, 'custom-banner.png');
    await renderPNG(html, out);
    return;
  }

  console.log('Usage:');
  console.log('  --preset post5|post7|post9|post10|post11|all');
  console.log('  --title "Title" [--subtitle "Sub"] [--style dark|light]');
  console.log('  --out output.png');
}

main().catch(console.error);
