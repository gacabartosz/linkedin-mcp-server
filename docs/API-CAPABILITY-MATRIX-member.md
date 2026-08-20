# Macierz zdolności LinkedIn API

Wygenerowane przez `scripts/api-probe.mjs` — realne kody HTTP, nie dokumentacja.

- apka: **member**
- scope'y tokena: `email,openid,profile,w_member_social`
- wersja API: `202503`

| | HTTP | Endpoint | Wymagany scope | Co daje |
|---|---|---|---|---|
| ❔ | 404 | `/rest/memberCreatorPostAnalytics` | r_member_postAnalytics | agregat wszystkich moich postów |
| ❔ | 404 | `/rest/memberCreatorPostAnalytics` | r_member_postAnalytics | metryki jednego posta |
| ❔ | 404 | `/rest/memberCreatorVideoAnalytics` | r_member_postAnalytics | metryki wideo |

**Legenda:** ✅ działa · 🔒 403 (brak scope/uprawnień) · ❔ 404 (ścieżka lub zasób nie istnieje) · ❌ inny błąd

## Powody odmowy

- `/rest/memberCreatorPostAnalytics` → **404**: No virtual resource found
- `/rest/memberCreatorPostAnalytics` → **404**: No virtual resource found
- `/rest/memberCreatorVideoAnalytics` → **404**: No virtual resource found
