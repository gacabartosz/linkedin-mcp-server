# Macierz zdolności LinkedIn API

Wygenerowane przez `scripts/api-probe.mjs` — realne kody HTTP, nie dokumentacja.

- apka: **org**
- scope'y tokena: `r_1st_connections_size r_basicprofile r_member_postAnalytics r_member_profileAnalytics r_organization_followers r_organization_social r_organization_social_feed rw_organization_admin w_member_social w_member_social_feed w_organization_social w_organization_social_feed`
- wersja API: `202503`

| | HTTP | Endpoint | Wymagany scope | Co daje |
|---|---|---|---|---|
| ❔ | 404 | `/rest/memberCreatorPostAnalytics` | r_member_postAnalytics | agregat wszystkich moich postów |
| ❔ | 404 | `/rest/memberCreatorPostAnalytics` | r_member_postAnalytics | metryki jednego posta |
| ❔ | 404 | `/rest/memberCreatorVideoAnalytics` | r_member_postAnalytics | metryki wideo |
| ❔ | 404 | `/rest/memberFollowersCount` | r_member_profileAnalytics | liczba followersów teraz |
| ❔ | 404 | `/rest/memberFollowersCount` | r_member_profileAnalytics | followersi w czasie |
| ✅ | 200 | `/rest/me` | r_basicprofile | podstawowy profil |
| 🔒 | 403 | `/v2/userinfo` | (brak) | OpenID userinfo — działa na obecnym tokenie |
| ✅ | 200 | `/rest/industries` | r_basicprofile | taksonomia branż |
| ✅ | 200 | `/rest/connections/urn%3Ali%3Aperson%3APHp-Tl1fZw` | r_1st_connections_size | liczba kontaktów 1. stopnia |
| ❌ | 400 | `/rest/posts` | r_organization_social | NIEWIADOMA N1: czy FINDER author działa dla person URN |
| 🔒 | 403 | `/rest/posts/urn%3Ali%3Ashare%3A7485945131297214465` | r_organization_social | pojedynczy post |
| ✅ | 200 | `/rest/socialActions/urn%3Ali%3Ashare%3A7485945131297214465/comments` | w_member_social_feed | komentarze pod postem |
| ✅ | 200 | `/rest/socialActions/urn%3Ali%3Ashare%3A7485945131297214465/likes` | w_member_social_feed | lista lajkujących |
| ✅ | 200 | `/rest/socialMetadata/urn%3Ali%3Ashare%3A7485945131297214465` | w_member_social_feed | PEŁNE rozbicie reakcji |
| ✅ | 200 | `/rest/organizationAcls` | rw_organization_admin | których stron jestem adminem |
| ❌ | 400 | `/rest/eventSubscriptions` | rw_organization_admin | NIEWIADOMA N3: webhooki czy uczestnicy? |
| ❌ | 400 | `/rest/organizationsLookup` | (brak) | NIEWIADOMA N4: dane dowolnej firmy |
| ✅ | 200 | `/rest/adTargetingFacets` | (brak) | NIEWIADOMA N4: wymiary targetowania |
| ✅ | 200 | `/rest/geoTypeahead` | (brak) | NIEWIADOMA N4: taksonomia geo |
| ✅ | 200 | `/rest/seniorities` | (brak) | NIEWIADOMA N4: taksonomia senioralności |

**Legenda:** ✅ działa · 🔒 403 (brak scope/uprawnień) · ❔ 404 (ścieżka lub zasób nie istnieje) · ❌ inny błąd

## Powody odmowy

- `/rest/memberCreatorPostAnalytics` → **404**: No virtual resource found
- `/rest/memberCreatorPostAnalytics` → **404**: No virtual resource found
- `/rest/memberCreatorVideoAnalytics` → **404**: No virtual resource found
- `/rest/memberFollowersCount` → **404**: No virtual resource found
- `/rest/memberFollowersCount` → **404**: No virtual resource found
- `/v2/userinfo` → **403**: Not enough permissions to access: userinfo.GET.NO_VERSION
- `/rest/posts` → **400**: Member permissions must be used when using member as author
- `/rest/posts/urn%3Ali%3Ashare%3A7485945131297214465` → **403**: Accessing the UGC resource is forbidden. Please check your permissions for this resource
- `/rest/eventSubscriptions` → **400**: Parameter 'eventType' is required
- `/rest/organizationsLookup` → **400**: NumberFormatException parsing batch key 'urn:li:organization:1035'
