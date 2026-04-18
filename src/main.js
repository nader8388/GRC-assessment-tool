'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, nativeTheme } = require('electron');
const { autoUpdater } = require('electron-updater');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

nativeTheme.themeSource = 'dark';

// ── Globals ───────────────────────────────────────────────
let db;
let mainWindow;

// ── Database Init ─────────────────────────────────────────
function initDB() {
  try {
    // When packaged, better-sqlite3 lives in app.asar.unpacked.
    // We must require() from that path directly so the native
    // .node binary can be found by Node's module loader.
    // The bindings package fails inside asar, so we point
    // require() straight at the unpacked copy.
    let Database;

    if (app.isPackaged) {
      const unpackedPath = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        'better-sqlite3'
      );
      // Patch the bindings search path before requiring
      process.env.NODE_PATH = path.join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules'
      );
      // Require directly from unpacked location
      Database = require(unpackedPath);
    } else {
      Database = require('better-sqlite3');
    }

    const dbDir  = app.getPath('userData');
    const dbPath = path.join(dbDir, 'grc_assessments.db');

    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS assessments (
        std_id         TEXT NOT NULL,
        ctrl_id        TEXT NOT NULL,
        status         TEXT DEFAULT '',
        notes          TEXT DEFAULT '',
        finding        TEXT DEFAULT '',
        recommendation TEXT DEFAULT '',
        risk           TEXT DEFAULT '',
        remdate        TEXT DEFAULT '',
        assessor       TEXT DEFAULT '',
        ai_input       TEXT DEFAULT '',
        saved_at       TEXT DEFAULT '',
        PRIMARY KEY (std_id, ctrl_id)
      );

      CREATE TABLE IF NOT EXISTS evidence (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        std_id   TEXT NOT NULL,
        ctrl_id  TEXT NOT NULL,
        artifact TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS meta (
        std_id TEXT NOT NULL,
        key    TEXT NOT NULL,
        value  TEXT DEFAULT '',
        PRIMARY KEY (std_id, key)
      );

      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value BLOB
      );

      CREATE INDEX IF NOT EXISTS idx_evidence_ctrl ON evidence(std_id, ctrl_id);

      CREATE TABLE IF NOT EXISTS users (
        id                   TEXT PRIMARY KEY,
        name                 TEXT NOT NULL,
        username             TEXT NOT NULL UNIQUE,
        role                 TEXT NOT NULL DEFAULT 'assessor',
        password_hash        TEXT NOT NULL,
        salt                 TEXT NOT NULL,
        color                TEXT NOT NULL DEFAULT '',
        created              TEXT NOT NULL,
        last_login           TEXT,
        must_change_password INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id         INTEGER PRIMARY KEY,
        user_id    TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attachments (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        std_id   TEXT NOT NULL,
        ctrl_id  TEXT NOT NULL,
        name     TEXT NOT NULL,
        path     TEXT NOT NULL,
        size     INTEGER NOT NULL DEFAULT 0,
        added    TEXT NOT NULL,
        UNIQUE(std_id, ctrl_id, name)
      );
      CREATE INDEX IF NOT EXISTS idx_attach_ctrl ON attachments(std_id, ctrl_id);

      CREATE TABLE IF NOT EXISTS audit_log (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        ts           TEXT NOT NULL,
        ts_display   TEXT NOT NULL,
        std_id       TEXT NOT NULL,
        std_label    TEXT NOT NULL,
        std_color    TEXT NOT NULL DEFAULT '',
        ctrl_id      TEXT NOT NULL,
        ctrl_name    TEXT NOT NULL,
        field        TEXT NOT NULL,
        from_val     TEXT DEFAULT '',
        to_val       TEXT DEFAULT '',
        status       TEXT DEFAULT '',
        assessor     TEXT DEFAULT '',
        notes_preview TEXT DEFAULT '',
        action       TEXT DEFAULT 'saved'
      );

      CREATE INDEX IF NOT EXISTS idx_audit_ts     ON audit_log(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_std    ON audit_log(std_id);
      CREATE INDEX IF NOT EXISTS idx_audit_ctrl   ON audit_log(ctrl_id);
    `);

    console.log('[DB] Ready:', dbPath);
  } catch (err) {
    const choice = dialog.showMessageBoxSync({
      type:    'error',
      title:   'Database Error',
      message: 'GRC Assessment Platform could not initialize the database.',
      detail:  `Error: ${err.message}\n\nData path: ${app.getPath('userData')}\n\nTry reinstalling from the original installer.`,
      buttons: ['Quit', 'Continue Without Database'],
      defaultId: 0,
    });
    if (choice === 0) { app.quit(); process.exit(1); }
  }
}

// ── Window ────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1440,
    height:    900,
    minWidth:  1100,
    minHeight: 680,
    title:     'GRC Assessment Platform',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,
    },
    show:            false,
    autoHideMenuBar: true,
    icon:            path.join(__dirname, '..', 'assets', 'icon.ico'),
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.openDevTools();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  if (app.isPackaged) mainWindow.setMenu(null);
}

app.whenReady().then(() => {
  initDB();
  createWindow();
  setupAutoUpdater();
});
app.on('window-all-closed', () => {
  if (db) {
    try { db.prepare('DELETE FROM sessions').run(); } catch(e) {}
    try { db.close(); } catch(e) {}
  }
  app.quit();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ════════════════════════════════════════════════════════
//  AUTO-UPDATER
// ════════════════════════════════════════════════════════
function setupAutoUpdater() {
  // Only run in packaged app — skip in dev mode
  if (!app.isPackaged) {
    console.log('[Updater] Skipping auto-update check in development mode');
    return;
  }

  // Configure logging
  autoUpdater.logger = require('electron-log');
  autoUpdater.logger.transports.file.level = 'info';

  // Don't auto-download — let user confirm first
  autoUpdater.autoDownload         = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // electron-builder embeds app-update.yml into the installer with the correct
  // GitHub repo URL taken from GITHUB_REPOSITORY in CI. No hardcoding needed.

  // ── Events ─────────────────────────────────────────
  autoUpdater.on('checking-for-update', () => {
    sendUpdateStatus('checking');
  });

  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus('available', {
      version:      info.version,
      releaseDate:  info.releaseDate,
      releaseNotes: info.releaseNotes || '',
    });
  });

  autoUpdater.on('update-not-available', () => {
    sendUpdateStatus('not-available');
  });

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus('downloading', {
      percent:       Math.round(progress.percent),
      transferred:   formatBytes(progress.transferred),
      total:         formatBytes(progress.total),
      bytesPerSecond:formatBytes(progress.bytesPerSecond) + '/s',
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateStatus('downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    // Don't surface network errors to the user — just log them
    console.error('[Updater] Error:', err.message);
    sendUpdateStatus('error', { message: err.message });
  });

  // Check for updates 5 seconds after launch (let the app fully load first)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(err => {
      console.error('[Updater] Check failed:', err.message);
    });
  }, 5000);
}

function sendUpdateStatus(status, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update:status', { status, ...data });
  }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024)     return bytes + ' B';
  if (bytes < 1048576)  return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ── Update IPC handlers ────────────────────────────────
ipcMain.handle('update:download', () => {
  if (!app.isPackaged) return { ok: false, reason: 'dev' };
  autoUpdater.downloadUpdate();
  return { ok: true };
});

ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('update:check', () => {
  if (!app.isPackaged) return { ok: false, reason: 'dev' };
  autoUpdater.checkForUpdates().catch(() => {});
  return { ok: true };
});

// ════════════════════════════════════════════════════════
//  IPC HANDLERS
// ════════════════════════════════════════════════════════

ipcMain.handle('meta:get', (_, stdId) => {
  if (!db) return {};
  const rows = db.prepare('SELECT key, value FROM meta WHERE std_id = ?').all(stdId);
  const out  = {};
  rows.forEach(r => { out[r.key] = r.value; });
  return out;
});

ipcMain.handle('meta:set', (_, stdId, key, value) => {
  if (!db) return false;
  db.prepare('INSERT OR REPLACE INTO meta (std_id, key, value) VALUES (?,?,?)').run(stdId, key, value);
  return true;
});

ipcMain.handle('assessment:getAll', (_, stdId) => {
  if (!db) return {};
  const rows   = db.prepare('SELECT * FROM assessments WHERE std_id = ?').all(stdId);
  const evRows = db.prepare('SELECT * FROM evidence WHERE std_id = ?').all(stdId);
  const map = {};
  rows.forEach(r => {
    map[r.ctrl_id] = {
      status: r.status, notes: r.notes, finding: r.finding,
      recommendation: r.recommendation, risk: r.risk,
      remdate: r.remdate, assessor: r.assessor, aiInput: r.ai_input,
      evidence: [],
    };
  });
  evRows.forEach(e => {
    if (!map[e.ctrl_id]) map[e.ctrl_id] = { evidence: [] };
    if (!map[e.ctrl_id].evidence) map[e.ctrl_id].evidence = [];
    map[e.ctrl_id].evidence.push(e.artifact);
  });
  return map;
});

ipcMain.handle('assessment:save', (_, stdId, ctrlId, data) => {
  if (!db) return false;
  const { status, notes, finding, recommendation, risk, remdate, assessor, aiInput, evidence } = data;
  db.prepare(`
    INSERT OR REPLACE INTO assessments
      (std_id,ctrl_id,status,notes,finding,recommendation,risk,remdate,assessor,ai_input,saved_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(stdId, ctrlId,
    status||'', notes||'', finding||'', recommendation||'',
    risk||'', remdate||'', assessor||'', aiInput||'',
    new Date().toISOString()
  );
  db.prepare('DELETE FROM evidence WHERE std_id=? AND ctrl_id=?').run(stdId, ctrlId);
  const ins = db.prepare('INSERT INTO evidence (std_id, ctrl_id, artifact) VALUES (?,?,?)');
  (evidence || []).forEach(ev => ins.run(stdId, ctrlId, ev));
  return true;
});

ipcMain.handle('assessment:clear', (_, stdId, ctrlId) => {
  if (!db) return false;
  db.prepare('DELETE FROM assessments WHERE std_id=? AND ctrl_id=?').run(stdId, ctrlId);
  db.prepare('DELETE FROM evidence WHERE std_id=? AND ctrl_id=?').run(stdId, ctrlId);
  return true;
});

ipcMain.handle('assessment:clearAll', (_, stdId) => {
  if (!db) return false;
  db.prepare('DELETE FROM assessments WHERE std_id=?').run(stdId);
  db.prepare('DELETE FROM evidence WHERE std_id=?').run(stdId);
  db.prepare('DELETE FROM meta WHERE std_id=?').run(stdId);
  return true;
});

ipcMain.handle('settings:getApiKey', () => {
  if (!db) return '';
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get('api_key');
    if (!row || !row.value) return '';
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.isBuffer(row.value) ? row.value : Buffer.from(row.value));
    }
    return row.value.toString('utf8');
  } catch (e) { return ''; }
});

