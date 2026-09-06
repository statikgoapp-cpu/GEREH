"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("licenseApi", {
  getStatus: () => ipcRenderer.invoke("desktop:license-status"),
  activate: (key) => ipcRenderer.invoke("desktop:activate-license", key),
  importLicenseFile: () => ipcRenderer.invoke("desktop:import-license-file"),
  autoImportLicense: () => ipcRenderer.invoke("desktop:auto-import-license"),
  exportLicenseRequest: () => ipcRenderer.invoke("desktop:export-license-request"),
  exportActiveLicense: () => ipcRenderer.invoke("desktop:export-active-license"),
  deactivate: () => ipcRenderer.invoke("desktop:deactivate-license"),
  onContext: (cb) => {
    ipcRenderer.on("desktop:license-context", (_event, payload) => cb(payload));
  },
});
