#!/usr/bin/env node
/**
 * Banner Generator v2 — Clean, professional LinkedIn banners
 * No clipart, no noise, no geometric shapes. Just strong typography and real content.
 *
 * Usage: node scripts/generate-banners-v2.mjs [post3|post4|all]
 */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const OUT_DIR = '/Users/gaca/output/personal/linkedin-mcp';
mkdirSync(OUT_DIR, { recursive: true });

const WIDTH = 1200;
const HEIGHT = 627;

// ── Design System ────────────────────────────────────────────────────────

const FONTS = `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700&display=swap');`;

const PALETTE = {
  dark: { bg: '#0a0a0a', text: '#ffffff', accent: '#3b82f6', muted: 'rgba(255,255,255,0.5)' },
  navy: { bg: '#0f172a', text: '#f8fafc', accent: '#38bdf8', muted: 'rgba(248,250,252,0.5)' },
  warm: { bg: '#1c1917', text: '#fafaf9', accent: '#f97316', muted: 'rgba(250,250,249,0.5)' },
  clean: { bg: '#ffffff', text: '#0f172a', accent: '#2563eb', muted: 'rgba(15,23,42,0.5)' },
  emerald: { bg: '#022c22', text: '#ecfdf5', accent: '#34d399', muted: 'rgba(236,253,245,0.5)' },
};

function baseStyles(palette) {
  return `
    <style>
      ${FONTS}
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: ${WIDTH}px;
        height: ${HEIGHT}px;
        background: ${palette.bg};
        color: ${palette.text};
        font-family: 'Inter', -apple-system, sans-serif;
        overflow: hidden;
        position: relative;
      }
      .container {
        width: 100%; height: 100%;
        padding: 60px 72px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        position: relative;
        z-index: 1;
      }
      .accent { color: ${palette.accent}; }
      .muted { color: ${palette.muted}; }
      .mono { font-family: 'JetBrains Mono', monospace; }
      .brand {
        position: absolute;
        bottom: 24px;
        left: 72px;
        font-size: 14px;
        font-weight: 500;
        color: ${palette.muted};
        letter-spacing: 0.5px;
      }
      .brand-dot {
        display: inline-block;
        width: 6px; height: 6px;
        background: ${palette.accent};
        border-radius: 50%;
        margin-right: 8px;
        vertical-align: middle;
      }
    </style>
  `;
}

// ── Banner Designs ───────────────────────────────────────────────────────