ipcMain.handle('settings:setApiKey', (_, key) => {
  if (!db) return { ok: false, error: 'No database' };
  try {
    const stored = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(key)
      : Buffer.from(key, 'utf8');
    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run('api_key', stored);
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('settings:get', (_, key) => {
  if (!db) return '';
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  return row ? row.value.toString() : '';
});

ipcMain.handle('settings:set', (_, key, value) => {
  if (!db) return false;
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)').run(key, value);
  return true;
});

ipcMain.handle('export:excel', async (_, stdId, stdMeta, controlsData) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title:       'Export Assessment Report',
    defaultPath: `GRC_Assessment_${stdId}_${dateStr()}.xlsx`,
    filters:     [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return { ok: false };
  try {
    const XLSX   = require('xlsx');
    const rows   = db ? db.prepare('SELECT * FROM assessments WHERE std_id=?').all(stdId) : [];
    const evRows = db ? db.prepare('SELECT * FROM evidence WHERE std_id=?').all(stdId) : [];
    const evMap  = {};
    evRows.forEach(e => { if (!evMap[e.ctrl_id]) evMap[e.ctrl_id] = []; evMap[e.ctrl_id].push(e.artifact); });
    const aMap = {};
    rows.forEach(r => { aMap[r.ctrl_id] = r; });
    const { controls, std } = controlsData;
    const wb = require('xlsx').utils.book_new();
    const sLabel = {};
    std.statusOptions.forEach(o => { sLabel[o.val] = o.label.replace(/^[✓✗~⚠↔] /, ''); });
    sLabel[''] = 'Not Assessed';
    const counts = {};
    std.statusOptions.forEach(o => { counts[o.val] = 0; });
    rows.forEach(r => { if (r.status && counts[r.status] !== undefined) counts[r.status]++; });
    const tested = Object.values(counts).reduce((a, b) => a + b, 0);
    const sumRows = [
      [`${std.fullName} — GRC ASSESSMENT REPORT`], [],
      ['Organization', stdMeta.org||''], ['Lead Assessor', stdMeta.assessor||''],
      ['Assessment Date', stdMeta.date||''], [std.scopeLabel||'Scope', stdMeta.scope||''],
      ['Standard', std.fullName], ['Generated', new Date().toLocaleString()], [],
      ['ASSESSMENT SUMMARY'], ['Total Controls', controls.length],
      ...std.statusOptions.map((o, i) => [std.statLabels[i], counts[o.val]||0]),
      ['Not Assessed', controls.length - tested],
      ['Completion', ((tested/controls.length)*100).toFixed(1)+'%'],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(sumRows);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');
    const allHdr = ['ID','Control Name',std.groupLabel,'Status','Risk','Assessor','Remediation Date','Notes','Finding','Recommendation','Evidence'];
    const allRows = [allHdr];
    controls.forEach(c => {
      const d = aMap[c.id]||{};
      allRows.push([c.id, c.name, std.groups[c.group]||c.group, sLabel[d.status||'']||'Not Assessed',
        d.risk||'', d.assessor||'', d.remdate||'', d.notes||'', d.finding||'', d.recommendation||'',
        (evMap[c.id]||[]).join('; ')]);
    });
    const wsAll = XLSX.utils.aoa_to_sheet(allRows);
    XLSX.utils.book_append_sheet(wb, wsAll, 'All Controls');
    const negVals = std.statusOptions.filter(o => ['sr','sy','so'].includes(o.cls)).map(o => o.val);
    const findRows = [['ID','Control Name',std.groupLabel,'Status','Finding','Recommendation','Risk','Remediation Date','Assessor']];
    controls.forEach(c => {
      const d = aMap[c.id];
      if (!d || !negVals.includes(d.status)) return;
      findRows.push([c.id, c.name, std.groups[c.group]||c.group, sLabel[d.status]||d.status,
        d.finding||'', d.recommendation||'', d.risk||'', d.remdate||'', d.assessor||'']);
    });
    const wsFind = XLSX.utils.aoa_to_sheet(findRows);
    XLSX.utils.book_append_sheet(wb, wsFind, 'Findings');
    const evOutRows = [['ID','Control Name','Evidence / Artifact']];
    controls.forEach(c => { (evMap[c.id]||[]).forEach(a => evOutRows.push([c.id, c.name, a])); });
    const wsEv = XLSX.utils.aoa_to_sheet(evOutRows);
    XLSX.utils.book_append_sheet(wb, wsEv, 'Evidence Log');
    XLSX.writeFile(wb, filePath);
    return { ok: true, path: filePath };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('export:json', async (_, stdId, stdLabel) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Assessment Backup', defaultPath: `GRC_Backup_${stdId}_${dateStr()}.json`,
    filters: [{ name: 'JSON Backup', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false };
  if (!db) return { ok: false, error: 'Database not available' };
  const rows     = db.prepare('SELECT * FROM assessments WHERE std_id=?').all(stdId);
  const evRows   = db.prepare('SELECT * FROM evidence WHERE std_id=?').all(stdId);
  const metaRows = db.prepare('SELECT key, value FROM meta WHERE std_id=?').all(stdId);
  const metaObj  = {};
  metaRows.forEach(r => { metaObj[r.key] = r.value; });
  fs.writeFileSync(filePath, JSON.stringify({ version:'2.0', stdId, standard:stdLabel,
    exported:new Date().toISOString(), meta:metaObj, assessments:rows, evidence:evRows }, null, 2), 'utf8');
  return { ok: true, path: filePath };
});

ipcMain.handle('import:json', async (_, stdId) => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore Assessment Backup', filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return { ok: false };
  if (!db) return { ok: false, error: 'Database not available' };
  try {
    const payload = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (payload.stdId && payload.stdId !== stdId) {
      const ans = await dialog.showMessageBox(mainWindow, {
        type:'question', buttons:['Import Anyway','Cancel'], title:'Standard Mismatch',
        message:`Backup is from "${payload.standard}" — import into "${stdId}" anyway?`,
      });
      if (ans.response !== 0) return { ok: false };
    }
    const insMeta = db.prepare('INSERT OR REPLACE INTO meta (std_id, key, value) VALUES (?,?,?)');
    Object.entries(payload.meta||{}).forEach(([k,v]) => insMeta.run(stdId, k, v));
    const insA = db.prepare(`INSERT OR REPLACE INTO assessments
      (std_id,ctrl_id,status,notes,finding,recommendation,risk,remdate,assessor,ai_input,saved_at)
      VALUES (@std_id,@ctrl_id,@status,@notes,@finding,@recommendation,@risk,@remdate,@assessor,@ai_input,@saved_at)`);
    (payload.assessments||[]).forEach(r => insA.run({
      std_id:stdId, ctrl_id:r.ctrl_id, status:r.status||'', notes:r.notes||'',
      finding:r.finding||'', recommendation:r.recommendation||'', risk:r.risk||'',
      remdate:r.remdate||'', assessor:r.assessor||'', ai_input:r.ai_input||'', saved_at:r.saved_at||'',
    }));
    db.prepare('DELETE FROM evidence WHERE std_id=?').run(stdId);
    const insE = db.prepare('INSERT INTO evidence (std_id, ctrl_id, artifact) VALUES (?,?,?)');
    (payload.evidence||[]).forEach(e => insE.run(stdId, e.ctrl_id, e.artifact));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
});

ipcMain.handle('app:info', () => ({
  version:  app.getVersion(),
  dataPath: app.getPath('userData'),
  dbPath:   path.join(app.getPath('userData'), 'grc_assessments.db'),
}));

ipcMain.handle('shell:openPath',  (_, p) => shell.openPath(p));
ipcMain.handle('shell:showItem',  (_, p) => shell.showItemInFolder(p));

// ── Users ─────────────────────────────────────────────────
ipcMain.handle('user:count', () => {
  if (!db) return 0;
  return db.prepare('SELECT COUNT(*) as c FROM users').get().c;
});

ipcMain.handle('user:list', () => {
  if (!db) return [];
  return db.prepare('SELECT * FROM users ORDER BY name').all();
});

ipcMain.handle('user:getByUsername', (_, username) => {
  if (!db) return null;
  return db.prepare('SELECT * FROM users WHERE username=?').get(username.toLowerCase()) || null;
});

ipcMain.handle('user:getById', (_, id) => {
  if (!db) return null;
  return db.prepare('SELECT * FROM users WHERE id=?').get(id) || null;
});

ipcMain.handle('user:create', (_, { name, username, role, salt, passwordHash, color, mustChange }) => {
  if (!db) return null;
  const id = crypto.randomUUID();
  db.prepare(`INSERT INTO users (id,name,username,role,password_hash,salt,color,created,must_change_password)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
      id, name, username.toLowerCase(), role, passwordHash, salt,
      color||'', new Date().toISOString(), mustChange ? 1 : 0
    );
  return db.prepare('SELECT * FROM users WHERE id=?').get(id);
});

ipcMain.handle('user:updatePassword', (_, id, salt, passwordHash) => {
  if (!db) return false;
  db.prepare('UPDATE users SET salt=?, password_hash=?, must_change_password=0 WHERE id=?').run(salt, passwordHash, id);
  return true;
});

ipcMain.handle('user:updateLastLogin', (_, id) => {
  if (!db) return false;
  db.prepare('UPDATE users SET last_login=? WHERE id=?').run(new Date().toISOString(), id);
  return true;
});

ipcMain.handle('user:delete', (_, id) => {
  if (!db) return false;
  // Prevent deleting the last admin
  const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='admin'").get().c;
  const user = db.prepare('SELECT role FROM users WHERE id=?').get(id);
  if (user?.role === 'admin' && adminCount <= 1) return false;
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
  return true;
});

// ── Sessions ────────────────────────────────────────────
ipcMain.handle('session:set', (_, userId) => {
  if (!db) return false;
  db.prepare('DELETE FROM sessions').run();  // single active session
  db.prepare('INSERT INTO sessions (user_id, created_at) VALUES (?,?)').run(userId, new Date().toISOString());
  return true;
});

ipcMain.handle('session:get', () => {
  if (!db) return null;
  const row = db.prepare('SELECT user_id FROM sessions ORDER BY created_at DESC LIMIT 1').get();
  if (!row) return null;
  return db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id) || null;
});

ipcMain.handle('session:clear', () => {
  if (!db) return false;
  db.prepare('DELETE FROM sessions').run();
  return true;
});

// ── File Attachments ──────────────────────────────────────
// Files are copied into userData/attachments/<stdId>/<ctrlId>/
// and their metadata (name, size, added) stored in an attachments table.

ipcMain.handle('attach:list', (_, stdId, ctrlId) => {
  if (!db) return [];
  return db.prepare(
    'SELECT name, path, size, added FROM attachments WHERE std_id=? AND ctrl_id=? ORDER BY added DESC'
  ).all(stdId, ctrlId);
});

ipcMain.handle('attach:copy', async (_, stdId, ctrlId, srcPath) => {
  if (!db) return { ok: false, error: 'No database' };
  const MAX = 50 * 1024 * 1024;
  try {
    const stat = fs.statSync(srcPath);
    if (stat.size > MAX) return { ok: false, error: `File too large (max 50 MB): ${path.basename(srcPath)}` };

    const destDir = path.join(app.getPath('userData'), 'attachments', stdId, ctrlId);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const name    = path.basename(srcPath);
    const destPath= path.join(destDir, name);
    fs.copyFileSync(srcPath, destPath);

    db.prepare(`INSERT OR REPLACE INTO attachments (std_id, ctrl_id, name, path, size, added)
      VALUES (?,?,?,?,?,?)`).run(stdId, ctrlId, name, destPath, stat.size, new Date().toISOString());

    return { ok: true, name };
  } catch(e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('attach:pickFiles', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title:      'Select Evidence Files',
    properties: ['openFile', 'multiSelections'],
    filters:    [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Documents', extensions: ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','csv'] },
      { name: 'Images',    extensions: ['png','jpg','jpeg','gif','bmp','svg'] },
    ],
  });
  return result.canceled ? [] : result.filePaths;
});

ipcMain.handle('attach:remove', (_, stdId, ctrlId, name) => {
  if (!db) return false;
  const row = db.prepare(
    'SELECT path FROM attachments WHERE std_id=? AND ctrl_id=? AND name=?'
  ).get(stdId, ctrlId, name);
  if (row) {
    try { fs.unlinkSync(row.path); } catch(e) {}
    db.prepare('DELETE FROM attachments WHERE std_id=? AND ctrl_id=? AND name=?').run(stdId, ctrlId, name);
  }
  return true;
});

// ── Audit Log ─────────────────────────────────────────────
ipcMain.handle('audit:append', (_, entries) => {
  if (!db) return false;
  const ins = db.prepare(`INSERT INTO audit_log
    (ts,ts_display,std_id,std_label,std_color,ctrl_id,ctrl_name,
     field,from_val,to_val,status,assessor,notes_preview,action)
    VALUES (@ts,@ts_display,@std_id,@std_label,@std_color,@ctrl_id,@ctrl_name,
     @field,@from_val,@to_val,@status,@assessor,@notes_preview,@action)`);
  const insertMany = db.transaction(rows => { rows.forEach(r => ins.run(r)); });
  insertMany(entries.map(e => ({
    ts:            e.ts            || new Date().toISOString(),
    ts_display:    e.ts_display    || new Date().toLocaleString(),
    std_id:        e.std_id        || '',
    std_label:     e.std_label     || '',
    std_color:     e.std_color     || '',
    ctrl_id:       e.ctrl_id       || '',
    ctrl_name:     e.ctrl_name     || '',
    field:         e.field         || '',
    from_val:      e.from_val      || '',
    to_val:        e.to_val        || '',
    status:        e.status        || '',
    assessor:      e.assessor      || '',
    notes_preview: e.notes_preview || '',
    action:        e.action        || 'saved',
  })));
  return true;
});

ipcMain.handle('audit:count', () => {
  if (!db) return 0;
  return db.prepare('SELECT COUNT(*) as c FROM audit_log').get().c;
});

ipcMain.handle('audit:query', (_, { search, stdFilter, actFilter, dateFilter }) => {
  if (!db) return [];
  let where = '1=1';
  const params = {};
  if (stdFilter) { where += ' AND std_id=@stdFilter'; params.stdFilter = stdFilter; }
  if (actFilter === 'status')  { where += " AND field='status'"; }
  else if (actFilter === 'notes')   { where += " AND field='notes'"; }
  else if (actFilter === 'finding') { where += " AND field='finding'"; }
  else if (actFilter === 'cleared') { where += " AND action='cleared'"; }
  if (dateFilter) {
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const week  = new Date(now.getFullYear(), now.getMonth(), now.getDate()-7).toISOString();
    const month = new Date(now.getFullYear(), now.getMonth()-1, now.getDate()).toISOString();
    if (dateFilter==='today') { where += ' AND ts>=@sinceDate'; params.sinceDate = today; }
    if (dateFilter==='week')  { where += ' AND ts>=@sinceDate'; params.sinceDate = week; }
    if (dateFilter==='month') { where += ' AND ts>=@sinceDate'; params.sinceDate = month; }
  }
  if (search) {
    where += ` AND (ctrl_id LIKE @s OR ctrl_name LIKE @s OR std_label LIKE @s
              OR field LIKE @s OR from_val LIKE @s OR to_val LIKE @s
              OR assessor LIKE @s OR notes_preview LIKE @s)`;
    params.s = `%${search}%`;
  }
  return db.prepare(
    `SELECT * FROM audit_log WHERE ${where} ORDER BY ts DESC LIMIT 500`
  ).all(params);
});

ipcMain.handle('audit:getStandards', () => {
  if (!db) return [];
  return db.prepare(
    'SELECT DISTINCT std_id, std_label FROM audit_log ORDER BY std_label'
  ).all();
});

ipcMain.handle('audit:info', () => {
  if (!db) return { oldest: null, newest: null };
  const oldest = db.prepare('SELECT ts FROM audit_log ORDER BY ts ASC  LIMIT 1').get();
  const newest = db.prepare('SELECT ts FROM audit_log ORDER BY ts DESC LIMIT 1').get();
  return { oldest: oldest?.ts||null, newest: newest?.ts||null };
});

ipcMain.handle('audit:clear', () => {
  if (!db) return false;
  db.prepare('DELETE FROM audit_log').run();
  return true;
});

ipcMain.handle('audit:exportCSV', async (_, csvContent) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title:       'Save Audit Log',
    defaultPath: `GRC_Audit_Log_${dateStr()}.csv`,
    filters:     [{ name: 'CSV File', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return { ok: false };
  fs.writeFileSync(filePath, csvContent, 'utf8');
  return { ok: true, path: filePath };
});

// ── Native dialog helper ──────────────────────────────────
ipcMain.handle('dialog:confirm', async (_, opts) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type:          'warning',
    title:         opts.title   || 'Confirm',
    message:       opts.message || 'Are you sure?',
    detail:        opts.detail  || '',
    buttons:       opts.buttons || ['Cancel', 'OK'],
    defaultId:     opts.defaultId ?? 0,
    cancelId:      opts.cancelId  ?? 0,
    noLink:        true,
  });
  // Return true if user picked anything other than the cancel button
  return result.response !== (opts.cancelId ?? 0);
});

// ── Database reset (fresh install) ────────────────────────
ipcMain.handle('database:reset', () => {
  if (!db) return false;
  db.prepare('DELETE FROM sessions').run();
  db.prepare('DELETE FROM users').run();
  db.prepare('DELETE FROM assessments').run();
  db.prepare('DELETE FROM evidence').run();
  db.prepare('DELETE FROM meta').run();
  db.prepare('DELETE FROM audit_log').run();
  db.prepare('DELETE FROM attachments').run();
  db.prepare('DELETE FROM settings').run();
  return true;
});

// Combined: shows native dialog in main process, resets if confirmed
// Avoids any renderer-side dialog IPC issues at the login screen
ipcMain.handle('database:resetWithConfirm', async () => {
  const result = await dialog.showMessageBox({
    type:      'warning',
    title:     'Reset Database',
    message:   'Permanently delete ALL data?',
    detail:    'This will delete all user accounts, assessments, audit logs, and settings.\n\nThe app will reload to the account creation screen.\n\nThis cannot be undone.',
    buttons:   ['Cancel', 'Reset Everything'],
    defaultId: 0,
    cancelId:  0,
    noLink:    true,
  });

  if (result.response !== 1) return false;

  if (db) {
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM users').run();
    db.prepare('DELETE FROM assessments').run();
    db.prepare('DELETE FROM evidence').run();
    db.prepare('DELETE FROM meta').run();
    db.prepare('DELETE FROM audit_log').run();
    db.prepare('DELETE FROM attachments').run();
    db.prepare('DELETE FROM settings').run();
  }
  return true;
});

function dateStr() { return new Date().toISOString().slice(0, 10); }
