# PLAN: Przebudowa integracji LinkedIn API → dashboard :6767

**Data:** 2026-07-26
**Zakres:** nowa apka LinkedIn (Community Management API, Development Tier, 12 scope'ów) → weryfikacja endpointów → przebudowa warstwy API → rozbudowa `http://localhost:6767/`
**Wersja:** 2 — przepisana po otrzymaniu **oficjalnej listy Product API endpoints** z portalu LinkedIn
**Status:** gotowy do realizacji, Faza 0 czeka na nowy Client Secret

---

## 0. Kontrakt — czego ten plan NIE robi

| # | Zasada | Konsekwencja w kodzie |
|---|---|---|
| **A** | **ADDITIVE-ONLY.** Nie usuwam ani nie przepisuję działających funkcji. Nowe zdolności = nowe moduły, tabele, route'y, zakładki. | Zero `DROP TABLE`, zero usuwania route'ów, zero zmiany kontraktu istniejących odpowiedzi JSON — tylko dokładanie kluczy. |
| **B** | **PROVENANCE.** Każda liczba w dashboardzie wie, skąd jest i kiedy powstała. | Kolumna `source` (`api`/`xlsx`/`scraper`/`manual`) + `fetched_at` w każdej tabeli metryk. Badge źródła w UI. |
| **C** | **DOKUMENTACJA PONAD PAMIĘĆ.** Źródłem prawdy o endpointach jest oficjalna lista z portalu + wynik probe'a. Nigdy moja pamięć. | `docs/API-CAPABILITY-MATRIX.md` generowany z realnych odpowiedzi HTTP. |
| **D** | **ZERO ZMYŚLONYCH LICZB.** Brak danych = `—`. Nigdy estymata, nigdy interpolacja. | Wartości starsze niż 48 h dostają znacznik wieku. Fallback zawsze oznaczony. |

**Rollback każdej fazy:** backup baz do `~/.linkedin-mcp/<db>.bak-<faza>-<data>` + feature flag w `.env`. Wyłączenie flagi = powrót do stanu poprzedniego bez rewertu kodu.

---

## 1. Stan zastany — audyt z dowodami

### 1.1 Co żyje

| Element | Stan |
|---|---|
| Dashboard `:6767` | działa, PID 2270, HTTP 200, 7 zakładek, ~58 route'ów `/api/*` |
| `dashboard.mjs` | 8 377 linii |
| `src/index.ts` | 71 narzędzi MCP, 2 375 linii |
| Publikacja postów | działa (`POST /rest/posts`, `/v2/ugcPosts`) |
| Scheduler | 152 posty w `scheduled_posts` |
| Media plan | 96 pozycji |

### 1.2 Co jest zepsute lub martwe

| Problem | Dowód | Skutek |
|---|---|---|
| **Pipeline analityki nie żyje od 32 dni** | `data_health.last_successful_run = 2026-06-24T05:44:40Z` | wykresy przestarzałe |
| **`post_metrics` — 0 wierszy** | `COUNT(*) = 0` | oficjalna analityka per-post nigdy nie zadziałała |
| **`creator_analytics` kończy się 2026-06-24** | `MAX(date)` | impressions/followers sprzed miesiąca |
| **`social_metadata` — 25 wierszy ze 152 postów** | `COUNT(*)` | rozbicie reakcji prawie puste — **bo brakowało scope'a `w_member_social_feed`** |
| **`network_demographics` — 0 wierszy** | `COUNT(*)` | nigdy nie wypełnione |
| **Impressions z ręcznego XLSX-a** | `xlsx_top_posts` = 100 wierszy | wymaga comiesięcznego eksportu przez człowieka |
| **`src/api/analytics.ts` = martwy kod** | 146 linii pod `r_member_postAnalytics`, brak scope'a | 3 narzędzia MCP zwracają błąd |
| **Token osobisty bez `refresh_token`** | `auth.json`, `expires_at = 2026-09-02` | **za 38 dni publikacja staje** |
| **Voyager na deprecated endpointach** | `src/scraper/network.ts:5` — „legacy /identity/profiles/ deprecated → 410" | kruche |
| **`better-sqlite3` pod inną wersją Node** | `ERR_DLOPEN_FAILED`, dashboard na v22.22.0, shell na v20.18.3 | skrypty CLI padają |

### 1.3 Połączenie po API — dziś

```
Apka osobista (LINKEDIN_CLIENT_ID=777m0…)
  token: ~/.linkedin-mcp/auth.json
  scopes: openid, profile, email, w_member_social
  refresh_token: BRAK  ← wygasa 2026-09-02
  używane: POST /rest/posts, /v2/ugcPosts, upload obrazów
  → jedyna rzecz, która realnie chodzi po oficjalnym API

Apka NOWA (LINKEDIN_ORG_CLIENT_ID=77b04j5efeqa8o)
  token: ~/.linkedin-mcp/org-auth.json → PLIK NIE ISTNIEJE
  kod:  startOrgAuth() + orgLinkedinRequest() napisane, NIEZACOMMITOWANE
  wywołania: ZERO modułów używa orgLinkedinRequest()
  → skonfigurowana w .env, nigdy nie autoryzowana

Reszta (feed, search, DM, zaproszenia, analityka, sieć)
  → Playwright + Voyager (src/scraper/*, 2 660 linii) — szara strefa
```

---

## 1.4 WYNIKI WERYFIKACJI — 2026-07-26 (nadrzędne nad resztą dokumentu)

Faza 1 i 2 wykonane. Poniższe wyniki pochodzą z realnych wywołań API, nie z dokumentacji, i **unieważniają część założeń z sekcji 2 i 6**.

### Token org — zdobyty
- wszystkie **12 scope'ów** przyznane (potwierdzone `introspectToken`: `active=true`, `auth_type=3L`)
- **`refresh_token` ważny do 2027-07-26** → koniec ręcznego odnawiania
- access token: 2 miesiące (do 2026-09-24), odnawialny
- tożsamość: `/rest/me` → `Bartosz Gaca` / `bartoszgaca` / `urn:li:person:PHp-Tl1fZw`
  (uwaga: **inny person ID niż w apce osobistej** — LinkedIn nadaje ID per aplikacja)

### Probe: 1/20 → 10/20 endpointów

| Działa (200) | Nie działa |
|---|---|
| `/rest/me`, `/rest/industries`, `/rest/connections/{id}` | `memberCreatorPostAnalytics` → **404** |
| `/rest/socialMetadata/{entity}` | `memberCreatorVideoAnalytics` → **404** |
| `/rest/socialActions/{t}/comments`, `/likes` | `memberFollowersCount` → **404** |
| `/rest/organizationAcls` | `/v2/userinfo` → 403 (brak `openid` w tej apce) |
| `/rest/adTargetingFacets`, `/rest/geoTypeahead`, `/rest/seniorities` | `/rest/posts/{urn}` → 403 |

### PRZYCZYNA BLOKADY: Development Tier
Produkt **Community Management API** jest w apce w wersji **Development Tier** (jedyny dodany produkt).
Dev Tier **przyznaje scope'y na ekranie zgody, ale nie udostępnia zasobów analityki członka.**
Wykluczone jako przyczyny: wersja API (testowane 202503–202507, 202412, 202409, 202306), nazwa findera
(`q=me`/`q=entity`/`q=criteria`/bez `q`), brak scope'a (introspekcja potwierdza), zły token (`/rest/me` = 200).

→ **Jedyna droga do impressions i zasięgu: `Products → Request upgrade` w portalu.** Zadanie po stronie Bartka.

### Dev Tier: analityka ORG działa, analityka MEMBER nie (2026-07-27)

Doprecyzowanie powyższego. Development Tier **nie jest** globalną blokadą analityki — dzieli ją po podmiocie:

| Zasób | Wynik |
|---|---|
| `organizationAcls` FINDER roleAssignee | ✅ 200 — **3 strony z rolą ADMINISTRATOR** |
| `organizations/{id}` | ✅ 200 |
| `organizationalEntityShareStatistics` | ✅ 200 — **zwraca `impressionCount`, `uniqueImpressionsCount`, `clickCount`, `engagement`, `likeCount`, `commentCount`, `shareCount`** |
| `organizationPageStatistics` | ✅ 200 — odsłony strony po urządzeniu/zakładce |
| `organizationalEntityFollowerStatistics` | ✅ 200 — demografia po senioralności/branży/typie powiązania |
| `posts` FINDER author (org URN) | ✅ 200 |
| `memberCreatorPostAnalytics`, `memberFollowersCount` | ❌ 404 |
| `networkSizes/{id}` | ❌ 400 — zły `edgeType`, do ustalenia |

**Strony, na których Bartosz jest ADMINISTRATOR:**
- `urn:li:organization:72198432` — **reklamacje24.pl** (vanity `reklamancje24` — literówka w vanity)
- `urn:li:organization:109990139` — **OdpiszNaPismo.pl**
- `urn:li:organization:134844053` — **bartoszgaca.pl** (ta z `.env`)

**Ale wszystkie trzy mają 0 postów i 0 impressions.** Pipeline analityczny działa, tylko nie ma czego mierzyć — cała treść jest na profilu osobistym. `bartoszgaca.pl` ma 1 followersa.

**Wykluczone hipotezy dla 404 (nie zgadywanie, testy):** wersja API (8 wariantów), nazwa findera (`me`/`entity`/`criteria`/brak), brak scope'a (introspekcja), zły token (`/rest/me` = 200), **brak nagłówka `X-RestLi-Method: FINDER`** (dodany — bez zmiany; kontrolnie `organizationAcls` działa i z nim, i bez).

**Wniosek strategiczny:** impressions po API są osiągalne dziś, ale tylko dla treści publikowanej **jako strona**. Profil osobisty ma ~8801 followersów, strona ma 1 — przenoszenie tam publikacji byłoby autosabotażem przy celu „klienci". Właściwa droga to `Request upgrade` dla analityki profilu; strona firmowa jako **uzupełnienie** (cross-posting), nie zamiennik.

### Niewiadome rozstrzygnięte
- **N1 (posts FINDER author dla person)** — częściowo: `400 „Member permissions must be used when using member as author"`. Finder istnieje dla członka, wymaga innego trybu uprawnień. Do dokończenia.
- **N3 (eventSubscriptions)** — **hipoteza H1 potwierdzona**: `400 „Parameter 'eventType' is required"`. To realny zasób subskrypcji zdarzeń (webhooki), nie lista uczestników Events. Push zamiast pollingu jest możliwy.
- **N4 („Application 3-legged" bez scope'a)** — **TAK, ale nie darmowo.** Na tokenie osobistym: 403. Na tokenie org: **200**. Czyli wymagają produktu, nie scope'a. **Faza 8 (market intel, sizing ICP) jest wykonalna.**

### ⚠️ KOREKTA ZAŁOŻENIA: API zaniża reakcje o 56%

| Źródło (23 wspólne posty) | Suma reakcji |
|---|---|
| Eksport XLSX LinkedIna | **332** |
| `socialMetadata` z API | **146** (44%) |

**23 z 23 postów zaniżone, ani jeden zawyżony.** Systematyczne, nie szum. Przyczyna nieustalona (hipotezy: reakcje z usuniętych kont, reakcje na repostach pod innym URN) — **do zweryfikowania, nie do zgadywania**.

**Skutek dla planu:** teza „API = źródło prawdy, XLSX = historia" z Fazy 3 jest **błędna dla liczb sumarycznych**.
Nowa reguła:
- **sumy reakcji → XLSX** (eksport LinkedIna jest kompletniejszy)
- **typy reakcji (like/empathy/interest/praise) → API** (XLSX tego nie ma wcale — to unikalna wartość API)
- **impressions/zasięg → XLSX**, dopóki nie ma upgrade'u tieru

### Limity Development Tier — pierwszy twardy fakt
**429 Too Many Requests po ~110 wywołaniach** w kilka minut. `API_DAILY_BUDGET=500` był zgadywanką i jest za wysoki. Faza 9 (throttling) przestaje być teorią.

### Błąd popełniony i naprawiony (lekcja do zasady A)
Pierwsza wersja `scripts/backfill-social-metadata.mjs` robiła upsert do `social_metadata` i **nadpisała 5 wierszy gorszymi danymi** (post `7434531282274992128`: 27 reakcji → 1). Złamanie zasady A przez własny skrypt.

Naprawa strukturalna: `social_metadata` przywrócone z backupu (34 wiersze, wartości oryginalne), dane z API w **osobnej tabeli `api_social_metadata`** (90 wierszy), skrypt fizycznie nie może już dotknąć `social_metadata`.

**Wniosek ogólny:** dwa źródła o różnej kompletności **nie mogą dzielić jednego wiersza**. Każde źródło = własna tabela. Bramka driftu wyłapała to zanim dane trafiły do dashboardu.

---

## 2. Macierz zdolności — na podstawie OFICJALNEJ listy endpointów

> ⚠️ Sekcja pisana przed weryfikacją. Gdzie kłóci się z **1.4**, obowiązuje 1.4.

Sekcja przepisana. Nie ma tu już „kandydatów do zgadywania" — są potwierdzone ścieżki, metody i scope'y.

### 2.1 Analityka członka — `r_member_postAnalytics`

| Endpoint | Metoda | Co daje | Status u nas |
|---|---|---|---|
| `/rest/memberCreatorPostAnalytics` | FINDER `entity` | metryki jednego posta | **kod już istnieje** w `analytics.ts:67`, ścieżka trafiona |
| `/rest/memberCreatorPostAnalytics` | FINDER `me` | agregat wszystkich postów | **kod już istnieje** w `analytics.ts:123` |
| `/rest/memberCreatorVideoAnalytics` | FINDER `entity` | **metryki wideo** | 🆕 nie wiedziałem, że jest — do zbudowania |

Wniosek: `analytics.ts` był napisany poprawnie. Brakowało wyłącznie scope'a. To najtańsza duża wygrana w całym planie.

### 2.2 Profil członka — `r_member_profileAnalytics` ⚠️ KOREKTA

| Endpoint | Metoda | Co daje |
|---|---|---|
| `/rest/memberFollowersCount` | FINDER `me` | aktualna liczba followersów |
| `/rest/memberFollowersCount` | FINDER `dateRange` | followersi w czasie |

**Korekta mojego wcześniejszego założenia:** obiecałem, że `r_member_profileAnalytics` da wyświetlenia profilu i search appearances. **Na oficjalnej liście nie ma takich endpointów.** Ten scope daje **wyłącznie liczbę followersów**, choć opis zgody w OAuth mówi o „profile viewers, followers, search appearances".

Konsekwencja: **`linkedin_profile_views` i `linkedin_who_viewed` zostają na scraperze.** Nie migruję ich. Zapisuję to jako trwałe ograniczenie, nie jako dług.

### 2.3 Tożsamość — `r_basicprofile`

`/rest/me` GET · `/rest/industries` GET_ALL / BATCH_GET · `/rest/industryTaxonomyVersions/{v}/industries` — słownik branż (przydatny do klasyfikacji leadów).

### 2.4 Kontakty — `r_1st_connections_size`

`/rest/connections/{id}` GET — liczba kontaktów 1. stopnia. Uwaga: to GET po id, nie finder — dokładna postać `{id}` do rozstrzygnięcia probe'em.

### 2.5 Social feed członka — `w_member_social_feed` 🆕 **DUŻY UNLOCK**

| Endpoint | Metody | Znaczenie |
|---|---|---|
| `/rest/socialActions/{target}/comments` | GET_ALL, CREATE, BATCH_GET | czytanie i **pisanie komentarzy pod dowolnym postem** |
| `/rest/socialActions/{target}/comments/{id}` | GET, DELETE, PARTIAL_UPDATE | edycja i usuwanie komentarzy |
| `/rest/socialActions/{target}/likes` | GET_ALL, BATCH_GET, CREATE, DELETE | lajki: lista i dodawanie |
| `/rest/socialMetadata/{entity}` | GET, BATCH_GET | **pełne rozbicie reakcji** (praise/empathy/interest/…) |
| `/rest/reactions` | CREATE, BATCH_GET, FINDER `entity`, DELETE, PARTIAL_UPDATE | reakcje jako osobny zasób |

Dwie realne konsekwencje:

1. **`social_metadata` (25 wierszy) można wypełnić dla wszystkich 152 postów** — tabela była pusta z powodu braku scope'a, nie z powodu limitu API.
2. **Komentowanie cudzych postów przechodzi na oficjalne API.** Skill `li-comment-flow` przestaje klikać Playwrightem. **Ale:** discovery postów do komentowania (feed, search) **nadal nie istnieje w API** → wyszukiwanie zostaje na scraperze, sama akcja idzie po REST. Podział: *scraper znajduje, API działa.*

### 2.6 Posty

| Endpoint | Metoda | Scope |
|---|---|---|
| `/rest/posts` | CREATE | `w_member_social`, `w_organization_social` ✅ używane |
| `/rest/posts/{postUrn}` | GET, PARTIAL_UPDATE, DELETE | odpowiednio r/w |
| `/rest/posts` | FINDER `author`, BATCH_GET | `r_organization_social` |

⚠️ Do rozstrzygnięcia probe'em: FINDER `author` ma przypisany tylko `r_organization_social`. Czy zadziała dla **person URN**, czy wyłącznie dla org? Od tego zależy, czy `linkedin_posts_list` może zejść ze scrapera.

### 2.7 Media 🆕 — trzy nowe zdolności

| Endpoint | Metody | Scope | Znaczenie |
|---|---|---|---|
| `/rest/images` | initializeUpload, GET, BATCH_GET, PARTIAL_UPDATE | `w_member_social` | obrazy ✅ mamy |
| `/rest/documents` | **initializeUpload**, GET, BATCH_GET, FINDER `associatedAccount` | `w_member_social` | 🆕 **karuzele PDF natywnie przez API** — dziś generujemy PDF-y (`linkedin_carousel_generate`), ale nie mamy oficjalnej ścieżki wysyłki |
| `/rest/videos` | **initializeUpload**, **finalizeUpload**, GET, BATCH_GET | `w_member_social` | 🆕 **posty wideo przez API** + metryki z `memberCreatorVideoAnalytics` |
| `/rest/assets` | registerUpload, completeMultipartUpload, registerLiveEvent, endLiveEvent | `w_organization_social` | 🆕 transmisje live strony firmowej |

Karuzele to według naszych własnych guidelines najmocniejszy format. Dziś kończą jako plik PDF, który trzeba wrzucić ręcznie. `/rest/documents` domyka ten łańcuch.

### 2.8 Strona firmowa — `rw_organization_admin` / `r_/w_organization_social`

| Endpoint | Metoda | Co daje |
|---|---|---|
| `/rest/organizationAcls` | FINDER `roleAssignee`, `organization` | **których stron jesteś adminem** — pierwszy call do wykonania |
| `/rest/organizations/{id}` · `/rest/organizations` | GET, FINDER `vanityName`, `parentOrganization`, BATCH_GET | dane strony |
| `/rest/organizationPageStatistics` | FINDER `organization` | statystyki strony (odsłony, kliknięcia) |
| `/rest/brandPageStatistics` | FINDER `brand` | statystyki brand page |
| `/rest/organizationalEntityShareStatistics` | FINDER `organizationalEntity` | metryki postów firmy |
| `/rest/organizationalEntityFollowerStatistics` | FINDER `organizationalEntity` | followersi + demografia |
| `/rest/organizationalEntityNotifications` | FINDER `criteria` | 🆕 **feed powiadomień strony** — komentarze, wzmianki, reakcje |
| `/rest/organizationBrands` · `/rest/organizationAuthorizations` | FINDER/BATCH_GET | struktura marek |
| `/rest/videoAnalytics` | FINDER `entity` | `r_organization_social` — metryki wideo firmy |
| `/rest/peopleTypeahead` | FINDER `organizationFollowers` | `r_organization_followers` — followersi org (do mention) |
| `/rest/vanityUrl` | FINDER `vanityUrlAsOrganization` | `r_organization_followers` |

`organizationalEntityNotifications` jest cenniejszy, niż wygląda: to jedyny oficjalny „feed zdarzeń" w całym zestawie. Dla strony firmowej zastępuje polling.

### 2.9 Events i subskrypcje — do rozstrzygnięcia

| Endpoint | Metoda | Scope |
|---|---|---|
| `/rest/events` | FINDER `eventsByOrganizer`, GET `{id}` | `rw_organization_admin` |
| `/rest/eventSubscriptions` | FINDER `subscriberAndEventType`, GET/UPDATE/DELETE `{key}` | `rw_organization_admin` |

**Dwie hipotezy co do `eventSubscriptions` — nie zgaduję, sprawdzam:**
- **H1:** to subskrypcje webhooków (LinkedIn wysyła nam zdarzenia push) → wtedy demony przestają pollować, co jest dużą zmianą architektury.
- **H2:** to zapisy uczestników na LinkedIn Events (webinary) organizowane przez stronę.

Rozstrzygnięcie: probe + dokumentacja portalu (Faza 2). Do tego czasu **nic na tym nie buduję**.

### 2.10 Bez scope'a / Application 3-legged 🆕 — nieoczekiwana wartość

| Endpoint | Co daje | Dlaczego to ważne |
|---|---|---|
| `/rest/organizationsLookup` | BATCH_GET — dane **dowolnej** firmy | monitoring 11 konkurentów **oficjalnie**, zamiast scrapować |
| `/rest/networkSizes/{id}` | GET — rozmiar sieci/followersów entity | licznik followersów konkurencji bez Voyagera |
| `/rest/people` · `/rest/people/{memberId}` | BATCH_GET, GET | dane osób |
| `/rest/audienceCounts` | FINDER `targetingCriteria`, `targetingCriteriaV2` | 🆕 **sizing ICP** — „ilu jest decydentów w e-commerce w PL" bez Sales Navigatora |
| `/rest/adTargetingEntities` | FINDER `typeahead`, `urns`, `adTargetingFacet`, `similarEntities` | słownik kryteriów targetowania + **encje podobne** |
| `/rest/adTargetingFacets` | GET_ALL | lista dostępnych wymiarów targetowania |
| taksonomie: `/rest/geo`, `/rest/geoTypeahead`, `/rest/skills`, `/rest/titles`, `/rest/standardizedTitles`, `/rest/seniorities`, `/rest/functions`, `/rest/fieldsOfStudy`, `/rest/degrees`, `/rest/iabCategories` | słowniki | normalizacja leadów i prospektów zamiast parsowania stringów |

⚠️ Etykieta „Application (3-legged)" jest niejednoznaczna. Do sprawdzenia probe'em, czy nasz token członkowski wystarcza, czy trzeba tokena aplikacyjnego (`client_credentials`). Nie zakładam.

`audienceCounts` + `adTargetingEntities` to zdolność, której w systemie w ogóle nie ma i o której nie myślałem: **ilościowa walidacja ICP na danych LinkedIna**, nie na przeczuciu.

### 2.11 Czego NADAL nie ma — potwierdzone brakiem na liście

- ❌ feed innych osób / discovery postów do komentowania
- ❌ `search people` / `search companies` (jest tylko typeahead followersów org i typeahead ad-targetingu)
- ❌ wiadomości / DM
- ❌ zaproszenia (wysyłanie, lista, akceptacja)
- ❌ **wyświetlenia profilu i search appearances** (patrz 2.2)
- ❌ analityka cudzych postów / postów konkurencji
- ❌ powiadomienia członka (są tylko `organizationalEntityNotifications` dla strony)

**Scraper zostaje** dla: `feed`, `search_people`, `search_companies`, `company_people`, `person_activity`, `conversations`, `messages`, `send_message`, `start_conversation`, `send_invitation`, `invitations`, `respond_invitation`, `connections`, `notifications`, `profile_detail`, `who_viewed`, `profile_views`, `post_reactors`, `prospect_scan`, `monitor_stats`.

To nie porażka. To podział pracy: **REST tam, gdzie oficjalnie wolno; Playwright wyłącznie tam, gdzie nie ma alternatywy.**

---

## 3. FAZA 0 — Higiena (blokuje wszystko)

| # | Kto | Zadanie |
|---|---|---|
| 0.1 | **Bartosz** | LinkedIn Developers → apka `77b04j5efeqa8o` → Auth → **Regenerate Primary Client Secret**. Wklejony do czatu = spalony. |
| 0.2 | **Bartosz** | Redirect URLs: dodaj `http://localhost:8586/callback`; sprawdź `http://localhost:8585/callback` przy apce osobistej. |
| 0.3 | **Bartosz** | Products → potwierdź status **Approved** (nie Pending) i zapisz tier. |
| 0.4 | Claude | Podmiana `LINKEDIN_ORG_CLIENT_SECRET` w `.env`. |
| 0.5 | Claude | `LINKEDIN_ORG_SCOPES` (12 scope'ów), `LINKEDIN_ORG_CALLBACK_PORT=8586`, flagi: `USE_API_ANALYTICS=0`, `USE_API_SOCIAL_FEED=0`, `ENABLE_ORG_FEATURES=0`, `ENABLE_MARKET_INTEL=0`, `API_DAILY_BUDGET`. |
| 0.6 | Claude | `src/utils/config.ts` + walidacja startowa (brak secretu → jasny komunikat, nie cichy 401). |
| 0.7 | Claude | Backup 5 baz: `{analytics,scheduler,prospects,engage,content}.db.bak-faza0-20260726`. |
| 0.8 | Claude | Commit niezacommitowanego kodu org-auth osobno, żeby dalszy diff był czytelny. |
| 0.9 | Claude | **Naprawa `better-sqlite3`**: `.nvmrc` z jedną wersją Node + `npm rebuild`. Bez tego skrypty CLI nie działają. |

### Zweryfikowane już teraz
- ✅ `.env` w `.gitignore` (linia 4), **nie trackowany w gicie**
- ✅ Client ID `77b04j5efeqa8o` **nigdy nie był w historii gita** (`git log -S` = pusto)
- ⚠️ Wklejony secret = skompromitowany; nie zapisuję go nigdzie

### DoD
`npm run build` OK · `tools/list` = **71** narzędzi (zero regresji) · dashboard 200, 7 zakładek · backupy istnieją · skrypt CLI otwiera SQLite bez `ERR_DLOPEN_FAILED`.

---

## 4. FAZA 1 — Jeden OAuth, dwa światy

**Strategia dwóch tokenów:**
```
auth.json      (apka osobista) → PUBLIKACJA. Nie ruszamy.
org-auth.json  (apka nowa)     → CZYTANIE + SOCIAL FEED + FIRMA. Cała nowa funkcjonalność.
```
Przełączenie publikacji na nowy token — najwcześniej po **14 dniach** stabilnej pracy (Faza 9). Awaria publikacji = awaria całego kalendarza treści.

### Kroki
1. `linkedin_auth_start` + parametr `app: "member" | "org"` (domyślnie `member` → zero zmian dla istniejących wywołań).
2. Autoryzacja apki org, 12 scope'ów. **Bartosz klika zgodę** — nie loguję się na jego konto.
3. Weryfikacja, czy przyszedł `refresh_token`. Jeśli nie — zapisuję to jako fakt, **nie udaję auto-refresha**.
4. Auto-refresh w `orgLinkedinRequest()`: na 401 oraz proaktywnie przy < 7 dniach do wygaśnięcia.
5. `linkedin_auth_status` → oba tokeny, scope'y, daty, obecność refresha.
6. **Osobne zadanie z deadline'em 2026-08-15:** reautoryzacja apki osobistej po `refresh_token`. Dziś token wygasa 2026-09-02 i publikacja stanie.

### DoD
`org-auth.json` istnieje · zwrócone scope'y = 12 (albo udokumentowana lista odrzuconych) · `auth_status` pokazuje oba · `auto-publish.mjs` publikuje na starym tokenie (dry-run OK).

---

## 5. FAZA 2 — Weryfikacja endpointów

Mając oficjalną listę, ta faza przestaje być odkrywaniem, a staje się **potwierdzeniem kształtu odpowiedzi i rozstrzygnięciem 4 niewiadomych**.

### Narzędzie: `scripts/api-probe.mjs`
Dla każdego endpointu: strzał, kod HTTP, nagłówki, 500 znaków body → tabela `api_endpoint_probe` + `docs/API-CAPABILITY-MATRIX.md`.
Tryby: `--read-only` (domyślny) · `--include-writes` (osobno, na jednym poście testowym, natychmiast usuwanym, nigdy na produkcyjnej treści).

### Cztery niewiadome do rozstrzygnięcia

| # | Pytanie | Dlaczego blokuje |
|---|---|---|
| **N1** | `/rest/posts` FINDER `author` — działa dla person URN czy tylko org? | decyduje, czy `linkedin_posts_list` zejdzie ze scrapera |
| **N2** | `/rest/connections/{id}` — jaka postać `{id}`? | bez tego brak liczby kontaktów |
| **N3** | `eventSubscriptions` = webhooki (H1) czy uczestnicy Events (H2)? | H1 zmieniałoby architekturę demonów z pollingu na push |
| **N4** | Endpointy „Application (3-legged)" — wystarcza token członkowski? | decyduje o całej Fazie 8 (market intelligence) |

### Zakres probe'a
Wszystkie endpointy z sekcji 2, pogrupowane po scope. Dla finderów — także warianty parametrów (`queryType`, `aggregation`, `dateRange`).

### DoD
Każdy endpoint ma zapisany kod HTTP i próbkę · macierz zawiera jawną sekcję „NIE DZIAŁA / brak dostępu" (równie ważną jak sukcesy) · N1–N4 rozstrzygnięte · zakładka API Status renderuje macierz.

---

## 6. FAZA 3 — Analityka członka z API (największy zysk)

### 6.1 Model danych — wyłącznie dodawanie

```sql
ALTER TABLE post_metrics         ADD COLUMN source TEXT DEFAULT 'scraper';
ALTER TABLE post_metrics_history ADD COLUMN source TEXT DEFAULT 'scraper';
ALTER TABLE creator_analytics    ADD COLUMN source TEXT DEFAULT 'xlsx';

CREATE TABLE IF NOT EXISTS api_post_analytics  (post_urn, metric_type, aggregation, date, count, fetched_at, PRIMARY KEY (post_urn, metric_type, aggregation, date));
CREATE TABLE IF NOT EXISTS api_video_analytics (post_urn, metric_type, date, count, fetched_at, PRIMARY KEY (post_urn, metric_type, date));
CREATE TABLE IF NOT EXISTS api_followers       (date, count, delta, fetched_at, PRIMARY KEY (date));
CREATE TABLE IF NOT EXISTS api_endpoint_probe  (endpoint, method, scope, http_status, works, sample, tested_at, PRIMARY KEY (endpoint, method));
CREATE TABLE IF NOT EXISTS api_usage           (day, endpoint, calls, errors, PRIMARY KEY (day, endpoint));
CREATE TABLE IF NOT EXISTS source_drift        (post_urn, metric, api_value, xlsx_value, scraper_value, delta_pct, checked_at);
```

Nietknięte: `xlsx_top_posts` (100) · `creator_analytics` (2 202) · `post_metrics_history` (1 381) · `social_metadata` (25) · `follower_deltas` (72) · `top_engagers` (67).

### 6.2 Kod

| Krok | Plik | Zmiana |
|---|---|---|
| 3.1 | `src/api/analytics.ts` | token org, zapis do `api_post_analytics`. Ścieżki **bez zmian** — oficjalna lista potwierdziła, że były poprawne |
| 3.2 | `src/api/video-analytics.ts` 🆕 | `/rest/memberCreatorVideoAnalytics` |
| 3.3 | `src/api/followers.ts` 🆕 | `/rest/memberFollowersCount` FINDER `me` + `dateRange` |
| 3.4 | `src/api/connections.ts` 🆕 | `/rest/connections/{id}` (po rozstrzygnięciu N2) |
| 3.5 | `src/api/profile.ts` | `/rest/me` z `r_basicprofile` |
| 3.6 | `src/index.ts` | +4 narzędzia: `linkedin_video_analytics`, `linkedin_followers_count`, `linkedin_followers_trend`, `linkedin_connections_count` → **75** |
| 3.7 | `scripts/api-backfill-analytics.mjs` 🆕 | 152 posty × 5 metryk, throttling, checkpoint (wznawialny) |
| 3.8 | `scripts/drift-check.mjs` 🆕 | API vs XLSX vs scraper → `source_drift`; rozjazd > 10 % = alarm |

### 6.3 Warstwa wyboru źródła — POPRAWIONA po weryfikacji 2026-07-26

`resolveMetric(postUrn, metric)` → `{ value, source, fetched_at, stale }`.

Pierwotnie hierarchia była „api → xlsx → scraper" dla wszystkich metryk. **To błąd** — probe wykazał, że API zaniża reakcje o 56%. Hierarchia jest teraz **per metryka**, nie globalna:

| Metryka | Priorytet źródeł | Dlaczego |
|---|---|---|
| `impressions`, `members_reached` | xlsx → (api po upgrade tieru) → scraper | API niedostępne w Dev Tier (404) |
| `reactions_total` | **xlsx** → scraper → api | API zaniża o 56% (332 vs 146 na 23 postach) |
| `reactions_by_type` (like/empathy/interest/praise) | **api** → brak | jedyne źródło; XLSX tego nie ma |
| `comments` | xlsx → api (1. poziom) → scraper | API nie zwraca `aggregatedTotalComments` |
| `followers` | xlsx → (api po upgrade) | `memberFollowersCount` → 404 |

**Nigdy nie zwraca liczby bez źródła.** To implementacja zasady D.

**Zasada strukturalna wyciągnięta z incydentu:** każde źródło zapisuje do **własnej tabeli** (`social_metadata` = scraper, `api_social_metadata` = API, `xlsx_top_posts` = eksport). Żaden import nie robi upsertu do tabeli innego źródła. Porównania robi warstwa odczytu, nie zapis.

### DoD
`api_post_analytics` ma dane dla ≥ 90 % postów z `post_urn` · wykresy impressions świeższe niż 48 h · `source_drift` policzony i opisany · `USE_API_ANALYTICS=0` przywraca dokładnie stare zachowanie.

---

## 7. FAZA 4 — Social feed: pełne rozbicie reakcji + oficjalne komentowanie 🆕

Faza, której w wersji 1 planu nie było. Wynika wprost z `w_member_social_feed`.

| Krok | Zakres |
|---|---|
| 4.1 | `src/api/social-metadata.ts` → token org; backfill `socialMetadata` BATCH_GET dla **wszystkich 152 postów** (dziś 25) |
| 4.2 | `/rest/socialActions/{target}/likes` GET_ALL → lista lajkujących **oficjalnie**; `linkedin_post_reactors` dostaje ścieżkę REST z fallbackiem na scraper |
| 4.3 | `/rest/socialActions/{target}/comments` CREATE → `linkedin_comment_create` na REST także dla **cudzych** postów |
| 4.4 | `/rest/socialActions/{target}/comments/{id}` PARTIAL_UPDATE → nowe narzędzie `linkedin_comment_update` |
| 4.5 | `/rest/reactions` CREATE/DELETE → `linkedin_reaction_add/remove` na oficjalnej ścieżce |
| 4.6 | **Skill `li-comment-flow`**: discovery nadal scraperem (brak feedu w API), ale **publikacja komentarza po REST**. Mniej klikania = mniej ryzyka blokady konta |
| 4.7 | `auto-engage.mjs`: odpowiedzi na komentarze przez REST, scraper jako fallback |

+2 narzędzia (`linkedin_comment_update`, `linkedin_likes_list`) → **77**

### DoD
`social_metadata` pokrywa ≥ 90 % postów · komentarz testowy dodany i usunięty przez REST · `auto-engage.mjs` działa na REST z zachowanym fallbackiem · licznik cykli Playwrighta (`playwright_cycles`) zmierzony przed i po.

---

## 8. FAZA 5 — Media natywne: karuzele i wideo 🆕

| Krok | Zakres |
|---|---|
| 5.1 | `src/api/documents.ts` 🆕 — `/rest/documents` initializeUpload → upload → post typu dokument |
| 5.2 | Domknięcie łańcucha karuzeli: `linkedin_carousel_generate` (PDF) → **upload → publikacja**, bez ręcznego wrzucania |
| 5.3 | `src/api/videos.ts` 🆕 — `/rest/videos` initializeUpload + finalizeUpload (multipart) |
| 5.4 | Metryki wideo z `memberCreatorVideoAnalytics` do `api_video_analytics` |
| 5.5 | Scheduler i `auto-publish.mjs`: nowe typy załącznika `document` / `video` obok istniejącego `image`. **Istniejąca ścieżka obrazkowa bez zmian** |

+2 narzędzia (`linkedin_document_upload`, `linkedin_video_upload`) → **79**

### DoD
Karuzela publikuje się end-to-end bez ręcznego kroku · wideo testowe publikuje się i jest usuwane · metryki wideo w bazie · posty obrazkowe działają identycznie jak przed zmianą.

---

## 9. FAZA 6 — Odcięcie scrapera tam, gdzie API wystarcza

Zakres **zawężony** względem wersji 1 planu — po korekcie z 2.2.

| Narzędzie | Dziś | Po zmianie | Scraper |
|---|---|---|---|
| `linkedin_post_metrics` | Voyager | REST `memberCreatorPostAnalytics` | fallback |
| `linkedin_post_metrics_batch` | Voyager | REST batch + throttle | fallback |
| `linkedin_post_analytics` | martwy | REST — działa | — |
| `linkedin_analytics_aggregated` | martwy | REST `q=me` | — |
| `linkedin_analytics_trends` | XLSX | REST DAILY | XLSX = historia |
| `linkedin_network_growth` | XLSX | REST `memberFollowersCount dateRange` | XLSX = historia |
| `linkedin_network_stats` | Voyager | REST followers + connections size | fallback |
| `linkedin_post_reactors` | Voyager | REST `socialActions/{t}/likes` | fallback |
| `linkedin_posts_list` | REST/scraper | REST FINDER `author` **tylko jeśli N1 = tak** | fallback |
| ~~`linkedin_profile_views`~~ | Voyager | **ZOSTAJE na scraperze** — API tego nie ma | jedyne źródło |
| ~~`linkedin_who_viewed`~~ | Voyager | **ZOSTAJE na scraperze** | jedyne źródło |

### Wzorzec — bez utraty działającego kodu
```
1. próba REST
2. błąd / brak scope'a → log + dotychczasowa ścieżka scraperowa
3. odpowiedź zawiera `source`
4. inkrementacja api_usage
```
Zero usuniętych funkcji scraperowych. Zmienia się tylko kolejność prób.

### DoD
Każde migrowane narzędzie ma test: REST-ok / REST-fail→scraper / oba zwracają `source` · żadne narzędzie nie zniknęło z `tools/list` · spadek cykli Playwrighta udokumentowany liczbą.

---

## 10. FAZA 7 — Company Page bartoszgaca.pl (dziś zdolność zerowa)

### Kolejność — pierwszy call rozstrzyga sens całej fazy
`/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR` → jeśli strona nie wraca, dalsze kroki są bezcelowe i faza idzie do wyjaśnienia uprawnień, nie do kodu.

### Moduły
`src/api/org-posts.ts` · `src/api/org-analytics.ts` · `src/api/org-followers.ts` · `src/api/org-notifications.ts` — wszystkie na `orgLinkedinRequest()`.

### Narzędzia (+10 → **89**)
`linkedin_org_admin_check` · `linkedin_org_post_create` · `linkedin_org_posts_list` · `linkedin_org_post_delete` · `linkedin_org_comments_list` · `linkedin_org_comment_create` · `linkedin_org_page_statistics` · `linkedin_org_share_statistics` · `linkedin_org_followers_statistics` · `linkedin_org_notifications`

### Tabele
```sql
CREATE TABLE IF NOT EXISTS org_posts     (post_urn PRIMARY KEY, org_urn, text, published_at, source_post_urn, created_at);
CREATE TABLE IF NOT EXISTS org_analytics (date, metric, value, fetched_at, PRIMARY KEY (date, metric));
CREATE TABLE IF NOT EXISTS org_followers (date, count, delta, demographics_json, fetched_at, PRIMARY KEY (date));
CREATE TABLE IF NOT EXISTS org_comments  (comment_urn PRIMARY KEY, post_urn, author_urn, text, created_at, replied INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS org_notifications (id PRIMARY KEY, type, entity_urn, payload_json, occurred_at, handled INTEGER DEFAULT 0);
```

### Cross-posting
`scripts/cross-post.mjs`: post osobisty → **wariant** firmowy (inny hook, inne CTA — nie kopia; LinkedIn karze duplikaty), z kolejką zatwierdzania w dashboardzie. Domyślnie **wymaga akceptacji człowieka**.

### `auto-engage.mjs`
Kolumna `target` (`member`/`org`) w `reply_proposals`; komentarze pod postami strony wchodzą do tej samej kolejki. Istniejący przepływ dla profilu — bez zmian.

### Events / webhooki
Wchodzi **tylko** jeśli N3 rozstrzygnie się jako H1 (webhooki). Wtedy osobny podetap: rejestracja subskrypcji + endpoint odbiorczy + przejście demonów z pollingu na push. Jeśli H2 — obsługa LinkedIn Events strony.

### DoD
`org_admin_check` potwierdza rolę ADMINISTRATOR dla `LINKEDIN_ORG_URN` · post testowy jako firma opublikowany i usunięty · zakładka „Firma" pokazuje posty, followersów, analitykę, powiadomienia · `ENABLE_ORG_FEATURES=0` ukrywa całość bez błędów.

---

## 11. FAZA 8 — Market intelligence 🆕 (zdolność, której nie planowałem)

Warunkowana rozstrzygnięciem N4 („Application 3-legged" — czy nasz token wystarcza).

| Krok | Endpoint | Wartość |
|---|---|---|
| 8.1 | `/rest/organizationsLookup` BATCH_GET | dane 11 monitorowanych firm **oficjalnie**, zamiast scrapować `monitored_companies` |
| 8.2 | `/rest/networkSizes/{id}` | licznik followersów konkurencji — trend w czasie |
| 8.3 | `/rest/audienceCounts` FINDER `targetingCriteria` | **sizing ICP**: ilu decydentów w danej branży/regionie/senioralności. Ilościowa walidacja niszy zamiast przeczucia |
| 8.4 | `/rest/adTargetingEntities` FINDER `typeahead` / `similarEntities` | słownik kryteriów + **firmy/branże podobne** → podpowiedzi nowych nisz |
| 8.5 | taksonomie (`industries`, `geo`, `skills`, `titles`, `seniorities`, `functions`) | **normalizacja `prospects` i `leads`** — dziś branża to dowolny string ze scrapera; po zmianie URN z oficjalnego słownika |
| 8.6 | `/rest/peopleTypeahead` FINDER `organizationFollowers` | followersi strony jako źródło leadów |

### Tabele
```sql
CREATE TABLE IF NOT EXISTS competitor_snapshots (org_urn, date, followers, name, industry_urn, fetched_at, PRIMARY KEY (org_urn, date));
CREATE TABLE IF NOT EXISTS audience_sizing      (criteria_hash, criteria_json, count, fetched_at, PRIMARY KEY (criteria_hash));
CREATE TABLE IF NOT EXISTS taxonomy_cache       (kind, urn, label, locale, fetched_at, PRIMARY KEY (kind, urn));
```

+4 narzędzia (`linkedin_company_lookup`, `linkedin_network_size`, `linkedin_audience_count`, `linkedin_taxonomy_lookup`) → **93**

### DoD
11 firm ma snapshot z API · `audience_sizing` zwraca liczby dla ≥ 3 zdefiniowanych ICP · taksonomie w cache'u · zakładka Market Intel renderuje dane. Jeśli N4 = „token nie wystarcza" — faza zamyka się raportem, co byłoby potrzebne (token aplikacyjny), **bez pisania kodu na ślepo**.

---

## 12. FAZA 9 — Dyscyplina: limity, cache, throttling

**Czego nie zakładam:** nie znam liczbowych limitów Development Tier i **nie wpiszę ich z pamięci**. Ustalam z trzech źródeł: zakładka usage w portalu, nagłówki odpowiedzi zebrane w probe, własny licznik `api_usage`. Do tego czasu obowiązuje świadomie zaniżony `API_DAILY_BUDGET` z `.env`.

1. **Ledger** w `client.ts` — każde wywołanie → `api_usage`.
2. **Throttle** — limit współbieżności + minimalny odstęp; przy 429 backoff wykładniczy z jitterem.
3. **Cache w SQLite** (nie w pamięci — demony i MCP muszą go dzielić). TTL: analityka dzienna 6 h · profil 24 h · posty 15 min · taksonomie 30 dni.
4. **Circuit breaker** — 5 błędów pod rząd na endpoint → pauza 30 min + wpis w `data_health`.
5. **Alarm tokenów** — < 14 dni: banner; < 7 dni: błąd krytyczny w `data_health`.
6. **Reanimacja pipeline'u** — ustalenie, dlaczego stanął 2026-06-24 (launchd/cron), naprawa, monitoring „ostatni udany przebieg" z progiem 26 h.
7. **Decyzja o publikacji** — po 14 dniach stabilności: czy przenieść publikację na nowy token (ma `w_member_social`) i pozbyć się problemu wygasania. Decyzja Bartosza, nie automat.

### DoD
`api_usage` rośnie przy każdym wywołaniu · sztuczne 429 → backoff bez lawiny · `last_successful_run` młodszy niż 26 h · dashboard pokazuje zużycie i pozostały budżet.

---

## 13. FAZA 10 — Dashboard :6767 — WSZYSTKO w jednym miejscu

**Zasada:** istniejące 7 zakładek i ~58 route'ów **zachowują kontrakt**. Dokładam nowe; istniejące odpowiedzi dostają wyłącznie **dodatkowe** klucze (`source`, `fetched_at`, `stale`).

### 13.1 Nowa zakładka: **API Status** 🔌
- **Tokeny:** obie apki — scope'y, `expires_at`, licznik dni, obecność refresha, przycisk „autoryzuj ponownie" (generuje URL do kliknięcia).
- **Czerwony alarm:** „token osobisty wygasa za N dni, brak refresh — publikacja padnie".
- **Macierz zdolności:** tabela z `api_endpoint_probe` — endpoint, metoda, scope, HTTP, działa/nie, data testu, przycisk „przetestuj ponownie".
- **Zużycie limitu:** wywołania dziś per endpoint, błędy, budżet, stan circuit breakera.
- **Zdrowie danych:** ostatni udany przebieg, wiek każdego źródła, stale-flagi.
- **Drift:** rozjazdy API vs XLSX vs scraper, > 10 % podświetlone.

`GET /api/status/tokens` · `/api/status/capabilities` · `POST /api/status/probe` · `GET /api/status/usage` · `/api/status/drift`

### 13.2 Nowa zakładka: **Analytics API** 📊 (obok istniejącej, nie zamiast)
Impressions / reach / reactions / comments / reshares — dzienne wykresy z API · tabela per post z **badge'em źródła przy każdej liczbie** · **rozbicie reakcji** z `socialMetadata` (praise/empathy/interest/…) · **metryki wideo** · porównanie okresów 7/30/90 dni · zestawienie „API vs XLSX" pokazujące, ile ręczny eksport zaniżał · eksport CSV/JSON.

`GET /api/v2/analytics/posts` · `/daily` · `/reactions-breakdown` · `/video` · `/compare` · `/export`

Istniejąca zakładka Analytics **zostaje**, z dopiskiem źródła i linkiem „zobacz wersję z API".

### 13.3 Nowa zakładka: **Profil API** 👤
Followersi (timeline + delta z API) · kontakty 1. stopnia · dane `/rest/me` · **jawna informacja: „wyświetlenia profilu i search appearances — API tego nie udostępnia, dane ze scrapera"** (uczciwość zamiast pustego wykresu).

`GET /api/v2/profile/followers` · `/connections` · `/basic`

### 13.4 Nowa zakładka: **Firma** 🏢
Posty strony + metryki · statystyki strony · followersi + demografia · **feed powiadomień strony** · kolejka komentarzy do odpowiedzi jako firma · **kompozytor cross-postu** (post osobisty → propozycja wariantu firmowego do zatwierdzenia).

`GET /api/v2/org/posts` · `/analytics` · `/followers` · `/comments` · `/notifications` · `POST /api/v2/org/post` · `/cross-post`

### 13.5 Nowa zakładka: **Market Intel** 🎯
Snapshoty 11 konkurentów (followersi w czasie) · **kalkulator ICP** (kryteria → liczba osób z `audienceCounts`) · podpowiedzi „firmy/branże podobne" · przeglądarka taksonomii.

`GET /api/v2/intel/competitors` · `POST /api/v2/intel/audience-size` · `GET /api/v2/intel/similar` · `/taxonomy`

### 13.6 Nowa zakładka: **Endpoint Explorer** 🧪
Formularz: metoda + ścieżka + wybór tokena → surowa odpowiedź JSON, kod HTTP, czas. Domyślnie tylko GET; presety z macierzy. **Sens:** gdy LinkedIn doda scope albo zmieni API, testujesz z UI, bez terminala.

`POST /api/v2/explorer/call` — whitelist hostów: wyłącznie `api.linkedin.com`.

### 13.7 Rozszerzenia istniejących zakładek (bez psucia)

| Zakładka | Dodatek |
|---|---|
| **Dashboard** (główny) | Kafel „API Health": tokeny OK/alarm, ostatni przebieg, zużycie limitu |
| **Auto-Publish** | Kolumna „cel": profil / firma / oba (domyślnie „profil" = dzisiejsze zachowanie) + typ załącznika: obraz / **dokument** / **wideo** |
| **Auto-Engage** | Filtr `target` (member/org) · znacznik „komentarz dodany przez REST czy Playwright" |
| **Auto-Analytics** | Które źródło zasila który wykres + „ostatnia aktualizacja" |
| **Auto-Prospect / Leady** | Branża i stanowisko jako **URN z oficjalnej taksonomii**, nie dowolny string |
| **Kolejka postów** | Realne metryki z API przy każdym opublikowanym poście |
| **Media Plan** | Planowane vs osiągnięte — faktyczne wyniki dopięte do pozycji planu |
| **Cookie Refresh** | Lista narzędzi, które **już nie potrzebują** cookie (zeszły na REST) |

### DoD Fazy 10
Wszystkie stare route'y odpowiadają identycznie (snapshot-test przed/po) · 6 nowych zakładek renderuje realne dane albo jawne „—" · **żadna liczba w UI nie jest bez źródła** · dashboard startuje na czystej bazie bez błędów.

---

## 14. Ryzyka i mitigacje

| Ryzyko | Prawd. | Skutek | Mitigacja |
|---|---|---|---|
| **Token osobisty wygasa 2026-09-02, brak refresh** | pewne | publikacja staje | Faza 1.6, deadline **2026-08-15**, alarm w UI |
| Community Management API w statusie *Pending* | średnie | brak scope'ów org | Faza 0.3 sprawdza **przed** resztą pracy |
| Brak roli ADMINISTRATOR na stronie | średnie | Faza 7 bez sensu | pierwszy call fazy to `organizationAcls` |
| N4: endpointy „Application" wymagają innego tokena | **wysokie** | Faza 8 wypada | faza warunkowana probe'em; brak kodu na ślepo |
| Limity Development Tier za niskie na 152 × 5 metryk | średnie | backfill się nie kończy | checkpointowany backfill + throttle + rozbicie na dni |
| API zwraca inne liczby niż XLSX | **wysokie** | „które dane są prawdziwe?" | `source_drift` + jawna dokumentacja; API = źródło prawdy, XLSX = historia |
| Migracja psuje działający scraper | średnie | regresja | fallback zawsze zachowany + flagi + testy przed/po |
| `better-sqlite3` pod inną wersją Node | **potwierdzone** | skrypty CLI padają | Faza 0.9: `.nvmrc` + `npm rebuild` |
| Wyciek secretu (już nastąpił) | pewne | dostęp do apki | Faza 0.1 — regeneracja, obowiązkowa |

---

## 15. Kolejność i zależności

| Faza | Zależy od | Rozmiar | Blokada |
|---|---|---|---|
| 0 — Higiena | — | S | ✅ **zamknięta** (commit `5661a48`) |
| 1 — OAuth | 0 | S | ✅ **zamknięta** — token org, 12 scope'ów, refresh do 2027 |
| 2 — Weryfikacja endpointów | 1 | M | ✅ **zamknięta** — 10/20, przyczyna blokady ustalona |
| 3 — Analityka członka | 2 | **L** | 🔴 **ZABLOKOWANA: Development Tier** → `Request upgrade` |
| 4 — Social feed | 2 | M | 🟡 **częściowo zrobiona** — `socialMetadata` działa, 90 postów w `api_social_metadata` |
| 5 — Media (dokumenty, wideo) | 2 | M | gotowa do startu |
| 6 — Odcięcie scrapera | 3, 4 | M | wstrzymana — API zaniża reakcje, scraper i XLSX zostają |
| 7 — Company Page | 2 | **L** | `organizationAcls` = 200; brakuje `LINKEDIN_ORG_URN` w probe |
| 8 — Market intel | 2 | M | ✅ **odblokowana** — N4 potwierdzone, endpointy 200 |
| 9 — Dyscyplina | 3 | M | 🔺 **PRIORYTET** — 429 po ~110 wywołaniach, budżet 500 za wysoki |
| 10 — Dashboard | 3–9 | **L** | — |

**Zmiana priorytetów po weryfikacji:** Faza 9 (limity) awansuje przed Fazę 5 i 8 — bez throttlingu każdy backfill kończy się 429. Faza 3 czeka na decyzję LinkedIna o tierze i nie blokuje pozostałych.

Fazy 3, 4, 5, 7, 8 są od siebie niezależne — mogą iść równolegle po Fazie 2. Faza 10 domyka całość.

**Sugerowana pierwsza fala po Fazie 2:** 3 → 4 → 9 (największy zysk na jednostkę ryzyka: świeże dane + pełne reakcje + brak wypalonego limitu).

---

## 16. Checklista wykonawcza

**Faza 0** — ✅ **ZAMKNIĘTA 2026-07-26**, commit `5661a48`, poza dwoma punktami z portalu
- [~] regeneracja secretu — **Bartosz zdecydował zostawić obecny sekret** (podał go powtórnie). Decyzja świadoma, odnotowana.
- [ ] **redirect `http://localhost:8586/callback`** (Bartosz, portal) ← blokuje Fazę 1
- [ ] **status *Approved* + tier** (Bartosz, portal) ← blokuje Fazę 1
- [x] sekret w `.env` — okazał się już identyczny z podanym, bez zmian
- [x] `LINKEDIN_ORG_SCOPES` (12) + 5 flag, wszystkie domyślnie `0`
- [x] `config.ts`: loader `.env`, `orgScopes`, flagi, `apiDailyBudget`, `dbPaths`, `validateConfig()` / `logConfigProblems()`
- [x] `index.ts`: walidacja na starcie (stderr, nigdy fatalna)
- [x] backup 5 baz → `*.db.bak-faza0-20260726`
- [x] commit org-auth (`auth.ts`, `client.ts`) razem z konfiguracją
- [x] `.nvmrc` = `22.22.0` — **korekta planu:** `npm rebuild` byłby błędem, binding jest zbudowany pod ABI 127 (Node 22); to shell miał złą wersję. Rebuild pod v20 zepsułby działający dashboard.
- [x] regresja: build czysty, `tools/list` = **71**, `validateConfig()` = **0 problemów** w czystym env, dashboard `:6767` HTTP 200 na tym samym PID 2270

**Znalezione i naprawione poza planem (Faza 0):**
- [x] **`.mcp.json` zawierał sekrety OAuth i nie był w `.gitignore`**, przy publicznym remote. Nigdy nie trafił do gita (`git log -S` = pusto) — dodany do `.gitignore` razem z backupami.
- [x] **Rozjazd apek:** `.env` i `.mcp.json` miały **różne** Client ID apki osobistej. `introspectToken` (2026-07-26) potwierdził: token z `auth.json` należy do apki z `.env` (`active=true`), a apka z `.mcp.json` → `active=false`. Każda reautoryzacja przez MCP nadpisałaby `auth.json` tokenem **innej apki**, a refresh nigdy by nie zadziałał. Naprawione: sekrety usunięte z `.mcp.json`, `.env` = jedyne źródło prawdy, `GEMINI_API_KEY` przeniesiony do `.env`.
- [ ] **Wymaga restartu serwera MCP** (`/mcp`), aby proces `priv-linkedin` przeszedł na credentiale z `.env`. Do czasu restartu działa na starych zmiennych wstrzykniętych przy starcie.

**Faza 1** — ✅ **ZAMKNIĘTA 2026-07-26**
- [x] `scripts/org-auth.mjs` (zamiast parametru `app` w MCP — działający serwer trzymał starą konfigurację)
- [x] autoryzacja org — **12/12 scope'ów** przyznanych
- [x] `refresh_token` — **JEST**, ważny do 2027-07-26
- [x] naprawiony bug: `scope.split(" ")` → LinkedIn zwraca scope'y **po przecinku** (dawało fałszywe „1/12")
- [x] naprawiony bug: `/v2/userinfo` daje 403 dla apki org (brak `openid`) → fallback na `/rest/me`
- [x] `LINKEDIN_OAUTH_TIMEOUT_MIN` — okno callbacku było zaszyte na 5 min, za krótko na ludzki workflow
- [ ] `auth_status` z dwoma tokenami (do zrobienia)
- [ ] **reautoryzacja apki osobistej po `refresh_token` — deadline 2026-08-15** (token wygasa 2026-09-02)

**Faza 2** — ✅ **ZAMKNIĘTA 2026-07-26**
- [x] `scripts/api-probe.mjs` — 20 endpointów, zapis do `api_endpoint_probe`
- [x] probe na tokenie osobistym: **1/20** · na tokenie org: **10/20**
- [x] `docs/API-CAPABILITY-MATRIX-member.md` + `-org.md`
- [x] **N1** częściowo (400: member permissions) · **N3** = webhooki · **N4** = TAK, wymaga produktu nie scope'a
- [x] N2 rozstrzygnięta: `/rest/connections/{personUrn}` → 200
- [x] ustalona przyczyna blokady analityki: **Development Tier**
- [ ] probe zapisów na poście testowym (odłożone — najpierw limity)

**Faza 3** — [ ] migracje SQL (tylko dodające) · [ ] `analytics.ts` na token org · [ ] `video-analytics.ts` · [ ] `followers.ts` · [ ] `connections.ts` · [ ] `/rest/me` · [ ] 4 narzędzia → 75 · [ ] `resolveMetric()` · [ ] backfill 152 postów · [ ] `drift-check.mjs` · [ ] regresja z flagą wyłączoną

**Faza 4** — [ ] `socialMetadata` backfill dla 152 postów · [ ] lista lajkujących po REST · [ ] komentarz pod cudzym postem po REST · [ ] `comment_update` · [ ] reakcje po REST · [ ] `li-comment-flow` na REST · [ ] `auto-engage.mjs` na REST z fallbackiem · [ ] 2 narzędzia → 77

**Faza 5** — [ ] `documents.ts` · [ ] karuzela end-to-end · [ ] `videos.ts` multipart · [ ] metryki wideo · [ ] scheduler: typy `document`/`video` · [ ] 2 narzędzia → 79 · [ ] regresja postów obrazkowych

**Faza 6** — [ ] 9 narzędzi na REST-first z fallbackiem · [ ] `source` w każdej odpowiedzi · [ ] `profile_views`/`who_viewed` **świadomie zostawione na scraperze** · [ ] pomiar cykli Playwrighta przed/po

**Faza 7** — [ ] `organizationAcls` — potwierdzenie roli admina · [ ] 4 moduły org · [ ] 10 narzędzi → 89 · [ ] 5 tabel org · [ ] post testowy jako firma (+ usunięcie) · [ ] `cross-post.mjs` z kolejką · [ ] `auto-engage.mjs` z `target` · [ ] Events/webhooki wg wyniku N3

**Faza 8** — [ ] lookup 11 konkurentów · [ ] `networkSizes` trend · [ ] kalkulator ICP (`audienceCounts`) · [ ] `similarEntities` · [ ] taksonomie w cache · [ ] normalizacja `prospects`/`leads` · [ ] 4 narzędzia → 93

**Faza 9** — [ ] ledger `api_usage` · [ ] throttle + backoff 429 · [ ] cache SQLite z TTL · [ ] circuit breaker · [ ] alarm tokenów · [ ] reanimacja pipeline'u (stoi od 2026-06-24) · [ ] decyzja o przeniesieniu publikacji

**Faza 10** — [ ] API Status · [ ] Analytics API · [ ] Profil API · [ ] Firma · [ ] Market Intel · [ ] Endpoint Explorer · [ ] 8 rozszerzeń istniejących zakładek · [ ] snapshot-test starych route'ów · [ ] każda liczba ma źródło

---

## 17. Bilans

| | Przed | Po |
|---|---|---|
| Narzędzia MCP | 71 | **93** |
| Zakładki dashboardu | 7 | **13** |
| Endpointy REST w użyciu | 3 | **~35** |
| Źródło impressions | ręczny XLSX | **oficjalne API** |
| Wiek danych | **32 dni** | < 24 h |
| Rozbicie reakcji | 25 postów ze 152 | **wszystkie** |
| Karuzele | PDF wrzucany ręcznie | **publikacja przez API** |
| Wideo | brak | **upload + metryki** |
| Company Page | brak | **posty, analityka, followersi, powiadomienia** |
| Market intelligence | brak | **sizing ICP + snapshoty konkurencji** |
| Narzędzia zależne od scrapera | 26 | **19** (7 zmigrowanych, `profile_views`/`who_viewed` świadomie zostają) |
| Liczby bez znanego źródła | wiele | **zero** |
| Usunięte funkcje | — | **zero** |
