"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("issuerApi", {
  loadRequest: () => ipcRenderer.invoke("issuer:load-request"),
  pickPrivateKey: () => ipcRenderer.invoke("issuer:pick-private-key"),
  generateKey: (input) => ipcRenderer.invoke("issuer:generate-key", input),
});
