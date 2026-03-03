#!/usr/bin/env node
/**
 * LinkedIn Auto-Publisher with Auto-Comments & Image Upload
 *
 * Runs as a standalone daemon that:
 * 1. Monitors scheduled posts in SQLite
 * 2. Uploads images from local paths before publishing
 * 3. Publishes them at the right time via MCP
 * 4. Adds a GitHub link comment 15 minutes after each post
 *
 * Usage: node auto-publish.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const AUTH_PATH = join(homedir(), '.linkedin-mcp', 'auth.json');
const MCP_DIR = '/Users/gaca/projects/personal/linkedin-mcp-server';
const IMG_DIR = '/Users/gaca/output/personal/linkedin-mcp';

// ── Per-post auto-comments with GitHub link ───────────────────────────────────

const AUTO_COMMENTS = {
  // Week 1
  'post3': 'Try it yourself: https://github.com/gacabartosz/linkedin-mcp-server — schedule posts, generate AI images, and let Claude handle your LinkedIn content. Open source, MIT licensed.',
  'post4': 'Source code: https://github.com/gacabartosz/linkedin-mcp-server — the only open-source LinkedIn MCP with write operations, scheduling, AI images, and algorithm intelligence. Built with Claude Code + Ralph.',
  // Week 2
  'post5': 'Full source code: https://github.com/gacabartosz/linkedin-mcp-server — 25 MCP tools, SQLite scheduler, auto-comments, 12 templates. This post was scheduled and published automatically. MIT licensed.',
  'post6': 'Kod zrodlowy: https://github.com/gacabartosz/linkedin-mcp-server — 25 narzedzi MCP, harmonogram, auto-komentarze, szablony. Zainstaluj i uzyj z Claude Code lub Claude Desktop.',
  'post7': 'All 12 templates included: https://github.com/gacabartosz/linkedin-mcp-server — open source, MIT. Install and use with any MCP-compatible AI assistant.',
  'post8': 'Every commit visible: https://github.com/gacabartosz/linkedin-mcp-server — from zero to 25 working LinkedIn tools in 48h. Open source, MIT licensed.',
  // Week 3
  'post9': 'Kod zrodlowy MCP do LinkedIn: https://github.com/gacabartosz/linkedin-mcp-server — jedyny open-source z operacjami zapisu. 25 narzedzi, harmonogram, szablony. MIT license.',
  'post10': 'Algorithm rules + 25 tools: https://github.com/gacabartosz/linkedin-mcp-server — built-in guidelines, templates, and auto-publish. Open source.',
  'post11': 'My full stack is open source: https://github.com/gacabartosz/linkedin-mcp-server — LinkedIn MCP with scheduling, templates, algorithm intelligence. Build your own AI content pipeline.',
  'post12': 'Full source code + 3 weeks of real data: https://github.com/gacabartosz/linkedin-mcp-server — the open-source LinkedIn MCP that powers this entire content series.',
  'default': 'Full source code: https://github.com/gacabartosz/linkedin-mcp-server — 25 MCP tools, 12 templates, built-in algorithm guidelines. Open source, MIT licensed.',
};

// Map post text snippets → post keys for comment lookup
const POST_IDENTIFIERS = {
  'This post published itself': 'post5',
  'Opublikowalem jedyny open-source MCP server': 'post6',
  'Write a thought leadership post about AI automation': 'post7',
  '48 hours. 25 MCP tools': 'post8',
  'MCP (Model Context Protocol) to najwazniejsza zmiana': 'post9',
  'read about the LinkedIn algorithm. I coded it': 'post10',
  'content management stack as a solo founder': 'post11',
  '3 weeks ago I published my first post': 'post12',
  'Schedule a thought leadership post for Thursday': 'post3',
  'most powerful signal on LinkedIn': 'post4',
};

// Map post keys → image file paths
const POST_IMAGES = {
  'post5': join(IMG_DIR, 'post5-banner.png'),
  'post6': join(IMG_DIR, 'post6-github.png'),
  'post7': join(IMG_DIR, 'post7-banner.png'),
  'post8': join(IMG_DIR, 'post8-banner.png'),
  'post9': join(IMG_DIR, 'post9-banner.png'),
  'post10': join(IMG_DIR, 'post10-banner.png'),
  'post11': join(IMG_DIR, 'post11-banner.png'),
  'post12': join(IMG_DIR, 'post12-banner.png'),
};

function identifyPost(text) {
  for (const [snippet, key] of Object.entries(POST_IDENTIFIERS)) {
    if (text.includes(snippet)) return key;
  }
  return null;
}

function getAuth() {
  if (!existsSync(AUTH_PATH)) throw new Error('No auth.json');
  return JSON.parse(readFileSync(AUTH_PATH, 'utf-8'));
}

async function callMCP(toolName, args) {
  return new Promise((resolve, reject) => {
    const msgs = [
      JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'auto-pub',version:'1.0'}}}),
      JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:toolName,arguments:args}}),
    ].join('\n');

    const proc = spawn('node', ['dist/index.js'], {
      cwd: MCP_DIR,
      env: { ...process.env, LINKEDIN_PERSON_URN: 'urn:li:person:FihAwG4y_B' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let out = '';
    let resolved = false;

    proc.stdout.on('data', d => {
      out += d.toString();
      // Parse response as it streams — don't wait for process close
      for (const line of out.split('\n')) {
        try {
          const msg = JSON.parse(line.trim());
          if (msg.id === 2 && msg.result && !resolved) {
            resolved = true;
            const text = msg.result.content?.[0]?.text || '{}';
            proc.kill();
            resolve(JSON.parse(text));
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

// Queue of pending comments
const commentQueue = [];

async function checkAndPublish() {
  const now = new Date();
  console.log(`[${now.toISOString()}] Checking...`);

  // Check scheduled posts
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const posts = db.prepare(
      "SELECT id, text, media_ids, publish_at, status FROM scheduled_posts WHERE status = 'scheduled' AND publish_at <= ?"
    ).all(now.toISOString());
    db.close();

    for (const post of posts) {
      console.log(`Publishing scheduled post ${post.id}...`);
      const postKey = identifyPost(post.text);
      console.log(`  Identified as: ${postKey || 'unknown'}`);

      try {
        // Upload image if available and no media_ids yet
        let mediaIds = post.media_ids ? JSON.parse(post.media_ids) : [];
        if (mediaIds.length === 0 && postKey && POST_IMAGES[postKey]) {
          const imgPath = POST_IMAGES[postKey];
          if (existsSync(imgPath)) {
            console.log(`  Uploading image: ${imgPath}`);
            try {
              const uploadResult = await callMCP('linkedin_media_upload', {
                file_path: imgPath,
                media_type: 'IMAGE',
              });
              if (uploadResult.media_urn) {
                mediaIds = [uploadResult.media_urn];
                console.log(`  Image uploaded: ${uploadResult.media_urn}`);
              }
            } catch (err) {
              console.error(`  Image upload failed: ${err.message} — publishing without image`);
            }
          }
        }

        // Create post (with or without image)
        const createArgs = { text: post.text };
        if (mediaIds.length > 0) {
          createArgs.media_ids = mediaIds;
        }

        const result = await callMCP('linkedin_post_create', createArgs);
        console.log(`  Published: ${result.post_urn}`);

        // Update DB
        const dbw = new Database(DB_PATH);
        dbw.prepare(
          "UPDATE scheduled_posts SET status = 'published', post_urn = ?, published_at = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(result.post_urn, new Date().toISOString(), post.id);
        dbw.close();

        // Queue auto-comment for 15 min later
        if (result.post_urn) {
          const commentText = postKey ? (AUTO_COMMENTS[postKey] || AUTO_COMMENTS.default) : AUTO_COMMENTS.default;
          commentQueue.push({
            post_urn: result.post_urn,
            comment_at: new Date(Date.now() + 15 * 60 * 1000),
            text: commentText,
          });
          console.log(`  Comment queued for 15 min later (${postKey || 'default'})`);
        }
      } catch (err) {
        console.error(`  Failed to publish ${post.id}:`, err.message);
        // Mark as failed after 3 retries
        const dbw = new Database(DB_PATH);
        const current = dbw.prepare("SELECT retry_count FROM scheduled_posts WHERE id = ?").get(post.id);
        const retries = (current?.retry_count || 0) + 1;
        if (retries >= 3) {
          dbw.prepare("UPDATE scheduled_posts SET status = 'failed', error = ?, retry_count = ?, updated_at = datetime('now') WHERE id = ?")
            .run(err.message, retries, post.id);
          console.error(`  Post ${post.id} marked as FAILED after ${retries} retries`);
        } else {
          dbw.prepare("UPDATE scheduled_posts SET retry_count = ?, updated_at = datetime('now') WHERE id = ?")
            .run(retries, post.id);
          console.log(`  Will retry (attempt ${retries}/3)`);
        }
        dbw.close();
      }
    }
  } catch (err) {
    console.error('DB error:', err.message);
  }

  // Check comment queue
  const readyComments = commentQueue.filter(c => new Date() >= c.comment_at);
  for (const c of readyComments) {
    console.log(`Adding comment to ${c.post_urn}...`);
    try {
      const result = await callMCP('linkedin_comment_create', {
        post_urn: c.post_urn,
        text: c.text,
      });
      console.log(`  Comment added: ${result.comment_urn}`);
      commentQueue.splice(commentQueue.indexOf(c), 1);
    } catch (err) {
      console.error(`  Comment failed for ${c.post_urn}:`, err.message);
      c.comment_at = new Date(Date.now() + 5 * 60 * 1000);
      console.log(`  Retrying in 5 min`);
    }
  }
}

console.log('LinkedIn Auto-Publisher v2 started');
console.log('Features: image upload, per-post comments, retry logic');
console.log('Checking every 60 seconds...');
console.log('');

// Run immediately, then every 60s
checkAndPublish();
setInterval(checkAndPublish, 60000);
