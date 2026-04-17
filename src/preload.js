'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Meta
  getMeta:          (stdId)               => ipcRenderer.invoke('meta:get', stdId),
  setMeta:          (stdId, key, value)   => ipcRenderer.invoke('meta:set', stdId, key, value),

  // Assessment data
  getAll:           (stdId)               => ipcRenderer.invoke('assessment:getAll', stdId),
  save:             (stdId, id, data)     => ipcRenderer.invoke('assessment:save', stdId, id, data),
  clear:            (stdId, id)           => ipcRenderer.invoke('assessment:clear', stdId, id),
  clearAll:         (stdId)               => ipcRenderer.invoke('assessment:clearAll', stdId),

  // Settings / API key
  getApiKey:        ()                    => ipcRenderer.invoke('settings:getApiKey'),
  setApiKey:        (key)                 => ipcRenderer.invoke('settings:setApiKey', key),
  getSetting:       (key)                 => ipcRenderer.invoke('settings:get', key),
  setSetting:       (key, val)            => ipcRenderer.invoke('settings:set', key, val),

  // Export
  exportExcel:      (stdId, meta, data)   => ipcRenderer.invoke('export:excel', stdId, meta, data),
  exportJSON:       (stdId, label)        => ipcRenderer.invoke('export:json', stdId, label),
  importJSON:       (stdId)               => ipcRenderer.invoke('import:json', stdId),

  // File attachments
  attachList:       (stdId, ctrlId)       => ipcRenderer.invoke('attach:list', stdId, ctrlId),
  attachCopy:       (stdId, ctrlId, src)  => ipcRenderer.invoke('attach:copy', stdId, ctrlId, src),
  attachPickFiles:  ()                    => ipcRenderer.invoke('attach:pickFiles'),
  attachRemove:     (stdId, ctrlId, name) => ipcRenderer.invoke('attach:remove', stdId, ctrlId, name),

  // Audit log
  auditAppend:      (entries)             => ipcRenderer.invoke('audit:append', entries),
  auditCount:       ()                    => ipcRenderer.invoke('audit:count'),
  auditQuery:       (filters)             => ipcRenderer.invoke('audit:query', filters),
  auditGetStandards:()                    => ipcRenderer.invoke('audit:getStandards'),
  auditInfo:        ()                    => ipcRenderer.invoke('audit:info'),
  auditClear:       ()                    => ipcRenderer.invoke('audit:clear'),
  auditExportCSV:   (csv)                 => ipcRenderer.invoke('audit:exportCSV', csv),

  // App
  appInfo:          ()                    => ipcRenderer.invoke('app:info'),
  openPath:         (p)                   => ipcRenderer.invoke('shell:openPath', p),
  showInFolder:     (p)                   => ipcRenderer.invoke('shell:showItem', p),
});
