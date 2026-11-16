/* MontajeMX — puente seguro entre la interfaz y el proceso principal. GPL-3.0-or-later. */
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  invoke: (ch, ...a) => ipcRenderer.invoke(ch, ...a),
  send: (ch, ...a) => ipcRenderer.send(ch, ...a),
  on: (ch, fn) => ipcRenderer.on(ch, (e, ...a) => fn(...a)),
  pathOf: (file) => webUtils.getPathForFile(file),
});
