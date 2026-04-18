'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Meta
  getMeta:              (stdId)               => ipcRenderer.invoke('meta:get', stdId),
  setMeta:              (stdId, key, value)   => ipcRenderer.invoke('meta:set', stdId, key, value),

  // Assessment data
  getAll:               (stdId)               => ipcRenderer.invoke('assessment:getAll', stdId),
  save:                 (stdId, id, data)     => ipcRenderer.invoke('assessment:save', stdId, id, data),
  clear:                (stdId, id)           => ipcRenderer.invoke('assessment:clear', stdId, id),
  clearAll:             (stdId)               => ipcRenderer.invoke('assessment:clearAll', stdId),

  // Settings / API key
  getApiKey:            ()                    => ipcRenderer.invoke('settings:getApiKey'),
  setApiKey:            (key)                 => ipcRenderer.invoke('settings:setApiKey', key),
  getSetting:           (key)                 => ipcRenderer.invoke('settings:get', key),
  setSetting:           (key, val)            => ipcRenderer.invoke('settings:set', key, val),

  // Users
  userCount:            ()                    => ipcRenderer.invoke('user:count'),
  userList:             ()                    => ipcRenderer.invoke('user:list'),
  userGetByUsername:    (username)            => ipcRenderer.invoke('user:getByUsername', username),
  userGetById:          (id)                  => ipcRenderer.invoke('user:getById', id),
  userCreate:           (data)               => ipcRenderer.invoke('user:create', data),
  userUpdatePassword:   (id, salt, hash)      => ipcRenderer.invoke('user:updatePassword', id, salt, hash),
  userUpdateLastLogin:  (id)                  => ipcRenderer.invoke('user:updateLastLogin', id),
  userDelete:           (id)                  => ipcRenderer.invoke('user:delete', id),

  // Sessions
  sessionSet:           (userId)              => ipcRenderer.invoke('session:set', userId),
  sessionGet:           ()                    => ipcRenderer.invoke('session:get'),
  sessionClear:         ()                    => ipcRenderer.invoke('session:clear'),

  // File attachments
  attachList:           (stdId, ctrlId)       => ipcRenderer.invoke('attach:list', stdId, ctrlId),
  attachCopy:           (stdId, ctrlId, src)  => ipcRenderer.invoke('attach:copy', stdId, ctrlId, src),
  attachPickFiles:      ()                    => ipcRenderer.invoke('attach:pickFiles'),
  attachRemove:         (stdId, ctrlId, name) => ipcRenderer.invoke('attach:remove', stdId, ctrlId, name),

  // Audit log
  auditAppend:          (entries)             => ipcRenderer.invoke('audit:append', entries),
  auditCount:           ()                    => ipcRenderer.invoke('audit:count'),
  auditQuery:           (filters)             => ipcRenderer.invoke('audit:query', filters),
  auditGetStandards:    ()                    => ipcRenderer.invoke('audit:getStandards'),
  auditInfo:            ()                    => ipcRenderer.invoke('audit:info'),
  auditClear:           ()                    => ipcRenderer.invoke('audit:clear'),
  auditExportCSV:       (csv)                 => ipcRenderer.invoke('audit:exportCSV', csv),

  // Auto-updater
  updateDownload:       ()                    => ipcRenderer.invoke('update:download'),
  updateInstall:        ()                    => ipcRenderer.invoke('update:install'),
  updateCheck:          ()                    => ipcRenderer.invoke('update:check'),

  // Database management
  databaseReset:        ()                    => ipcRenderer.invoke('database:reset'),
  confirmDialog:        (opts)               => ipcRenderer.invoke('dialog:confirm', opts),

  // App
  appInfo:              ()                    => ipcRenderer.invoke('app:info'),
  openPath:             (p)                   => ipcRenderer.invoke('shell:openPath', p),
  showInFolder:         (p)                   => ipcRenderer.invoke('shell:showItem', p),
});

// Push-based update status (main -> renderer)
// Exposed separately so renderer can subscribe with a callback
contextBridge.exposeInMainWorld('electronAPI', {
  onUpdateStatus: (callback) =>
    ipcRenderer.on('update:status', (_event, data) => callback(data)),
});
