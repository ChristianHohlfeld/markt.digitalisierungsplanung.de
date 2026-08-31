# markt.digitalisierungsplanung.de

Store für Preset-Packages von digitalisierungsplanung.de.

Packages werden gegen `https://digitalisierungsplanung.de/contracts/preset-package.schema.json` validiert. Kein eigenes Schema.

## Admin

Dashboard: [https://markt.digitalisierungsplanung.de/admin](https://markt.digitalisierungsplanung.de/admin)

1. Mit `chris.hohlfeld@gmail.com` anmelden (steht in `ADMIN_EMAILS` auf dem Account-Server).
2. JSON-Paket einfügen, sichtbares Paket wählen (Test / Starter / Team / Unternehmen), veröffentlichen.
3. Im Editor erscheinen nur Presets, die zum gebuchten Paket passen.

CLI, falls nötig, im Hauptprojekt:

```bash
cd ~/digitalisierungsplanung.de
node server/license-admin.js admin EMAIL on
```

Im Markt-Repo leitet derselbe Befehl dorthin weiter:

```bash
node server/license-admin.js admin EMAIL on
```

Token bleiben als Fallback:

- `POST /api/packages` mit `Authorization: Bearer $PUBLISH_TOKEN` → `pending`
- `PATCH /api/admin/packages/:id/status` mit `Authorization: Bearer $ADMIN_TOKEN`
- Admin-Session veröffentlicht sofort als `published`