const BANNERS = {

  // POST3: "LinkedIn has no scheduling API"
  // Style: Bold statement + code snippet
  post3: () => {
    const p = PALETTE.dark;
    return `<!DOCTYPE html><html><head>${baseStyles(p)}
      <style>
        .big-text {
          font-size: 52px;
          font-weight: 900;
          line-height: 1.1;
          letter-spacing: -1.5px;
          margin-bottom: 32px;
        }
        .code-block {
          background: rgba(255,255,255,0.06);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 12px;
          padding: 20px 28px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 15px;
          line-height: 1.7;
          color: rgba(255,255,255,0.75);
          max-width: 520px;
        }
        .code-block .keyword { color: #c084fc; }
        .code-block .fn { color: #38bdf8; }
        .code-block .str { color: #4ade80; }
        .code-block .comment { color: rgba(255,255,255,0.3); }
        .zero {
          position: absolute;
          right: 72px;
          top: 50%;
          transform: translateY(-50%);
          font-size: 280px;
          font-weight: 900;
          color: rgba(255,255,255,0.03);
          font-family: 'Inter', sans-serif;
          letter-spacing: -15px;
          line-height: 1;
        }
        .tag {
          display: inline-block;
          background: rgba(59,130,246,0.15);
          color: #60a5fa;
          font-size: 12px;
          font-weight: 600;
          padding: 5px 12px;
          border-radius: 6px;
          letter-spacing: 1px;
          text-transform: uppercase;
          margin-bottom: 20px;
          width: fit-content;
        }
      </style>
    </head><body>
      <div class="zero">API</div>
      <div class="container">
        <div class="tag">How it actually works</div>
        <div class="big-text">LinkedIn has <span class="accent">zero</span><br>scheduling API.</div>
        <div class="code-block">
          <span class="keyword">setInterval</span>(<span class="fn">checkAndPublish</span>, <span class="str">60_000</span>);<br>
          <span class="comment">// That's it. No cron. No cloud. No SaaS.</span>
        </div>
      </div>
      <div class="brand"><span class="brand-dot"></span>Bartosz Gaca</div>
    </body></html>`;
  },

  // POST4: "9 LinkedIn algorithm rules"
  // Style: Clean numbered list, data-driven
  post4: () => {
    const p = PALETTE.navy;
    return `<!DOCTYPE html><html><head>${baseStyles(p)}
      <style>
        .big-text {
          font-size: 46px;
          font-weight: 900;
          line-height: 1.1;
          letter-spacing: -1px;
          margin-bottom: 36px;
        }
        .rules {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px 24px;
          max-width: 900px;
        }
        .rule {
          display: flex;
          align-items: baseline;
          gap: 10px;
          font-size: 15px;
          font-weight: 500;
          color: rgba(248,250,252,0.7);
        }
        .rule-num {
          font-family: 'JetBrains Mono', monospace;
          font-size: 13px;
          font-weight: 700;
          color: ${p.accent};
          min-width: 22px;
        }
        .highlight { color: ${p.text}; font-weight: 700; }
        .num-big {
          position: absolute;
          right: 60px;
          top: 40px;
          font-size: 160px;
          font-weight: 900;
          color: rgba(56,189,248,0.06);
          font-family: 'Inter', sans-serif;
          line-height: 1;
        }
      </style>
    </head><body>
      <div class="num-big">9</div>
      <div class="container">
        <div class="big-text">Algorithm rules most<br>creators <span class="accent">ignore</span>.</div>
        <div class="rules">
          <div class="rule"><span class="rule-num">01</span> <span class="highlight">Dwell time</span> > likes</div>
          <div class="rule"><span class="rule-num">02</span> First 90 min = critical</div>
          <div class="rule"><span class="rule-num">03</span> Comments > shares</div>
          <div class="rule"><span class="rule-num">04</span> Link in post = −40%</div>
          <div class="rule"><span class="rule-num">05</span> 1300−1600 chars sweet spot</div>
          <div class="rule"><span class="rule-num">06</span> Max 3 hashtags</div>
          <div class="rule"><span class="rule-num">07</span> First 210 chars = hook</div>
          <div class="rule"><span class="rule-num">08</span> Reply in <span class="highlight">golden hour</span></div>
          <div class="rule"><span class="rule-num">09</span> Post → comment → engage</div>
        </div>
      </div>
      <div class="brand"><span class="brand-dot"></span>Bartosz Gaca</div>
    </body></html>`;
  },

  // POST5: "This post published itself"
  // Style: Terminal / console aesthetic
  post5: () => {
    const p = PALETTE.dark;
    return `<!DOCTYPE html><html><head>${baseStyles(p)}
      <style>
        .terminal {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 0;
          max-width: 680px;
          overflow: hidden;
        }
        .terminal-bar {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 16px;
          background: rgba(255,255,255,0.04);
          border-bottom: 1px solid rgba(255,255,255,0.06);
        }
        .terminal-dot {
          width: 12px; height: 12px;
          border-radius: 50%;
        }
        .dot-red { background: #ef4444; }
        .dot-yellow { background: #eab308; }
        .dot-green { background: #22c55e; }
        .terminal-title {
          font-size: 12px;
          color: rgba(255,255,255,0.4);
          margin-left: 8px;
          font-family: 'JetBrains Mono', monospace;
        }
        .terminal-body {
          padding: 20px 24px;
          font-family: 'JetBrains Mono', monospace;
          font-size: 14px;
          line-height: 1.8;
          color: rgba(255,255,255,0.7);
        }
        .terminal-body .green { color: #4ade80; }
        .terminal-body .blue { color: #38bdf8; }
        .terminal-body .dim { color: rgba(255,255,255,0.3); }
        .big-text {
          font-size: 48px;
          font-weight: 900;
          line-height: 1.1;
          letter-spacing: -1.5px;
          margin-bottom: 28px;
        }
        .sub { font-size: 17px; color: rgba(255,255,255,0.5); margin-bottom: 28px; font-weight: 400; }
      </style>
    </head><body>
      <div class="container">
        <div class="big-text">This post published<br><span class="accent">itself</span>.</div>
        <div class="terminal">
          <div class="terminal-bar">
            <div class="terminal-dot dot-red"></div>
            <div class="terminal-dot dot-yellow"></div>
            <div class="terminal-dot dot-green"></div>
            <span class="terminal-title">auto-publish.mjs</span>
          </div>
          <div class="terminal-body">
            <span class="dim">[09:30:01]</span> <span class="green">✓</span> Post scheduled for 09:30 CET<br>
            <span class="dim">[09:30:02]</span> <span class="green">✓</span> Publishing via LinkedIn API...<br>
            <span class="dim">[09:30:03]</span> <span class="green">✓</span> <span class="blue">urn:li:share:743...</span> created<br>
            <span class="dim">[09:45:18]</span> <span class="green">✓</span> Auto-comment posted
          </div>
        </div>
      </div>
      <div class="brand"><span class="brand-dot"></span>Bartosz Gaca</div>
    </body></html>`;
  },

  // POST6: "Co to jest MCP" (Polish)
  // Style: Clean explainer with diagram-like boxes
  post6: () => {
    const p = PALETTE.emerald;
    return `<!DOCTYPE html><html><head>${baseStyles(p)}
      <style>
        .big-text {
          font-size: 50px;
          font-weight: 900;
          line-height: 1.1;
          letter-spacing: -1.5px;
          margin-bottom: 36px;
        }
        .flow {
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .flow-box {
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.12);
          border-radius: 10px;
          padding: 16px 22px;
          font-size: 15px;
          font-weight: 600;
          text-align: center;
          min-width: 130px;
        }
        .flow-arrow {
          font-size: 22px;
          color: ${p.accent};
          font-weight: 300;
        }
        .flow-box.highlight-box {
          background: rgba(52,211,153,0.15);
          border-color: rgba(52,211,153,0.3);
        }
        .sub {
          font-size: 17px;
          color: ${p.muted};
          margin-top: 24px;
          font-weight: 400;
          line-height: 1.5;
        }
        .tag {
          display: inline-block;
          background: rgba(52,211,153,0.15);
          color: #6ee7b7;
          font-size: 13px;
          font-weight: 600;
          padding: 6px 14px;
          border-radius: 100px;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          margin-bottom: 20px;
        }
      </style>
    </head><body>
      <div class="container">
        <div class="tag">MCP explained</div>
        <div class="big-text">AI + Twoje narzędzia<br>= <span class="accent">MCP</span></div>
        <div class="flow">
          <div class="flow-box">Claude / GPT</div>
          <div class="flow-arrow">→</div>
          <div class="flow-box highlight-box">MCP Server</div>
          <div class="flow-arrow">→</div>
          <div class="flow-box">LinkedIn API</div>
        </div>
        <div class="sub">stdio + JSON-RPC 2.0 — zero network latency, full control</div>
      </div>
      <div class="brand"><span class="brand-dot"></span>Bartosz Gaca</div>
    </body></html>`;
  },

  // POST7: "5 rules every LinkedIn post should follow"
  // Style: Bold text, clean minimal
  post7: () => {
    const p = PALETTE.clean;
    return `<!DOCTYPE html><html><head>${baseStyles(p)}
      <style>
        .big-text {
          font-size: 52px;
          font-weight: 900;
          line-height: 1.1;
          letter-spacing: -2px;
          margin-bottom: 40px;
        }
        .rules-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
          max-width: 700px;
        }
        .rule-item {
          display: flex;
          align-items: center;
          gap: 16px;
          font-size: 18px;
          font-weight: 600;
          color: rgba(15,23,42,0.7);
        }
        .rule-bar {
          width: 3px;
          height: 24px;
          background: ${p.accent};
          border-radius: 2px;
          flex-shrink: 0;
        }
        .rule-item strong { color: ${p.text}; }
        .bg-number {
          position: absolute;
          right: 40px;
          bottom: 20px;
          font-size: 320px;
          font-weight: 900;
          color: rgba(37,99,235,0.04);
          line-height: 1;
        }
      </style>
    </head><body>
      <div class="bg-number">5</div>
      <div class="container">
        <div class="big-text">Post rules that<br>actually <span class="accent">work</span>.</div>
        <div class="rules-list">
          <div class="rule-item"><div class="rule-bar"></div><strong>Hook</strong> in first 210 characters</div>
          <div class="rule-item"><div class="rule-bar"></div><strong>1300–1600</strong> chars for max dwell time</div>
          <div class="rule-item"><div class="rule-bar"></div><strong>Zero links</strong> in body — link in comment</div>
          <div class="rule-item"><div class="rule-bar"></div><strong>CTA question</strong> as last line</div>
          <div class="rule-item"><div class="rule-bar"></div><strong>Max 3</strong> hashtags at the end</div>
        </div>
      </div>
      <div class="brand"><span class="brand-dot"></span>Bartosz Gaca</div>
    </body></html>`;
  },

  // POST8: "5 lessons from AI-assisted development"
  // Style: Dark, developer-focused
  post8: () => {
    const p = PALETTE.warm;
    return `<!DOCTYPE html><html><head>${baseStyles(p)}
      <style>
        .big-text {
          font-size: 48px;
          font-weight: 900;
          line-height: 1.1;
          letter-spacing: -1.5px;
          margin-bottom: 12px;
        }
        .sub {
          font-size: 18px;
          color: ${p.muted};
          margin-bottom: 32px;
          font-weight: 400;
        }
        .stats-row {
          display: flex;
          gap: 48px;
        }
        .stat-item {
          display: flex;
          flex-direction: column;
        }
        .stat-value {
          font-size: 56px;
          font-weight: 900;
          color: ${p.accent};
          font-family: 'JetBrains Mono', monospace;
          line-height: 1;
        }
        .stat-label {
          font-size: 14px;
          color: ${p.muted};
          text-transform: uppercase;
          letter-spacing: 1px;
          margin-top: 8px;
        }
        .divider {
          width: 60px;
          height: 3px;
          background: ${p.accent};
          border-radius: 2px;
          margin: 24px 0;
          opacity: 0.4;
        }
      </style>
    </head><body>
      <div class="container">
        <div class="big-text">29 tools in 48 hours.</div>
        <div class="sub">5 lessons from building with AI.</div>
        <div class="divider"></div>
        <div class="stats-row">
          <div class="stat-item">
            <div class="stat-value">48h</div>
            <div class="stat-label">build time</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">70%</div>
            <div class="stat-label">AI-written code</div>
          </div>
          <div class="stat-item">
            <div class="stat-value">100%</div>
            <div class="stat-label">human architecture</div>
          </div>
        </div>
      </div>
      <div class="brand"><span class="brand-dot"></span>Bartosz Gaca</div>
    </body></html>`;
  },

};

// ── Renderer ─────────────────────────────────────────────────────────────

async function renderBanner(name, htmlFn) {
  const html = htmlFn();
  const outPath = join(OUT_DIR, `${name}-banner.png`);

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: outPath, type: 'png' });
  await browser.close();

  const { statSync } = await import('fs');
  const size = (statSync(outPath).size / 1024).toFixed(0);
  console.log(`  ✓ ${outPath} (${size} KB)`);
  return outPath;
}

// ── Main ─────────────────────────────────────────────────────────────────

const target = process.argv[2] || 'post3';

if (target === 'all') {
  console.log('Generating all banners v2...\n');
  for (const [name, fn] of Object.entries(BANNERS)) {
    await renderBanner(name, fn);
  }
} else if (BANNERS[target]) {
  console.log(`Generating ${target} banner v2...\n`);
  await renderBanner(target, BANNERS[target]);
} else {
  console.log(`Unknown target: ${target}`);
  console.log(`Available: ${Object.keys(BANNERS).join(', ')}, all`);
  process.exit(1);
}

console.log('\nDone!');
