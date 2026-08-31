# markt.digitalisierungsplanung.de

Store für Preset-Packages von digitalisierungsplanung.de.

Der Markt besitzt **keine eigene Preset-Spezifikation**. Packages werden gegen `https://digitalisierungsplanung.de/contracts/preset-package.schema.json` validiert.

Die öffentliche Seite ist ein Katalog in der Landing-Sprache: suchen, öffnen, im Editor übernehmen. Admin-Konten mit `is_admin` in der Account-Datenbank sehen **Preset hinzufügen** und veröffentlichen direkt.

## Admin

```bash
node server/license-admin.js admin chris.hohlfeld@gmail.com on
```

läuft im Hauptprojekt `digitalisierungsplanung.de`. Danach reicht die normale Account-Session auf `*.digitalisierungsplanung.de` für Publish.

Token bleiben als Fallback:

- `POST /api/packages` mit `Authorization: Bearer $PUBLISH_TOKEN` → `pending`
- `PATCH /api/admin/packages/:id/status` mit `Authorization: Bearer $ADMIN_TOKEN`
- Admin-Session veröffentlicht sofort als `published`
