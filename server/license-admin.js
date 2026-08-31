#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

const target = process.env.ACCOUNT_ADMIN || "/home/operator/digitalisierungsplanung.de/server/license-admin.js";

if (existsSync(target)) {
  const child = spawn(process.execPath, [target, ...process.argv.slice(2)], { stdio: "inherit" });
  child.on("exit", code => process.exit(code ?? 1));
} else {
  console.error([
    "Admin für den Markt läuft über das Account-Konto, nicht über ein Extra-Token.",
    "",
    "Einfach:",
    "  1. Mit chris.hohlfeld@gmail.com anmelden",
    "  2. https://markt.digitalisierungsplanung.de/admin öffnen",
    "",
    "Oder im Hauptprojekt:",
    "  cd ~/digitalisierungsplanung.de",
    "  node server/license-admin.js admin EMAIL on"
  ].join("\n"));
  process.exit(2);
}
