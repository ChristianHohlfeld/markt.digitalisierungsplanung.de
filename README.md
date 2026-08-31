# markt.digitalisierungsplanung.de

Store und Registry für Preset-Packages von digitalisierungsplanung.de.

## Architektur

Der Markt besitzt **keine eigene Preset-Spezifikation**. Die einzige normative Spezifikation liegt im Hauptprojekt:

`https://raw.githubusercontent.com/ChristianHohlfeld/digitalisierungsplanung.de/main/contracts/preset-package.schema.json`

Der Server lädt und kompiliert genau dieses Schema. Packages werden vor Veröffentlichung und erneut vor Auslieferung dagegen validiert. Ist die zentrale Spezifikation nicht verfügbar, startet die Registry in einem fail-closed Zustand und nimmt keine Veröffentlichungen an.

Der Markt ist nicht Teil der Projekt-Runtime. Bereits in Projekte kompilierte Presets funktionieren unabhängig von diesem Dienst.

## Funktionen

- Öffentliche Package-Galerie mit Suche, Kategorie und Sortierung
- Package-Detailansicht inkl. Presets, Publisher, Version und Installationskennung
- REST-Registry: Liste, Details, Manifest, Kategorien, Status
- Publish-Endpunkt mit strikter Validierung gegen die zentrale Spezifikation
- Moderationsstatus `pending`, `published`, `rejected`
- Admin-Freigabe/-Ablehnung
- Persistenz als atomar geschriebene Registry-Datei; kein zweites Schema/keine Model-Runtime
- Security Headers, Origin-Gate, Body-Limit und Rate-Limits
- Responsive UI in der visuellen Sprache der bestehenden Landingpage

## Start

```bash
cp .env.example .env
npm start
```

## API

- `GET /healthz`
- `GET /api/contract`
- `GET /api/packages?q=&category=&sort=newest|name|popular`
- `GET /api/packages/:id`
- `GET /api/packages/:id/manifest`
- `GET /api/categories`
- `POST /api/packages` — Header `Authorization: Bearer $PUBLISH_TOKEN`
- `PATCH /api/admin/packages/:id/status` — Header `Authorization: Bearer $ADMIN_TOKEN`

`POST /api/packages` erwartet das Package selbst als JSON-Body. Der Server akzeptiert nur `schema: "preset-package/1"` und nur Inhalte, die gegen die zentrale Spezifikation gültig sind.
