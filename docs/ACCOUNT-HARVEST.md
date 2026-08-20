# Żniwa z konta — co realnie oddaje LinkedIn API

Wygenerowane: `scripts/harvest-account.mjs`. Apka: Community Management API (Development Tier).
Wywołań: 56 | działa: 29/56 | trafień 429: 0

Surowe odpowiedzi: `~/.linkedin-mcp/harvest/`

## profil

| | HTTP | Zasób | Uwaga |
|---|---|---|---|
| ✅ | 200 | me — profil podstawowy |  |
| ✅ | 200 | connections — liczba kontaktów 1. st. |  |

## strona

| | HTTP | Zasób | Uwaga |
|---|---|---|---|
| ✅ | 200 | reklamacje24.pl — dane strony |  |
| ✅ | 200 | reklamacje24.pl — odsłony strony |  |
| ✅ | 200 | reklamacje24.pl — followersi + demografia |  |
| ✅ | 200 | reklamacje24.pl — METRYKI POSTÓW (impressions) |  |
| ✅ | 200 | reklamacje24.pl — posty strony |  |
| ❌ | 500 | reklamacje24.pl — powiadomienia strony | Internal Server Error |
| ❌ | 400 | reklamacje24.pl — vanity URL | Parameter 'vanityUrl' is required |
| ❌ | 400 | reklamacje24.pl — marki podrzędne | Invalid param. Please see errorDetails for more information. |
| ❌ | 400 | reklamacje24.pl — statystyki brand page | Input field validation failure, reason: ERROR ::  :: Invalid Urn format. Invalid prefix. U |
| ❌ | 400 | reklamacje24.pl — analityka wideo | Parameter 'type' is required |
| ❌ | 400 | reklamacje24.pl — followersi (typeahead) | Parameter 'keywords' is required |
| ✅ | 200 | OdpiszNaPismo.pl — dane strony |  |
| ✅ | 200 | OdpiszNaPismo.pl — odsłony strony |  |
| ✅ | 200 | OdpiszNaPismo.pl — followersi + demografia |  |
| ✅ | 200 | OdpiszNaPismo.pl — METRYKI POSTÓW (impressions) |  |
| ✅ | 200 | OdpiszNaPismo.pl — posty strony |  |
| ❌ | 500 | OdpiszNaPismo.pl — powiadomienia strony | Internal Server Error |
| ❌ | 400 | OdpiszNaPismo.pl — vanity URL | Parameter 'vanityUrl' is required |
| ❌ | 400 | OdpiszNaPismo.pl — marki podrzędne | Invalid param. Please see errorDetails for more information. |
| ❌ | 400 | OdpiszNaPismo.pl — statystyki brand page | Input field validation failure, reason: ERROR ::  :: Invalid Urn format. Invalid prefix. U |
| ❌ | 400 | OdpiszNaPismo.pl — analityka wideo | Parameter 'type' is required |
| ❌ | 400 | OdpiszNaPismo.pl — followersi (typeahead) | Parameter 'keywords' is required |
| ✅ | 200 | bartoszgaca.pl — dane strony |  |
| ✅ | 200 | bartoszgaca.pl — odsłony strony |  |
| ✅ | 200 | bartoszgaca.pl — followersi + demografia |  |
| ✅ | 200 | bartoszgaca.pl — METRYKI POSTÓW (impressions) |  |
| ✅ | 200 | bartoszgaca.pl — posty strony |  |
| ❌ | 500 | bartoszgaca.pl — powiadomienia strony | Internal Server Error |
| ❌ | 400 | bartoszgaca.pl — vanity URL | Parameter 'vanityUrl' is required |
| ❌ | 400 | bartoszgaca.pl — marki podrzędne | Invalid param. Please see errorDetails for more information. |
| ❌ | 400 | bartoszgaca.pl — statystyki brand page | Input field validation failure, reason: ERROR ::  :: Invalid Urn format. Invalid prefix. U |
| ❌ | 400 | bartoszgaca.pl — analityka wideo | Parameter 'type' is required |
| ❌ | 400 | bartoszgaca.pl — followersi (typeahead) | Parameter 'keywords' is required |

## intel

| | HTTP | Zasób | Uwaga |
|---|---|---|---|
| ❌ | 400 | networkSizes edgeType=CompanyFollowedByMember | Invalid param. Please see errorDetails for more information. |
| ❌ | 400 | networkSizes edgeType=MemberFollowedByCompany | Invalid param. Please see errorDetails for more information. |
| ❌ | 400 | networkSizes edgeType=CompanyFollowedByCompany | Invalid param. Please see errorDetails for more information. |
| ✅ | 200 | adTargetingFacets — wymiary targetowania |  |
| ✅ | 200 | seniorities — poziomy stanowisk |  |
| ✅ | 200 | functions — funkcje w firmie |  |
| ✅ | 200 | degrees — stopnie naukowe |  |
| ✅ | 200 | iabCategories — kategorie IAB |  |
| ❔ | 404 | skills — umiejętności | No virtual resource found |
| ✅ | 200 | titles — stanowiska |  |
| ✅ | 200 | standardizedTitles |  |
| ✅ | 200 | geoTypeahead — lokalizacje |  |
| ✅ | 200 | industries — branże |  |
| ✅ | 200 | organizationsLookup — dane firm |  |
| ✅ | 200 | adTargetingEntities typeahead |  |

## webhooki

| | HTTP | Zasób | Uwaga |
|---|---|---|---|
| ✅ | 200 | eventSubscriptions eventType=ORGANIZATION_SOCIAL_ACTION_NOTIFICATIONS |  |
| ❌ | 400 | eventSubscriptions eventType=SHARE_STATISTICS | Event [SHARE_STATISTICS] is not supported. Following events are supported [LIVE_VIDEO_COMM |
| ❌ | 400 | eventSubscriptions eventType=ORGANIZATION_LIFECYCLE_EVENTS | Event [ORGANIZATION_LIFECYCLE_EVENTS] is not supported. Following events are supported [LI |

## media

| | HTTP | Zasób | Uwaga |
|---|---|---|---|
| ❌ | 500 | documents — karuzele/PDF | Internal Server Error |
| ❌ | 422 | videos — wideo | Owner [urn:li:company:134844053] is not a sponsored account urn. |
| ❌ | 422 | images — obrazy | Owner [urn:li:company:134844053] is not a sponsored account urn. |

