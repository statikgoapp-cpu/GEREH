"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  getLicenseStatus: () => ipcRenderer.invoke("desktop:license-status"),
  activateLicense: (key) => ipcRenderer.invoke("desktop:activate-license", key),
  checkUpdates: () => ipcRenderer.invoke("desktop:check-updates"),
  onUpdateStatus: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("desktop:update-status", listener);
    return () => ipcRenderer.removeListener("desktop:update-status", listener);
  },
});
