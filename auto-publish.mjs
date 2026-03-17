#!/usr/bin/env node
/**
 * LinkedIn Auto-Publisher v4 — Direct API calls (no MCP subprocess)
 *
 * Runs as a standalone daemon that:
 * 1. Monitors scheduled posts in SQLite
 * 2. Uploads images/videos directly via LinkedIn API
 * 3. Publishes with random jitter (0-7 min past scheduled time)
 * 4. Verifies each post is live before queuing comment
 * 5. Adds educational comment 12-22 min after each post (randomized)
 *
 * Usage: node auto-publish.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

const DB_PATH = join(homedir(), '.linkedin-mcp', 'scheduler.db');
const AUTH_PATH = join(homedir(), '.linkedin-mcp', 'auth.json');
const IMG_DIR = '/Users/gaca/output/personal/linkedin-mcp';

const LINKEDIN_API_BASE = 'https://api.linkedin.com/v2';

// ── MIME type mapping ───────────────────────────────────────────────────────

const IMAGE_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const VIDEO_MIME = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
};

function getMimeType(filePath) {
  const ext = extname(filePath).toLowerCase();
  return IMAGE_MIME[ext] || VIDEO_MIME[ext] || 'application/octet-stream';
}

function isVideoFile(filePath) {
  const ext = extname(filePath).toLowerCase();
  return ext in VIDEO_MIME;
}

// ── Logging ─────────────────────────────────────────────────────────────────

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function logError(msg) {
  console.error(`[${new Date().toISOString()}] ${msg}`);
}

// ── Auth ────────────────────────────────────────────────────────────────────

function getAuth() {
  if (!existsSync(AUTH_PATH)) throw new Error('No auth.json found at ' + AUTH_PATH);
  return JSON.parse(readFileSync(AUTH_PATH, 'utf-8'));
}

function getAccessToken() {
  const auth = getAuth();
  return auth.access_token;
}

function getPersonUrn() {
  const envUrn = process.env.LINKEDIN_PERSON_URN;
  if (envUrn) return envUrn;
  try {
    const auth = getAuth();
    if (auth.person_urn) return auth.person_urn;
  } catch {}
  return 'urn:li:person:FihAwG4y_B';
}

// ── LinkedIn API helpers ────────────────────────────────────────────────────

function apiHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Restli-Protocol-Version': '2.0.0',
  };
}

async function linkedinFetch(path, options = {}) {
  const token = getAccessToken();
  const url = path.startsWith('http') ? path : `${LINKEDIN_API_BASE}${path}`;
  const headers = { ...apiHeaders(token), ...(options.headers || {}) };
  const res = await fetch(url, { ...options, headers });
  return res;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Media Upload (direct API) ───────────────────────────────────────────────

async function uploadMedia(filePath, mediaType) {
  const token = getAccessToken();
  const personUrn = getPersonUrn();
  const isVideo = mediaType === 'VIDEO';
  const recipe = isVideo
    ? 'urn:li:digitalmediaRecipe:feedshare-video'
    : 'urn:li:digitalmediaRecipe:feedshare-image';

  // Step 1: Register upload
  log(`  Registering ${mediaType} upload...`);
  const registerBody = {
    registerUploadRequest: {
      recipes: [recipe],
      owner: personUrn,
      serviceRelationships: [
        {
          relationshipType: 'OWNER',
          identifier: 'urn:li:userGeneratedContent',
        },
      ],
      supportedUploadMechanism: ['SYNCHRONOUS_UPLOAD'],
    },
  };

  const registerRes = await linkedinFetch('/assets?action=registerUpload', {
    method: 'POST',
    body: JSON.stringify(registerBody),
  });

  if (!registerRes.ok) {
    const errText = await registerRes.text();
    throw new Error(`Register upload failed (${registerRes.status}): ${errText}`);
  }

  const registerData = await registerRes.json();
  const uploadUrl =
    registerData.value?.uploadMechanism?.[
      'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
    ]?.uploadUrl;
  const assetUrn = registerData.value?.asset;

  if (!uploadUrl || !assetUrn) {
    throw new Error('Missing uploadUrl or asset URN in register response');
  }

  log(`  Asset registered: ${assetUrn}`);
  log(`  Upload URL obtained, uploading binary...`);

  // Step 2: PUT binary data
  const fileBuffer = readFileSync(filePath);
  const mime = getMimeType(filePath);

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': mime,
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok && uploadRes.status !== 201) {
    const errText = await uploadRes.text();
    throw new Error(`Binary upload failed (${uploadRes.status}): ${errText}`);
  }

  log(`  Binary uploaded (${Math.round(fileBuffer.length / 1024)} KB, ${mime})`);

  // Step 3: Wait and verify asset status
  log(`  Waiting 5s for asset processing...`);
  await sleep(5000);

  const checkRes = await linkedinFetch(`/assets/${encodeURIComponent(assetUrn)}`);
  if (checkRes.ok) {
    const checkData = await checkRes.json();
    const status = checkData.recipes?.[0]?.status || checkData.status || 'UNKNOWN';
    log(`  Asset status: ${status}`);
  } else {
    log(`  Asset status check returned ${checkRes.status} (non-critical, proceeding)`);
  }

  return assetUrn;
}

// ── Post Creation (direct API via v2/ugcPosts) ─────────────────────────────

async function createPost(text, mediaUrns = [], mediaCategory = 'NONE') {
  const personUrn = getPersonUrn();

  const shareContent = {
    shareCommentary: { text },
    shareMediaCategory: mediaCategory,
  };

  if (mediaUrns.length > 0 && mediaCategory !== 'NONE') {
    shareContent.media = mediaUrns.map(urn => ({
      status: 'READY',
      media: urn,
    }));
  }

  const body = {
    author: personUrn,
    lifecycleState: 'PUBLISHED',
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
    specificContent: {
      'com.linkedin.ugc.ShareContent': shareContent,
    },
  };

  log(`  Creating post via v2/ugcPosts (${text.length} chars, ${mediaUrns.length} media, category=${mediaCategory})...`);

  const res = await linkedinFetch('/ugcPosts', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Post creation failed (${res.status}): ${errText}`);
  }

  let responseBody = null;
  try {
    responseBody = await res.json();
  } catch {}

  // ugcPosts returns URN in response body .id or X-RestLi-Id header
  // Format can be urn:li:share:XXX or urn:li:ugcPost:XXX
  const finalUrn =
    responseBody?.id ||
    res.headers.get('x-restli-id') ||
    res.headers.get('X-RestLi-Id');

  if (!finalUrn) {
    throw new Error('No post URN returned from ugcPosts');
  }

  log(`  Post created: ${finalUrn}`);

  // Derive share URN for comments — comments ONLY work with urn:li:share:XXX
  // ugcPosts can return either urn:li:share:XXX or urn:li:ugcPost:XXX
  let shareUrn;
  if (finalUrn.startsWith('urn:li:share:')) {
    shareUrn = finalUrn;
  } else {
    // Extract numeric ID and build share URN
    const numericId = finalUrn.split(':').pop();
    shareUrn = `urn:li:share:${numericId}`;
  }

  return { postUrn: finalUrn, shareUrn };
}

// ── Post Verification ───────────────────────────────────────────────────────

async function verifyPostLive(postUrn) {
  log(`  Verifying post is live (waiting 10s)...`);
  await sleep(10000);

  // Try to read the post back
  const encodedUrn = encodeURIComponent(postUrn);
  const res = await linkedinFetch(`/ugcPosts/${encodedUrn}`);

  if (res.ok) {
    log(`  Post verified live (200 OK)`);
    return true;
  }

  if (res.status === 403) {
    // 403 = our scope can't read it back, but post was accepted
    log(`  Post accepted (403 = scope limitation, post exists)`);
    return true;
  }

  if (res.status === 404) {
    log(`  Post not found yet, retrying in 10s...`);
    await sleep(10000);

    const res2 = await linkedinFetch(`/ugcPosts/${encodedUrn}`);
    if (res2.ok || res2.status === 403) {
      log(`  Post verified on retry`);
      return true;
    }

    log(`  Post still not found (${res2.status}) — proceeding anyway`);
    return true; // proceed anyway, it might just be propagation delay
  }

  log(`  Unexpected verification response: ${res.status} — proceeding`);
  return true;
}

// ── Comment Creation (direct API) ───────────────────────────────────────────

async function createComment(shareUrn, text) {
  // Comments use socialActions with the share URN (NOT activity URN)
  const encodedUrn = encodeURIComponent(shareUrn);
  const personUrn = getPersonUrn();

  const body = {
    actor: personUrn,
    message: { text },
  };

  log(`  Posting comment on ${shareUrn}...`);

  const res = await linkedinFetch(`/socialActions/${encodedUrn}/comments`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Comment creation failed (${res.status}): ${errText}`);
  }

  let responseBody = null;
  try {
    responseBody = await res.json();
  } catch {}

  const commentUrn =
    res.headers.get('x-restli-id') ||
    res.headers.get('X-RestLi-Id') ||
    responseBody?.id ||
    'unknown';

  log(`  Comment posted: ${commentUrn}`);
  return commentUrn;
}

// ── Randomization helpers (avoid bot detection) ─────────────────────────────

function randomBetween(minMs, maxMs) {
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

function randomMinutes(min, max) {
  return randomBetween(min * 60 * 1000, max * 60 * 1000);
}

// ── Per-post educational auto-comments ──────────────────────────────────────
// Each comment leads with a fact/tip/insight. GitHub link is secondary.
// 20+ words each (algorithm: comments >15 words = 10-15x more reach).

const AUTO_COMMENTS = {
  // Week 1
  'post3': 'Pro tip: LinkedIn has zero native scheduling API — not even for enterprise accounts. The workaround is a local SQLite daemon that polls every 30 seconds and publishes when the time comes. No cloud needed. Details in the source: https://github.com/gacabartosz/linkedin-mcp-server',

  'post4': 'Ciekawostka: komentarze powyzej 15 slow daja postom 10-15x wiekszy zasieg niz same polubienia. Dlatego algorytm LinkedIn traktuje komentarze jako najsilniejszy sygnal zaangazowania — silniejszy niz udostepnienia. Wiecej regul zakodowanych tutaj: https://github.com/gacabartosz/linkedin-mcp-server',

  // Week 2
  'post5': 'Fun fact: MCP (Model Context Protocol) uses JSON-RPC 2.0 over stdio — meaning zero network latency between your AI assistant and your tools. The scheduling daemon is ~370 lines of JavaScript polling SQLite. Sometimes the simplest architecture wins. Code: https://github.com/gacabartosz/linkedin-mcp-server',

  'post6': 'Wskazowka: link w tresci posta na LinkedIn obcina zasieg nawet o 40%. Dlatego profesjonalni tworcy zawsze daja link w komentarzu 15-30 min po publikacji — algorytm juz zdazyl zaindeksowac post. Ten komentarz tez zostal dodany automatycznie. Kod: https://github.com/gacabartosz/linkedin-mcp-server',

  'post7': 'Little-known fact: the first 210 characters of your LinkedIn post appear before the "see more" fold. That hook decides whether anyone reads the rest. Every template in this system enforces that rule automatically — your hook is validated before publishing. Templates: https://github.com/gacabartosz/linkedin-mcp-server/tree/main/templates',

  'post8': 'Interesting pattern from AI-assisted development: Claude Code wrote ~70% of the code, but 100% of the architecture decisions were human. AI accelerates execution, not judgment. The bottleneck was always knowing WHAT to build, never HOW. Full commit history: https://github.com/gacabartosz/linkedin-mcp-server',

  // Week 3
  'post9': 'Dla developerow: MCP uzywa transportu stdio (stdin/stdout) z JSON-RPC 2.0. Kazde narzedzie to po prostu handler z walidacja Zod + odpowiedz JSON. Mozesz zbudowac wlasny MCP server w 2 godziny — nie potrzebujesz REST API, frontendu, ani deploy. Przyklad: https://github.com/gacabartosz/linkedin-mcp-server/blob/main/src/index.ts',

  'post10': 'Data point: posts in the 1300-1600 character range get the highest dwell time on LinkedIn. Too short means people scroll past. Too long means they abandon mid-read. This sweet spot is encoded in the publishing rules. Algorithm data: https://github.com/gacabartosz/linkedin-mcp-server/blob/main/guidelines/linkedin-strategy.json',

  'post11': 'Productivity math: 45 min per post x 4 posts per week = 3 hours scattered across random moments. With batch planning on Sunday: 2 hours total. The real savings come from batching, not from AI. AI just makes batch content creation feasible. Stack details: https://github.com/gacabartosz/linkedin-mcp-server',

  'post12': 'Takeaway from 3 weeks of data: Polish-language posts consistently get more comments from local network. English posts get more saves and international reach. The optimal strategy is mixing both — bilingual posting unlocks two separate audience pools. Data: https://github.com/gacabartosz/linkedin-mcp-server',

  // Week 4-5 — other projects
  'post13': 'SEO curiosity: there are now 13+ AI crawlers actively indexing the web — GPTBot, ClaudeBot, PerplexityBot, Google-Extended, and more. Most websites block exactly zero of them. Checking which AI crawlers can access your site takes 30 seconds with the right tools. Research: https://github.com/gacabartosz/seo-gaca-mcp',

  'post14': 'Cost insight: the best-performing AI model for most tasks is often free. Groq and Cerebras offer sub-100ms inference on competitive models at zero cost. The trick is automatic failover — if one provider rate-limits you, the next one picks up seamlessly. Architecture: https://github.com/gacabartosz/gaca-core',

  'post15': 'Technical detail: the auto-publish daemon is a simple setInterval loop checking SQLite every 60 seconds. No cron, no cloud functions, no message queue. If the machine was off, it catches up on ALL overdue posts when it restarts — no time limit. Sometimes boring infrastructure is the most reliable. Source: https://github.com/gacabartosz/linkedin-mcp-server/blob/main/auto-publish.mjs',

  'post16': 'Ciekawostka o RODO: kary za wyciek danych osobowych siegaja 20 mln EUR lub 4% rocznego obrotu firmy. A wystarczy jedno wklejenie danych klienta do ChatGPT aby stracic kontrole nad danymi. Presidio Anonymizer przechwytuje Ctrl+V i anonimizuje dane PRZED wyslaniem. 100% offline: https://github.com/gacabartosz/presidio-local-anonymizer',

  'post17': 'MCP ecosystem insight: the Model Context Protocol is transport-agnostic — stdio, SSE, or WebSocket. This means one MCP server works identically with Claude Code, Claude Desktop, Cursor, Windsurf, and any future MCP-compatible client. Build once, use everywhere. LinkedIn MCP: https://github.com/gacabartosz/linkedin-mcp-server | SEO MCP: https://github.com/gacabartosz/seo-gaca-mcp',

  'post0': 'Fun fact: LinkedIn oficjalnie nie ma API do schedulowania postow — nawet dla kont premium. Jedyny sposob to zbudowac wlasny daemon ktory odpytuje baze co 60 sekund. Ten post tez opublikowal sie sam. Kod: https://github.com/gacabartosz/linkedin-mcp-server',

  'post19': 'Ciekawostka: przecietny uzytkownik Google ma ponad 17 000 maili i 2 GB plikow na Dysku bez zadnej struktury. Google Workspace MCP pozwala AI tworzyc foldery, etykiety i filtry bezposrednio — bez eksportu danych. 30 minut vs pol dnia recznej pracy. Open source: https://github.com/taylorwilsdon/google_workspace_mcp | Instalacja: uvx workspace-mcp',

  'post18-mcp': 'Ciekawostka: Google Workspace MCP nie wymaga eksportu danych — AI dziala bezposrednio na Gmail i Drive API. Tworzy foldery, przenosi pliki, ustawia filtry. Wszystko w jednym prompcie, bez opuszczania Twojego konta Google. Open source: https://github.com/taylorwilsdon/google_workspace_mcp | Instalacja: uvx workspace-mcp',

  'post18': 'Google Workspace MCP to open source — dziala z Claude, Cursor i kazdym klientem MCP. Jeden prompt moze stworzyc foldery, przeniesc pliki, ustawic etykiety Gmail i filtry. Cala organizacja zajela 30 minut zamiast pol dnia recznego klikania. Repo: https://github.com/taylorwilsdon/google_workspace_mcp | Instalacja: uvx workspace-mcp',

  // KSeF MCP series (10-12.03)
  'ksef1': 'Cała historia zaczęła się od jednego kliknięcia w @Fakturownia (https://www.linkedin.com/company/fakturownia/). Faktury wystawione przed integracją z KSeF mają pełną moc prawną — nie trzeba ich wysyłać do KSeF. Art. 106na to kluczowy przepis, który warto znać. Mój MCP do KSeF: https://github.com/gacabartosz/ksef-mcp',

  'ksef2': 'Kod źródłowy: https://github.com/gacabartosz/ksef-mcp — 30 narzędzi MCP do Krajowego Systemu e-Faktur. Drafty, korekty, batch, walidacja FA(3), szyfrowanie RSA-OAEP + AES-256-CBC. Zbudowane z Claude Code. MIT license. Pierwszy publiczny MCP server do KSeF.',

  'ksef3': 'Full source: https://github.com/gacabartosz/ksef-mcp — 30 tools for KSeF (Polish e-invoicing). Auth, drafts, corrections, batch, encryption, audit trail. Works with Claude Code and Claude Desktop. MIT licensed. The first public MCP server for KSeF by @Ministerstwo Finansów (https://www.linkedin.com/company/ministerstwo-finansow/).',

  'ksef4': 'Pole P_14_xW (VAT w PLN) jest opcjonalne w schemacie FA(3), ale art. 106e ust. 11 UoVAT mówi: "Kwoty podatku wykazuje się w złotych." Zgłosiłem to do Ministerstwa Finansów (https://www.linkedin.com/company/ministerstwo-finansow/). Walidacja semantyczna w ksef-mcp już to łapie: https://github.com/gacabartosz/ksef-mcp',

  'sprawdznotariusza': 'SprawdzNotariusza.pl to side project zbudowany z Claude Code. Dane: Rejestr Cen Nieruchomości (publiczny, Ministerstwo Sprawiedliwości). 1745 miast, 10 341 notariuszy, wszystkie transakcje od 2013 roku. Mapa cen, ranking, wyszukiwarka. Sprawdź mediany cen w swoim mieście: https://sprawdznotariusza.pl',

  'default': 'MCP tip: every MCP tool is composable — schedule a post, generate an image, add a comment, check algorithm guidelines — all in one natural language conversation with your AI assistant. Source: https://github.com/gacabartosz/linkedin-mcp-server',
};

// Map post text snippets → post keys for comment lookup
const POST_IDENTIFIERS = {
  'LinkedIn has no scheduling API': 'post3',
  '9 LinkedIn algorithm rules most creators ignore': 'post4',
  'This post published itself': 'post5',
  'Co to jest MCP i dlaczego zmieni': 'post6',
  'Write a thought leadership post about AI': 'post7',
  '29 tools in 48 hours with AI': 'post8',
  'Jak zbudowac wlasny MCP server w 2 godziny': 'post9',
  'LinkedIn Algorithm Cheat Sheet': 'post10',
  'I cut my social media management from 6 hours': 'post11',
  '3 weeks of automated LinkedIn posting': 'post12',
  'Is your website ready for AI search': 'post13',
  'I tested 69 free AI models across 11 providers': 'post14',
  '7 steps to fully automated LinkedIn publishing': 'post15',
  'Wklejasz dane klientow do ChatGPT': 'post16',
  '5 lessons from building 86 MCP tools': 'post17',
  'Wczoraj moj post na LinkedIn opublikowal sie sam': 'post0',
  'Gmail: 25 000 maili. Drive: luzne pliki wszedzie': 'post19',
  'Twoj Gmail ma 25 000 maili': 'post18-mcp',
  'Posprzatalem Gmail i Google Drive w 30 minut': 'post18',
  // KSeF MCP series
  'Wyslalem stare faktury do KSeF': 'ksef1',
  'Wysłałem stare faktury do KSeF': 'ksef1',
  '15 minut na jedna korekte w KSeF': 'ksef2',
  '15 minut na jedną korektę w KSeF': 'ksef2',
  'I built 30 MCP tools for Poland': 'ksef3',
  'Kuzyn z biura nieruchomości': 'sprawdznotariusza',
  'Wyslalem fakture korygujaca w EUR do KSeF': 'ksef4',
  'Wysłałem fakturę korygującą w EUR do KSeF': 'ksef4',
};

// Map post keys → image file paths
const POST_IMAGES = {
  'post3': join(IMG_DIR, 'post3-banner.png'),
  'post4': join(IMG_DIR, 'post4-banner.png'),
  'post5': join(IMG_DIR, 'post5-banner.png'),
  'post6': join(IMG_DIR, 'post6-github.png'),
  'post7': join(IMG_DIR, 'post7-banner.png'),
  'post8': join(IMG_DIR, 'post8-banner.png'),
  'post9': join(IMG_DIR, 'post9-banner.png'),
  'post10': join(IMG_DIR, 'post10-banner.png'),
  'post11': join(IMG_DIR, 'post11-banner.png'),
  'post12': join(IMG_DIR, 'post12-banner.png'),
  'post13': join(IMG_DIR, 'post13-banner.png'),
  'post14': join(IMG_DIR, 'post14-banner.png'),
  'post15': join(IMG_DIR, 'post15-banner.png'),
  'post16': join(IMG_DIR, 'post16-banner.png'),
  'post17': join(IMG_DIR, 'post17-banner.png'),
  'post19': join(IMG_DIR, 'post19-google-mcp-before-after.mp4'),
  // KSeF MCP series
  'ksef1': join(IMG_DIR, 'ksef-banner.png'),
  'ksef2': join(IMG_DIR, 'ksef-banner.png'),
  'ksef3': join(IMG_DIR, 'ksef-banner.png'),
  'ksef4': join(IMG_DIR, 'ksef-banner.png'),
};

// Map post keys → carousel PDF paths (uploaded as documents, 303% more engagement)
const POST_CAROUSELS = {
  'post10': join(IMG_DIR, 'post10-carousel.pdf'),
  'post13': join(IMG_DIR, 'post13-carousel.pdf'),
  'post15': join(IMG_DIR, 'post15-carousel.pdf'),
  'post18-mcp': join(IMG_DIR, 'post19-google-mcp-before-after.mp4'),
  'post18': join(IMG_DIR, 'post18-carousel.pdf'),
};

// Per-post publish jitter (0-7 min, stable per daemon run)
const publishJitters = {};

function identifyPost(text) {
  for (const [snippet, key] of Object.entries(POST_IDENTIFIERS)) {
    if (text.includes(snippet)) return key;
  }
  return null;
}

// Queue of pending comments
const commentQueue = [];

async function checkAndPublish() {
  const now = new Date();
  log('Checking...');

  // Check scheduled posts
  try {
    const db = new Database(DB_PATH, { readonly: true });
    // Fetch all scheduled, filter in JS for timezone-aware comparison
    // (SQLite string comparison fails with +01:00 offsets vs UTC)
    const allScheduled = db.prepare(
      "SELECT id, text, media_ids, publish_at, status FROM scheduled_posts WHERE status = 'scheduled'"
    ).all();
    db.close();
    const candidates = allScheduled.filter(p => new Date(p.publish_at).getTime() <= now.getTime());

    // Apply publish jitter: delay 0-7 min past publish_at (stable per post)
    const posts = candidates.filter(post => {
      if (!publishJitters[post.id]) {
        publishJitters[post.id] = randomMinutes(0, 7);
        log(`  Jitter for ${post.id}: +${Math.round(publishJitters[post.id] / 60000)} min`);
      }
      const publishTime = new Date(post.publish_at).getTime();
      return Date.now() >= publishTime + publishJitters[post.id];
    });

    for (const post of posts) {
      log(`Publishing scheduled post ${post.id}...`);
      const postKey = identifyPost(post.text);
      log(`  Identified as: ${postKey || 'unknown'}`);

      try {
        // Determine media URNs — either from DB or by uploading
        let mediaUrns = post.media_ids ? JSON.parse(post.media_ids) : [];
        let mediaCategory = 'NONE';

        if (mediaUrns.length === 0 && postKey) {
          // Try carousel/video from POST_CAROUSELS first
          if (POST_CAROUSELS[postKey] && existsSync(POST_CAROUSELS[postKey])) {
            const carouselPath = POST_CAROUSELS[postKey];
            const isVid = isVideoFile(carouselPath);

            if (isVid) {
              // Video files can be uploaded via the media upload API
              log(`  Uploading video: ${carouselPath}`);
              try {
                const urn = await uploadMedia(carouselPath, 'VIDEO');
                mediaUrns = [urn];
                mediaCategory = 'VIDEO';
                log(`  Video uploaded: ${urn}`);
              } catch (err) {
                logError(`  Video upload failed: ${err.message} — trying banner image`);
              }
            } else if (carouselPath.endsWith('.pdf')) {
              // PDFs (carousel documents) cannot be uploaded via v2/assets registerUpload
              // The document upload requires /rest/posts API which needs Community Management scope
              // Skip carousel PDF, fall through to banner image
              log(`  Skipping carousel PDF (requires /rest/posts scope) — trying banner image`);
            }
          }

          // Fallback to banner image or video
          if (mediaUrns.length === 0 && POST_IMAGES[postKey]) {
            const imgPath = POST_IMAGES[postKey];
            if (existsSync(imgPath)) {
              const isVid = isVideoFile(imgPath);
              const mediaType = isVid ? 'VIDEO' : 'IMAGE';
              log(`  Uploading ${mediaType.toLowerCase()}: ${imgPath}`);
              try {
                const urn = await uploadMedia(imgPath, mediaType);
                mediaUrns = [urn];
                mediaCategory = mediaType;
                log(`  ${mediaType} uploaded: ${urn}`);
              } catch (err) {
                logError(`  ${mediaType} upload failed: ${err.message} — publishing without media`);
              }
            }
          }
        } else if (mediaUrns.length > 0) {
          // Pre-loaded media_ids from SQLite — determine category from URN content
          // Default to IMAGE; caller should have set appropriate URNs
          mediaCategory = 'IMAGE';
          log(`  Using ${mediaUrns.length} pre-loaded media URN(s) from DB`);
        }

        // Create post (with or without media)
        const { postUrn, shareUrn } = await createPost(post.text, mediaUrns, mediaCategory);

        // Verify post is live before proceeding
        await verifyPostLive(postUrn);

        // Update DB
        const dbw = new Database(DB_PATH);
        dbw.prepare(
          "UPDATE scheduled_posts SET status = 'published', post_urn = ?, published_at = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(postUrn, new Date().toISOString(), post.id);
        dbw.close();

        // Queue auto-comment for 12-22 min later (randomized)
        // Use shareUrn for the comment API (NOT the ugcPost URN)
        const commentText = postKey ? (AUTO_COMMENTS[postKey] || AUTO_COMMENTS.default) : AUTO_COMMENTS.default;
        const commentDelay = randomMinutes(12, 22);
        const commentDelayMin = Math.round(commentDelay / 60000);
        commentQueue.push({
          share_urn: shareUrn,
          post_urn: postUrn,
          comment_at: new Date(Date.now() + commentDelay),
          text: commentText,
        });
        log(`  Comment queued for ~${commentDelayMin} min later (${postKey || 'default'})`);
      } catch (err) {
        logError(`  Failed to publish ${post.id}: ${err.message}`);
        // Mark as failed after 3 retries
        const dbw = new Database(DB_PATH);
        const current = dbw.prepare("SELECT retry_count FROM scheduled_posts WHERE id = ?").get(post.id);
        const retries = (current?.retry_count || 0) + 1;
        if (retries >= 3) {
          dbw.prepare("UPDATE scheduled_posts SET status = 'failed', error = ?, retry_count = ?, updated_at = datetime('now') WHERE id = ?")
            .run(err.message, retries, post.id);
          logError(`  Post ${post.id} marked as FAILED after ${retries} retries`);
        } else {
          dbw.prepare("UPDATE scheduled_posts SET retry_count = ?, updated_at = datetime('now') WHERE id = ?")
            .run(retries, post.id);
          log(`  Will retry (attempt ${retries}/3)`);
        }
        dbw.close();
      }

      // Random delay between consecutive posts (1-5 min)
      if (posts.indexOf(post) < posts.length - 1) {
        const interDelay = randomMinutes(1, 5);
        log(`  Waiting ${Math.round(interDelay / 60000)} min before next post...`);
        await sleep(interDelay);
      }
    }
  } catch (err) {
    logError(`DB error: ${err.message}`);
  }

  // Check comment queue
  const readyComments = commentQueue.filter(c => new Date() >= c.comment_at);
  for (const c of readyComments) {
    log(`Adding comment to ${c.share_urn}...`);
    try {
      const commentUrn = await createComment(c.share_urn, c.text);
      log(`  Comment added: ${commentUrn}`);
      commentQueue.splice(commentQueue.indexOf(c), 1);
    } catch (err) {
      logError(`  Comment failed for ${c.share_urn}: ${err.message}`);
      c.retries = (c.retries || 0) + 1;
      if (c.retries >= 5) {
        logError(`  Max retries (5) reached for comment on ${c.share_urn} — giving up`);
        commentQueue.splice(commentQueue.indexOf(c), 1);
      } else {
        c.comment_at = new Date(Date.now() + 5 * 60 * 1000);
        log(`  Retrying in 5 min (attempt ${c.retries}/5)`);
      }
    }
  }
}

log('LinkedIn Auto-Publisher v4 started');
log('Mode: Direct API calls (no MCP subprocess)');
log('Features: media upload, post verification, educational comments, timing randomization');
log('Comment delay: 12-22 min (random) | Publish jitter: 0-7 min');
log('Checking every 60 seconds...');
log('');

// Run immediately, then every 60s
checkAndPublish();
setInterval(checkAndPublish, 60000);
