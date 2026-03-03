#!/usr/bin/env node
/**
 * LinkedIn Auto-Engage Daemon
 *
 * Runs alongside auto-publish.mjs to:
 * 1. Monitor comments on published posts
 * 2. Auto-LIKE all new comments (shows appreciation)
 * 3. Auto-reply to comments with a thank you + context-aware response
 * 4. Track which comments were already processed
 *
 * Usage: node auto-engage.mjs
 *
 * The daemon checks every 5 minutes for new comments on published posts.
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const AUTH_PATH = join(homedir(), '.linkedin-mcp', 'auth.json');
const MCP_DIR = '/Users/gaca/projects/personal/linkedin-mcp-server';
const ENGAGE_DB_PATH = join(homedir(), '.linkedin-mcp', 'engage.db');
const PERSON_URN = 'urn:li:person:FihAwG4y_B';

const CHECK_INTERVAL = 5 * 60 * 1000; // 5 minutes

// ── Engagement database ─────────────────────────────────────────────────────

function initEngageDB() {
  const db = new Database(ENGAGE_DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_comments (
      comment_urn TEXT PRIMARY KEY,
      post_urn TEXT NOT NULL,
      action TEXT NOT NULL,
      processed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS engagement_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_urn TEXT NOT NULL,
      comment_urn TEXT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );
  `);
  db.close();
}

function isProcessed(commentUrn) {
  const db = new Database(ENGAGE_DB_PATH, { readonly: true });
  const row = db.prepare('SELECT 1 FROM processed_comments WHERE comment_urn = ?').get(commentUrn);
  db.close();
  return !!row;
}

function markProcessed(commentUrn, postUrn, action) {
  const db = new Database(ENGAGE_DB_PATH);
  db.prepare('INSERT OR IGNORE INTO processed_comments (comment_urn, post_urn, action, processed_at) VALUES (?, ?, ?, ?)')
    .run(commentUrn, postUrn, action, new Date().toISOString());
  db.prepare('INSERT INTO engagement_log (post_urn, comment_urn, action, created_at) VALUES (?, ?, ?, ?)')
    .run(postUrn, commentUrn, action, new Date().toISOString());
  db.close();
}

function logEngagement(postUrn, action, details) {
  const db = new Database(ENGAGE_DB_PATH);
  db.prepare('INSERT INTO engagement_log (post_urn, action, details, created_at) VALUES (?, ?, ?, ?)')
    .run(postUrn, action, details, new Date().toISOString());
  db.close();
}

// ── MCP caller ──────────────────────────────────────────────────────────────

async function callMCP(toolName, args) {
  return new Promise((resolve, reject) => {
    const msgs = [
      JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'auto-engage',version:'1.0'}}}),
      JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:toolName,arguments:args}}),
    ].join('\n');

    const proc = spawn('node', ['dist/index.js'], {
      cwd: MCP_DIR,
      env: { ...process.env, LINKEDIN_PERSON_URN: PERSON_URN },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let resolved = false;

    proc.stdout.on('data', d => {
      out += d.toString();
      for (const line of out.split('\n')) {
        try {
          const msg = JSON.parse(line.trim());
          if (msg.id === 2 && !resolved) {
            resolved = true;
            proc.kill();
            if (msg.result?.isError) {
              reject(new Error(msg.result.content?.[0]?.text || 'MCP tool error'));
              return;
            }
            const text = msg.result?.content?.[0]?.text || '{}';
            try {
              resolve(JSON.parse(text));
            } catch {
              resolve({ raw: text });
            }
            return;
          }
        } catch {}
      }
    });

    proc.stderr.on('data', d => process.stderr.write(d));

    proc.on('close', () => {
      if (!resolved) {
        reject(new Error('No response from MCP'));
      }
    });

    proc.stdin.write(msgs);
    proc.stdin.end();

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        reject(new Error('Timeout'));
      }
    }, 90000);
  });
}

// ── Thank you replies (context-aware) ───────────────────────────────────────

const THANK_YOU_REPLIES = [
  "Thank you for the comment! Appreciate the engagement.",
  "Thanks! Glad this resonated with you.",
  "Appreciate you taking the time to comment!",
  "Thank you! Feel free to check out the GitHub repo in the comment above.",
  "Thanks for sharing your thoughts!",
];

const THANK_YOU_REPLIES_PL = [
  "Dziekuje za komentarz!",
  "Dziekuje! Ciesze sie, ze to przydatne.",
  "Dziekuje za zainteresowanie! Link do GitHuba w komentarzu powyzej.",
];

function getThankYouReply(postText) {
  const isPL = /[ąćęłńóśźż]/i.test(postText) ||
    postText.includes('Opublikowalem') ||
    postText.includes('Wklejasz') ||
    postText.includes('najwazniejsza zmiana');

  const replies = isPL ? THANK_YOU_REPLIES_PL : THANK_YOU_REPLIES;
  return replies[Math.floor(Math.random() * replies.length)];
}

// ── Main engagement loop ────────────────────────────────────────────────────

async function checkAndEngage() {
  const now = new Date();
  console.log(`[${now.toISOString()}] Checking for new comments...`);

  try {
    // Get published posts from scheduler DB
    const db = new Database(DB_PATH, { readonly: true });
    const posts = db.prepare(
      "SELECT id, text, post_urn, published_at FROM scheduled_posts WHERE status = 'published' AND post_urn IS NOT NULL ORDER BY published_at DESC LIMIT 10"
    ).all();
    db.close();

    // Filter out posts with empty URNs
    const validPosts = posts.filter(p => p.post_urn && p.post_urn.length > 10);

    if (validPosts.length === 0) {
      console.log('  No published posts with valid URNs to monitor.');
      return;
    }

    console.log(`  Monitoring ${validPosts.length} published posts...`);

    for (const post of validPosts) {
      try {
        // Get comments on this post
        const result = await callMCP('linkedin_comments_list', {
          post_urn: post.post_urn,
          count: 20,
        });

        const comments = result.comments || [];
        if (comments.length === 0) continue;

        console.log(`  Post ${post.post_urn}: ${comments.length} comments`);

        for (const comment of comments) {
          const commentUrn = comment['$URN'] || comment.urn || comment.id;
          if (!commentUrn) continue;

          // Skip own comments
          const actor = comment.actor || '';
          if (actor === PERSON_URN || (typeof actor === 'object' && actor?.['~'] === PERSON_URN)) {
            continue;
          }

          // Skip already processed
          if (isProcessed(commentUrn)) continue;

          const commentText = comment.message?.text || comment.text || '';
          console.log(`    New comment: "${commentText.substring(0, 60)}..." by ${actor}`);

          // Action 1: Auto-LIKE the comment
          try {
            await callMCP('linkedin_reaction_add', {
              entity_urn: commentUrn,
              reaction_type: 'LIKE',
            });
            console.log(`    -> Liked`);
          } catch (err) {
            console.error(`    -> Like failed: ${err.message}`);
          }

          // Action 2: Auto-reply (only for genuine comments, not spam)
          const isGenuine = commentText.length > 5 && !commentText.match(/^(👍|🔥|💪|👏|❤️|🙌)+$/);
          if (isGenuine) {
            try {
              const reply = getThankYouReply(post.text);
              await callMCP('linkedin_comment_create', {
                post_urn: post.post_urn,
                text: reply,
                parent_comment_urn: commentUrn,
              });
              console.log(`    -> Replied: "${reply}"`);
            } catch (err) {
              console.error(`    -> Reply failed: ${err.message}`);
            }
          }

          markProcessed(commentUrn, post.post_urn, 'liked+replied');
        }
      } catch (err) {
        console.error(`  Error checking post ${post.post_urn}: ${err.message}`);
      }
    }
  } catch (err) {
    console.error('Engage error:', err.message);
  }
}

// ── Stats ───────────────────────────────────────────────────────────────────

function printStats() {
  try {
    const db = new Database(ENGAGE_DB_PATH, { readonly: true });
    const total = db.prepare('SELECT COUNT(*) as c FROM processed_comments').get();
    const today = db.prepare("SELECT COUNT(*) as c FROM processed_comments WHERE processed_at >= date('now')").get();
    db.close();
    console.log(`Stats: ${total.c} total comments processed (${today.c} today)`);
  } catch {}
}

// ── Start ───────────────────────────────────────────────────────────────────

console.log('LinkedIn Auto-Engage v1.0 started');
console.log('Features: auto-like comments, auto-reply, engagement tracking');
console.log(`Checking every ${CHECK_INTERVAL / 60000} minutes...`);
console.log('');

initEngageDB();
printStats();
checkAndEngage();
setInterval(checkAndEngage, CHECK_INTERVAL);
