#!/usr/bin/env node
/**
 * Punktowe poprawki 4 propozycji wstrzymanych przez qa-gate 2026-07-26.
 *
 * ZASADA: naprawiam wyłącznie to, co da się naprawić BEZ zmyślania.
 *   - korekta nieaktualnego faktu (KSeF już obowiązuje)
 *   - korekta niespójności hook vs treść (obiecane 5, dowiezione 3)
 *   - usunięcie niepublicznych danych finansowych klientów
 *   - zamiana pytania otwartego na zamknięte z osią sporu (wymóg algorithm-2026)
 *
 * NIE dopisuję przeżytych scen — to jedyny powód pozostałych 7 HOLD-ów i tego
 * automat zrobić nie może. qa-gate też odmówił, i słusznie.
 *
 * Oryginały zostają w text_original (ustawione przy migracji).
 *
 * Użycie: node scripts/fix-proposals-2026-07-26.mjs [--apply]
 */

import { join } from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';

const DB_PATH = join(process.env.LINKEDIN_DATA_DIR || join(homedir(), '.linkedin-mcp'), 'scheduler.db');
const APPLY = process.argv.includes('--apply');

const FIXES = [
  {
    id: '654e09d0-93da-40fe-91e9-b4aba8184698',
    label: 'KSeF korekta w EUR',
    edits: [
      {
        why: 'FAKT NIEAKTUALNY — qa-gate: w lipcu 2026 KSeF już obowiązuje',
        from: 'Od 2026 KSeF będzie obowiązkowy.',
        to: 'KSeF już obowiązuje.',
      },
      {
        why: 'OVERCLAIM — twierdzenie o świecie nieweryfikowalne; zamiana na własną obserwację',
        from: 'Nigdzie tego nie dokumentują.',
        to: 'Nie znalazłem tego w dokumentacji.',
      },
      {
        why: 'PYTANIE OTWARTE -> zamknięte z osią sporu (wymóg algorithm-2026)',
        from: 'Ile firm dowie się o tych pułapkach dopiero w produkcji?',
        to: 'Walidować XML u siebie przed wysłaniem, czy ufać, że KSeF sam powie, co jest nie tak?',
      },
    ],
  },
  {
    id: '032759f4-18fd-45a0-bfd5-f82cc2bcbee4',
    label: '5 case studies -> 3',
    newTitle: '3 case studies — jedno pytanie',
    edits: [
      {
        why: 'complete=false — hook obiecywał 5 case studies, treść dowozi 3',
        from: '5 case studies. Każdy zaczął się od jednego pytania klienta.',
        to: 'Trzy case studies. Każdy zaczął się od jednego pytania klienta.',
      },
      {
        why: 'PYTANIE OTWARTE -> zamknięte z osią sporu',
        from: 'Jaki problem w Twojej firmie rozwiązujesz ręcznie, choć mógłbyś zautomatyzować?',
        to: 'Zautomatyzować jeden proces porządnie, czy kupić platformę, która obiecuje wszystko?',
      },
    ],
  },
  {
    id: '9fc7a81b-d18f-400c-a052-5255e1b03105',
    label: 'Sklep <-> magazyn',
    edits: [
      {
        why: 'DANE FINANSOWE KLIENTA — abonament znika z treści',
        from: 'Abonament: 5K/mies.\n',
        to: '',
      },
    ],
  },
  {
    id: '6e8443b0-bd8f-43d5-8cf3-64948183803b',
    label: 'Google Ads',
    edits: [
      {
        why: 'DANE FINANSOWE KLIENTA — budżet i absolutne CPA znikają, zostaje kierunek zmiany',
        from: 'Klient wydawał 3000 zł/mies na Google Ads. CPA: 47 zł. ROAS: 2.1x.',
        to: 'Klient zmieniał stawki w Google Ads ręcznie. Dwie godziny tygodniowo, co tydzień.',
      },
      {
        why: 'DANE FINANSOWE KLIENTA — absolutne kwoty na zmianę relatywną',
        from: 'Po miesiącu: CPA spadło do 31 zł. ROAS: 3.4x.',
        to: 'Po miesiącu: koszt pozyskania niżej o jedną trzecią, zwrot z wydatku wyżej o ponad połowę.',
      },
      {
        why: 'duplikat informacji o czasie po zmianie pierwszej linii',
        from: 'Problem: zmieniał stawki ręcznie, 2h tygodniowo.\n\n',
        to: '',
      },
    ],
  },
];

const db = new Database(DB_PATH, { readonly: !APPLY });
const get = db.prepare('SELECT text FROM scheduled_posts WHERE id = ?');
const upd = APPLY ? db.prepare(
  "UPDATE scheduled_posts SET text = ?, qa_status = NULL, qa_issues = NULL, qa_scores = NULL, updated_at = datetime('now') WHERE id = ?"
) : null;
const updMp = APPLY ? db.prepare(
  "UPDATE media_plan_items SET post_text = ?, title = COALESCE(?, title), updated_at = datetime('now') WHERE scheduled_post_id = ?"
) : null;

let changed = 0;
for (const f of FIXES) {
  const row = get.get(f.id);
  if (!row) { console.log(`✗ ${f.label}: nie ma takiego posta`); continue; }

  let text = row.text;
  const applied = [], missed = [];
  for (const e of f.edits) {
    if (text.includes(e.from)) {
      text = text.replace(e.from, e.to);
      applied.push(e.why);
    } else {
      missed.push(e.from.slice(0, 50));
    }
  }
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  console.log(`\n── ${f.label} (${f.id.slice(0, 8)})`);
  for (const a of applied) console.log(`   ✓ ${a}`);
  for (const m of missed) console.log(`   ! nie znalazłem frazy: "${m}…"`);
  console.log(`   długość: ${row.text.length} -> ${text.length} zn`);
  if (f.newTitle) console.log(`   tytuł -> "${f.newTitle}"`);

  if (APPLY && applied.length) {
    upd.run(text, f.id);
    updMp.run(text, f.newTitle || null, f.id);
    changed++;
    console.log('   -> zapisano, qa_status wyczyszczony (wymaga ponownej bramki)');
  }
}

console.log(`\n${'─'.repeat(66)}`);
if (APPLY) {
  console.log(`Poprawione: ${changed}/${FIXES.length}. Teraz ponowna bramka na tych postach.`);
} else {
  console.log('To był podgląd. Uruchom z --apply, żeby zapisać.');
}
db.close();
