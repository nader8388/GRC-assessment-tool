'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, nativeTheme } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Force dark title bar ──────────────────────────────────
nativeTheme.themeSource = 'dark';

// ── Native module path resolution ────────────────────────
// When packaged by electron-builder, native .node files live in
// app.asar.unpacked so they can be loaded by Node.  We tell
// better-sqlite3 where to find its binary.
function getNativeModulePath() {
  if (app.isPackaged) {
    // Packaged: asar.unpacked keeps native binaries accessible
    return path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'better-sqlite3');
  }
  return path.join(__dirname, '..', 'node_modules', 'better-sqlite3');
}

// ── Globals ───────────────────────────────────────────────
let db;
let mainWindow;

// ── Database Init ─────────────────────────────────────────
function initDB() {
  try {
    const nativePath = getNativeModulePath();
    const Database = require(path.join(nativePath, 'lib', 'index.js'));

    const dbDir  = path.join(app.getPath('userData'));
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
    `);

    console.log('[DB] Ready:', dbPath);
  } catch (err) {
    // Show a clear error and let user decide to quit or continue without DB
    const choice = dialog.showMessageBoxSync({
      type: 'error',
      title: 'Database Error',
      message: 'GRC Assessment Platform could not initialize the database.',
      detail: `Error: ${err.message}\n\nData path: ${app.getPath('userData')}\n\nThis may happen if the app was installed incorrectly. Try reinstalling from the original installer.`,
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
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Remove default menu in production
  if (app.isPackaged) {
    mainWindow.setMenu(null);
  }
}

// ── App lifecycle ─────────────────────────────────────────
app.whenReady().then(() => {
  initDB();
  createWindow();
});

app.on('window-all-closed', () => {
  if (db) { try { db.close(); } catch(e) {} }
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ════════════════════════════════════════════════════════
//  IPC HANDLERS
// ════════════════════════════════════════════════════════

function requireDB(handler) {
  return async (event, ...args) => {
    if (!db) return { ok: false, error: 'Database not available' };
    return handler(event, ...args);
  };
}

// ── Meta ──────────────────────────────────────────────────
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

// ── Assessment ────────────────────────────────────────────
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

// ── Settings / API Key ────────────────────────────────────
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

// ── Excel Export ──────────────────────────────────────────
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

    const evMap = {};
    evRows.forEach(e => {
      if (!evMap[e.ctrl_id]) evMap[e.ctrl_id] = [];
      evMap[e.ctrl_id].push(e.artifact);
    });
    const aMap = {};
    rows.forEach(r => { aMap[r.ctrl_id] = r; });

    const { controls, std } = controlsData;
    const wb = XLSX.utils.book_new();

    // Status label map
    const sLabel = {};
    std.statusOptions.forEach(o => { sLabel[o.val] = o.label.replace(/^[✓✗~⚠↔] /, ''); });
    sLabel[''] = 'Not Assessed';

    // Counts
    const counts = {};
    std.statusOptions.forEach(o => { counts[o.val] = 0; });
    rows.forEach(r => { if (r.status && counts[r.status] !== undefined) counts[r.status]++; });
    const tested = Object.values(counts).reduce((a, b) => a + b, 0);

    // ── Summary sheet ──
    const sumRows = [
      [`${std.fullName} — GRC ASSESSMENT REPORT`], [],
      ['Organization',           stdMeta.org      || ''],
      ['Lead Assessor',          stdMeta.assessor || ''],
      ['Assessment Date',        stdMeta.date     || ''],
      [std.scopeLabel || 'Scope', stdMeta.scope   || ''],
      ['Standard',               std.fullName],
      ['Generated',              new Date().toLocaleString()], [],
      ['ASSESSMENT SUMMARY'],
      ['Total Controls',         controls.length],
      ...std.statusOptions.map((o, i) => [std.statLabels[i], counts[o.val] || 0]),
      ['Not Assessed',           controls.length - tested],
      ['Completion',             ((tested / controls.length) * 100).toFixed(1) + '%'],
      [], ['GROUP BREAKDOWN'],
      [std.groupLabel, 'Name', 'Total', ...std.statLabels, 'Not Assessed'],
    ];

    const gs = {};
    controls.forEach(c => {
      const g = c.group;
      if (!gs[g]) { gs[g] = { name: std.groups[g] || g, total: 0 }; std.statusOptions.forEach(o => { gs[g][o.val] = 0; }); }
      gs[g].total++;
      const d = aMap[c.id];
      if (d && d.status && gs[g][d.status] !== undefined) gs[g][d.status]++;
    });
    Object.entries(gs).forEach(([g, f]) => {
      const t2 = std.statusOptions.reduce((a, o) => a + (f[o.val] || 0), 0);
      sumRows.push([g, f.name, f.total, ...std.statusOptions.map(o => f[o.val] || 0), f.total - t2]);
    });
    const wsSummary = XLSX.utils.aoa_to_sheet(sumRows);
    wsSummary['!cols'] = [{ wch: 28 }, { wch: 46 }, { wch: 10 }, ...std.statusOptions.map(() => ({ wch: 14 })), { wch: 13 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    // ── All Controls ──
    const allHdr = ['ID', 'Control Name', std.groupLabel, 'Status', 'Risk', 'Assessor', 'Remediation Date', 'Notes', 'Finding', 'Recommendation', 'Evidence'];
    const allRows = [allHdr];
    controls.forEach(c => {
      const d = aMap[c.id] || {};
      allRows.push([
        c.id, c.name, std.groups[c.group] || c.group, sLabel[d.status || ''] || 'Not Assessed',
        d.risk || '', d.assessor || '', d.remdate || '', d.notes || '',
        d.finding || '', d.recommendation || '', (evMap[c.id] || []).join('; '),
      ]);
    });
    const wsAll = XLSX.utils.aoa_to_sheet(allRows);
    wsAll['!cols'] = [{ wch: 16 }, { wch: 50 }, { wch: 30 }, { wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 40 }, { wch: 45 }, { wch: 40 }, { wch: 45 }];
    XLSX.utils.book_append_sheet(wb, wsAll, 'All Controls');

    // ── Findings ──
    const negVals = std.statusOptions.filter(o => ['sr', 'sy', 'so'].includes(o.cls)).map(o => o.val);
    const findRows = [['ID', 'Control Name', std.groupLabel, 'Status', 'Finding', 'Recommendation', 'Risk', 'Remediation Date', 'Assessor']];
    controls.forEach(c => {
      const d = aMap[c.id];
      if (!d || !negVals.includes(d.status)) return;
      findRows.push([c.id, c.name, std.groups[c.group] || c.group, sLabel[d.status] || d.status, d.finding || '', d.recommendation || '', d.risk || '', d.remdate || '', d.assessor || '']);
    });
    const wsFind = XLSX.utils.aoa_to_sheet(findRows);
    wsFind['!cols'] = [{ wch: 16 }, { wch: 50 }, { wch: 28 }, { wch: 22 }, { wch: 50 }, { wch: 45 }, { wch: 10 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsFind, 'Findings');

    // ── Evidence ──
    const evOutRows = [['ID', 'Control Name', 'Evidence / Artifact']];
    controls.forEach(c => { (evMap[c.id] || []).forEach(a => evOutRows.push([c.id, c.name, a])); });
    const wsEv = XLSX.utils.aoa_to_sheet(evOutRows);
    wsEv['!cols'] = [{ wch: 16 }, { wch: 50 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(wb, wsEv, 'Evidence Log');

    XLSX.writeFile(wb, filePath);
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── JSON Backup ───────────────────────────────────────────
ipcMain.handle('export:json', async (_, stdId, stdLabel) => {
  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title:       'Save Assessment Backup',
    defaultPath: `GRC_Backup_${stdId}_${dateStr()}.json`,
    filters:     [{ name: 'JSON Backup', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { ok: false };

  if (!db) return { ok: false, error: 'Database not available' };

  const rows     = db.prepare('SELECT * FROM assessments WHERE std_id=?').all(stdId);
  const evRows   = db.prepare('SELECT * FROM evidence WHERE std_id=?').all(stdId);
  const metaRows = db.prepare('SELECT key, value FROM meta WHERE std_id=?').all(stdId);
  const metaObj  = {};
  metaRows.forEach(r => { metaObj[r.key] = r.value; });

  fs.writeFileSync(filePath, JSON.stringify({
    version: '2.0', stdId, standard: stdLabel,
    exported: new Date().toISOString(),
    meta: metaObj, assessments: rows, evidence: evRows,
  }, null, 2), 'utf8');

  return { ok: true, path: filePath };
});

ipcMain.handle('import:json', async (_, stdId) => {
  const { filePaths, canceled } = await dialog.showOpenDialog(mainWindow, {
    title:      'Restore Assessment Backup',
    filters:    [{ name: 'JSON Backup', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return { ok: false };
  if (!db) return { ok: false, error: 'Database not available' };

  try {
    const payload = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));

    if (payload.stdId && payload.stdId !== stdId) {
      const ans = await dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Import Anyway', 'Cancel'],
        title: 'Standard Mismatch',
        message: `Backup is from "${payload.standard}" — import into "${stdId}" anyway?`,
      });
      if (ans.response !== 0) return { ok: false };
    }

    const insMeta = db.prepare('INSERT OR REPLACE INTO meta (std_id, key, value) VALUES (?,?,?)');
    Object.entries(payload.meta || {}).forEach(([k, v]) => insMeta.run(stdId, k, v));

    const insA = db.prepare(`INSERT OR REPLACE INTO assessments
      (std_id,ctrl_id,status,notes,finding,recommendation,risk,remdate,assessor,ai_input,saved_at)
      VALUES (@std_id,@ctrl_id,@status,@notes,@finding,@recommendation,@risk,@remdate,@assessor,@ai_input,@saved_at)`);
    (payload.assessments || []).forEach(r => insA.run({
      std_id: stdId, ctrl_id: r.ctrl_id,
      status: r.status || '', notes: r.notes || '', finding: r.finding || '',
      recommendation: r.recommendation || '', risk: r.risk || '',
      remdate: r.remdate || '', assessor: r.assessor || '',
      ai_input: r.ai_input || '', saved_at: r.saved_at || '',
    }));

    db.prepare('DELETE FROM evidence WHERE std_id=?').run(stdId);
    const insE = db.prepare('INSERT INTO evidence (std_id, ctrl_id, artifact) VALUES (?,?,?)');
    (payload.evidence || []).forEach(e => insE.run(stdId, e.ctrl_id, e.artifact));

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── App info ──────────────────────────────────────────────
ipcMain.handle('app:info', () => ({
  version:  app.getVersion(),
  dataPath: app.getPath('userData'),
  dbPath:   path.join(app.getPath('userData'), 'grc_assessments.db'),
}));

ipcMain.handle('shell:openPath',  (_, p) => shell.openPath(p));
ipcMain.handle('shell:showItem',  (_, p) => shell.showItemInFolder(p));

// ── Utils ─────────────────────────────────────────────────
function dateStr() { return new Date().toISOString().slice(0, 10); }
