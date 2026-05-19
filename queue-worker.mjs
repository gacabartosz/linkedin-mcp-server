#!/usr/bin/env node
// queue-worker.mjs — every 15s, drain ~/.linkedin-mcp/queue/*.json
// (intents pulled from VPS by pull-from-vps.sh), execute via local
// linkedin-mcp scripts, write result to queue/done/<id>.json.
// Result is then pushed back to VPS by sync-to-vps.sh.

import { readFileSync, writeFileSync, readdirSync, renameSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';

const DATA_DIR = process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp');
const QUEUE = join(DATA_DIR, 'queue');
const DONE = join(QUEUE, 'done');
const PROCESSING = join(QUEUE, '.processing');
const MCP_DIR = process.env.LINKEDIN_MCP_DIR || '/Users/gaca/projects/personal/linkedin-mcp-server';

if (!existsSync(QUEUE)) mkdirSync(QUEUE, { recursive: true, mode: 0o770 });
if (!existsSync(DONE)) mkdirSync(DONE, { recursive: true, mode: 0o770 });
if (!existsSync(PROCESSING)) mkdirSync(PROCESSING, { recursive: true, mode: 0o770 });

const db = () => new Database(join(DATA_DIR, 'scheduler.db'), { readonly: false });

function writeDone(id, result, error = null) {
  const payload = { id, completed_at: new Date().toISOString(), ...(error ? { error: error.message || String(error) } : { result }) };
  const tmp = join(DONE, `.${id}.tmp`);
  const fin = join(DONE, `${id}.json`);
  writeFileSync(tmp, JSON.stringify(payload), { mode: 0o660 });
  renameSync(tmp, fin);
}

function execAction(intent) {
  const { action, payload } = intent;
  switch (action) {
    case 'cancel_post': {
      if (!payload.id) throw new Error('payload.id required');
      const d = db();
      try {
        const info = d.prepare('UPDATE scheduled_posts SET status=?, updated_at=datetime(?) WHERE id=?')
          .run('cancelled', new Date().toISOString(), payload.id);
        return { changed: info.changes, action, id: payload.id };
      } finally { d.close(); }
    }
    case 'reschedule_post': {
      if (!payload.id || !payload.publish_at) throw new Error('payload.id and payload.publish_at required');
      const d = db();
      try {
        const info = d.prepare('UPDATE scheduled_posts SET publish_at=?, status=?, updated_at=datetime(?) WHERE id=?')
          .run(payload.publish_at, 'scheduled', new Date().toISOString(), payload.id);
        return { changed: info.changes, action, id: payload.id, publish_at: payload.publish_at };
      } finally { d.close(); }
    }
    case 'update_post': {
      if (!payload.id || !payload.text) throw new Error('payload.id and payload.text required');
      const d = db();
      try {
        const info = d.prepare('UPDATE scheduled_posts SET text=?, updated_at=datetime(?) WHERE id=?')
          .run(payload.text, new Date().toISOString(), payload.id);
        return { changed: info.changes, action, id: payload.id };
      } finally { d.close(); }
    }
    case 'create_post': {
      if (!payload.text || !payload.publish_at) throw new Error('payload.text and payload.publish_at required');
      const d = db();
      try {
        const id = payload.id || crypto.randomUUID();
        d.prepare(`INSERT INTO scheduled_posts (id, text, publish_at, status, language, created_at, updated_at)
                   VALUES (?, ?, ?, 'scheduled', ?, datetime(?), datetime(?))`)
          .run(id, payload.text, payload.publish_at, payload.language || 'pl', new Date().toISOString(), new Date().toISOString());
        return { action, id, publish_at: payload.publish_at };
      } finally { d.close(); }
    }
    case 'regenerate_plan': {
      const r = spawnSync('node', [join(MCP_DIR, 'scripts/seed-media-plan.mjs')], {
        env: { ...process.env, LINKEDIN_DATA_DIR: DATA_DIR },
        cwd: MCP_DIR,
      });
      if (r.status !== 0) throw new Error(`seed-media-plan exit ${r.status}: ${r.stderr?.toString().slice(0, 500)}`);
      return { action, stdout: r.stdout?.toString().slice(0, 500) };
    }
    case 'publish_now': {
      if (!payload.id) throw new Error('payload.id required');
      const d = db();
      try {
        const info = d.prepare("UPDATE scheduled_posts SET publish_at=datetime('now'), status='scheduled', updated_at=datetime(?) WHERE id=?")
          .run(new Date().toISOString(), payload.id);
        return { changed: info.changes, action, id: payload.id, note: 'auto-publish daemon will pick it up within 60s' };
      } finally { d.close(); }
    }
    default:
      throw new Error(`unknown action: ${action}`);
  }
}

function tick() {
  let files;
  try {
    files = readdirSync(QUEUE).filter(f => f.endsWith('.json') && !f.startsWith('.'));
  } catch { return; }

  for (const f of files) {
    const src = join(QUEUE, f);
    const proc = join(PROCESSING, f);
    let intent;
    try {
      // Atomic claim — first worker to rename wins.
      renameSync(src, proc);
      intent = JSON.parse(readFileSync(proc, 'utf-8'));
    } catch (e) {
      // Another worker grabbed it, or file disappeared mid-pull.
      continue;
    }
    try {
      const result = execAction(intent);
      writeDone(intent.id, result);
      console.log(`[${new Date().toISOString()}] ok ${intent.action} ${intent.id}`);
    } catch (e) {
      writeDone(intent.id, null, e);
      console.error(`[${new Date().toISOString()}] err ${intent.action} ${intent.id}: ${e.message}`);
    } finally {
      try { unlinkSync(proc); } catch {}
    }
  }
}

console.log(`[queue-worker] started, polling ${QUEUE} every 15s`);
tick();
setInterval(tick, 15_000);
