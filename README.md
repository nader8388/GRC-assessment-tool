# GRC Assessment Platform — Desktop App

Multi-standard compliance assessment tool for Windows.
Supports 8 standards: ISO 27001:2022, FedRAMP Moderate, SOC 2, NIST CSF 2.0, PCI DSS v4.0, HIPAA Security Rule, FISMA High, FISMA Moderate.

---

## For End Users — Installing the App

1. Download GRC-Assessment-Platform-Setup-1.0.0.exe from the Releases page
2. Double-click it
3. Click Next → Install → Finish

No Node.js, no Python, no Visual Studio, no admin rights required.
The installer bundles everything including SQLite.

Data location: %APPDATA%\GRC Assessment Platform\grc_assessments.db

---

## For Developers — Building the Installer

### Option A: GitHub Actions (Zero Local Setup — Recommended)

Uses a free GitHub-hosted Windows machine. You need no tools installed locally.

Step 1 — Push to GitHub:
  git init
  git add .
  git commit -m "Initial commit"
  git remote add origin https://github.com/YOUR_USERNAME/grc-platform.git
  git push -u origin main

Step 2a — Trigger via tag (creates a GitHub Release automatically):
  git tag v1.0.0
  git push origin v1.0.0

Step 2b — Trigger manually:
  Go to GitHub → Actions → "Build Windows Installer" → Run workflow

Step 3 — Download:
  Actions → latest run → Artifacts → GRC-Assessment-Platform-Installer → extract → run the .exe

The Actions runner already has Node.js and Visual Studio Build Tools. Nothing to configure.

---

### Option B: PowerShell One-Click Build (Local)

Right-click scripts\build.ps1 → Run with PowerShell
  OR
  powershell -ExecutionPolicy Bypass -File scripts\build.ps1

The script automatically installs Node.js and VS Build Tools via winget if they are missing,
compiles the SQLite native module for Electron, and produces the installer.

Requirements: Windows 10/11 (64-bit), internet connection, winget (pre-installed on Win 11).

Output: dist\GRC-Assessment-Platform-Setup-1.0.0.exe

---

## Why Does the Build Need Visual Studio Build Tools?

better-sqlite3 is a native C++ addon. It must be compiled for the exact Electron version being
used. This compilation happens once on the build machine. End users never need any tools —
the compiled binary is bundled inside the installer.

electron-rebuild handles this automatically via the postinstall npm script.
asarUnpack in package.json ensures the .node binary is accessible at runtime.

---

## Project Structure

  grc-desktop/
  .github/workflows/build.yml   GitHub Actions CI/CD
  assets/icon.ico               App icon
  build/installer.nsh           Custom NSIS installer text
  scripts/build.ps1             One-click PowerShell build script
  src/main.js                   Electron main + SQLite + IPC handlers
  src/preload.js                Secure IPC bridge
  src/controls-data.js          All 8 standards and control data
  src/renderer/index.html       Full app UI
  package.json                  Dependencies + electron-builder config

---

## Installer Details

The NSIS installer produced by electron-builder:
  - Bundles the Electron runtime (Chromium + Node.js, ~120 MB)
  - Bundles all npm packages pre-compiled for the bundled Node version
  - Unpacks better-sqlite3 native binary from asar (via asarUnpack)
  - Installs to %LOCALAPPDATA%\Programs\GRC Assessment Platform\
  - Creates Desktop and Start Menu shortcuts
  - Registers an uninstaller in Add/Remove Programs
  - Does NOT require administrator rights
  - Final installer size: approximately 80-120 MB

---

## Features

  Standards:        ISO 27001:2022, FedRAMP Moderate, SOC 2, NIST CSF 2.0,
                    PCI DSS v4.0, HIPAA, FISMA High, FISMA Moderate
  Database:         SQLite via better-sqlite3 (embedded, no install)
  API Key Storage:  Encrypted via Windows DPAPI (safeStorage)
  Excel Export:     4 sheets: Summary, All Controls, Findings, Evidence Log
  JSON Backup:      Per-standard portable backup and restore
  AI Assessment:    Claude API (optional, requires Anthropic API key)
  Appearance:       6 themes, 8 accents, font size, density, border radius
  Admin Rights:     Not required

---

## Setting Up AI Assessment

1. Open the app
2. Click Settings (top right)
3. Go to AI Assessment tab
4. Paste your Anthropic API key (sk-ant-...)
5. Click Save Key

Get a key at console.anthropic.com → API Keys
New accounts get $5 free credit (~hundreds of assessments).

Your key is encrypted with Windows DPAPI and stored in the local database.
It is only transmitted to api.anthropic.com when you click AI Assess.

---

## Troubleshooting

Build fails with node-gyp or MSBuild errors:
  - Ensure VS Build Tools are installed with C++ workload
  - Delete node_modules/ and run npm install again
  - Run: npx @electron/rebuild -f -w better-sqlite3

App shows Database Error on startup:
  - Reinstall from the installer
  - Check write permissions on %APPDATA%\GRC Assessment Platform\

AI Assess returns 401 Unauthorized:
  - API key is invalid or expired
  - Go to Settings → AI Assessment → enter a fresh key

AI Assess fails with network error:
  - Check internet connection
  - api.anthropic.com may be blocked by a corporate firewall
