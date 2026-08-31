# markt.digitalisierungsplanung.de

Store und Registry für Preset-Packages von digitalisierungsplanung.de.

## Architektur

Der Markt besitzt **keine eigene Preset-Spezifikation**. Die einzige normative Spezifikation liegt im Hauptprojekt unter `contracts/preset-package.schema.json` und wird ausschließlich über ihre kanonische öffentliche URL konsumiert:

`https://digitalisierungsplanung.de/contracts/preset-package.schema.json`

Es gibt keinen alternativen Schema-Pfad und keinen konfigurierbaren Contract-Fallback. Packages werden vor Veröffentlichung und erneut vor Auslieferung gegen genau diese Spezifikation validiert. Ist sie nicht verfügbar, bleibt die Registry fail-closed und nimmt keine Veröffentlichungen an.

Der Markt ist nicht Teil der Projekt-Runtime. Bereits in Projekte kompilierte Presets funktionieren unabhängig von diesem Dienst.

Die Registry-Daten sind Laufzeitdaten, keine Spezifikation. Sie liegen persistent außerhalb des Git-Checkouts unter `/home/operator/.local/share/dp-market/registry.json`, damit Deployments oder ein erneutes Checkout keine Marktdaten verändern.

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
