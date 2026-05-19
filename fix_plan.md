# Plan naprawy dashboard — 5 problemow

## Problem 1: Nie widac zdjec

**Root cause:** IMG_DIR wskazuje na `/Users/gaca/output/personal/linkedin-mcp` (pusty katalog).
Obrazy sa w `/Users/gaca/projects/personal/linkedin-mcp-server/output/linkedin-mcp/`.

**Fix:** Zmienic IMG_DIR w dashboard.mjs linia 24:
```js
const IMG_DIR = '/Users/gaca/projects/personal/linkedin-mcp-server/output/linkedin-mcp';
```

Dodatkowo: `enrichPost()` uzywa `identifyPost()` do mapowania tekst->obraz.
Wiele postow nie matchuje bo teksty sie zmienily. Fix: dodac brakujace snippets do POST_IDENTIFIERS.

**Pliki:** dashboard.mjs linia 24 + linie 56-110 (POST_IDENTIFIERS)

---

## Problem 2: Nie pobieraja sie nowe kontakty (auto-prospect)

**Root cause:** Scraper cookie `li_at` wygasl (z 16.03). Voyager API zwracal 403 -> MCP timeout 60s.
Cookie juz odswiezony (08.04). Ale `auto-prospect.mjs` uzywa `callMCP()` z timeout 60s ktory moze byc za krotki.

**Fix:**
1. Cookie zaktualizowany — zweryfikowac ze search dziala
2. Zwiekszyc timeout callMCP z 60s na 120s w auto-prospect.mjs (linia 87)
3. Dodac lepsze error handling — logowac HTTP status Voyagera
4. Przetestowac: `node auto-prospect.mjs` reczne uruchomienie

**Pliki:** auto-prospect.mjs linia 87

---

## Problem 3: Nie widac komentarzy i statystyk z LinkedIn

**Root cause:** Dashboard nie ma sekcji z engagement metrics. Dane sa w engage.db
(processed_comments, engagement_log) ale nie sa wyswietlane.

**Fix:** Dodac sekcje "Engagement" do headera i tab Posty:
1. Nowy endpoint GET /api/engagement — podsumowanie z engage.db:
   - Komentarze przetworzone dzis / w tym tygodniu
   - Decyzje: replied / liked / skipped
   - Ostatnie 10 komentarzy z decyzjami
2. W headerze `.sbar` dodac: Comments today: X | Replies: Y
3. W kartach published postow: link "Zobacz komentarze" (linkedin_comments_list)

**Pliki:** dashboard.mjs — nowy endpoint + loadStatus() + renderCard()

---

## Problem 4: Brak mozliwosci edycji proponowanych postow

**Root cause:** Dwa bugi:
1. `PROPOSED_POSTS.indexOf(p)` zwraca -1 (porownanie referencji obiektow JS)
2. Rendered `data-idx` jest -1 -> openCreateFromProposed dostaje undefined

**Fix:** W render() uzyc findIndex z porownaniem po dacie:
```js
var origIdx = PROPOSED_POSTS.findIndex(function(pp) { return pp.date === p.date; });
```

**Pliki:** dashboard.mjs — render() funkcja

---

## Problem 5: Brak zmian w harmonogramie po zaplanowaniu posta

**Root cause:** Po Save w modalu, loadPosts() odswieza Posty, ale renderKalendarz()
NIE jest wywolywany. Kalendarz pokazuje stale dane do recznego odswiezenia.

**Fix:** W savePost() po sukcesie dodac renderKalendarz():
```js
toast('Post created', true); closeModal(); loadPosts(); renderKalendarz();
```

**Pliki:** dashboard.mjs — savePost()

---

## Kolejnosc

1. Fix IMG_DIR (natychmiastowy efekt wizualny)
2. Fix indexOf bug + calendar refresh (edycja proposed postow)
3. Test auto-prospect z nowym cookie
4. Timeout 60->120s w auto-prospect
5. Engagement endpoint + UI w dashboardzie
