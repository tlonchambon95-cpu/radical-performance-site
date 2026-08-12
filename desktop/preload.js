/* =====================================================================
   preload.js — pont entre l'interface web et la couche système
   ---------------------------------------------------------------------
   Surface volontairement minuscule : quatre appels, aucun accès direct à
   Node ni au système de fichiers depuis la page. L'interface ne peut rien
   faire d'autre que soumettre un script à exécuter et lire l'état machine.

   La présence de window.RP est ce qui fait basculer index.html en mode
   natif (bloc script 6). Sur le web, l'objet n'existe pas et la page
   garde son comportement de génération de script.
   ===================================================================== */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('RP', {
  native: true,
  version: process.versions.electron,

  /** Exécute un script PowerShell en élévation. */
  apply: (script, revert = false) => ipcRenderer.invoke('rp:apply', { script, revert }),

  /** Résumé matériel réel (lecture seule). */
  machine: () => ipcRenderer.invoke('rp:machine'),

  /** État vérifié de chaque réglage : { state:{id:bool|null}, admin:bool }. */
  state: () => ipcRenderer.invoke('rp:state'),

  /** Processus en cours et entrées de démarrage automatique (lecture seule). */
  processes: () => ipcRenderer.invoke('rp:processes'),

  /** Carte mère, BIOS, processeur, mémoire (lecture seule). */
  hardware: () => ipcRenderer.invoke('rp:hardware'),

  /** Autorise ou empêche une entrée de démarrer avec Windows. Réversible. */
  setStartup: (entree, actif) => ipcRenderer.invoke('rp:setStartup', { entree, actif }),

  /** Goulots matériels que le logiciel ne peut pas corriger. Lecture seule. */
  diagnostic: () => ipcRenderer.invoke('rp:diagnostic'),

  /** Mesure réelle de la latence réseau : RTT, gigue, perte. Lecture seule. */
  ping: () => ipcRenderer.invoke('rp:ping'),

  /** Relevé complet de la machine à l'instant t (état, ping, processus). */
  releve: () => ipcRenderer.invoke('rp:releve'),

  /** Point de référence conservé sur disque : 'poser' | 'lire' | 'effacer'. */
  repere: (action = 'poser') => ipcRenderer.invoke('rp:repere', action),

  /** Rend le HTML fourni en PDF, propose où l'enregistrer, puis l'ouvre. */
  exporterPdf: (html, nomSuggere) => ipcRenderer.invoke('rp:exporterPdf', { html, nomSuggere }),

  /** Catalogue des services allégeables et leur état réel. */
  services: () => ipcRenderer.invoke('rp:services'),

  /** Désactive ou restaure des services nommés. Élévation requise. */
  applyServices: (ids, restaurer = false) => ipcRenderer.invoke('rp:applyServices', { ids, restaurer }),

  /** Liste ce que le mode match fermerait, sans rien fermer. */
  listApps: () => ipcRenderer.invoke('rp:listApps'),

  /** Ferme les applications tierces. Poliment d'abord, en forçant ensuite. */
  closeApps: () => ipcRenderer.invoke('rp:closeApps'),

  /** Relance l'application en administrateur (ferme l'instance courante). */
  elevate: () => ipcRenderer.invoke('rp:elevate'),

  /* ---- Mises à jour ---- */
  version:        () => ipcRenderer.invoke('rp:version'),
  updateCheck:    () => ipcRenderer.invoke('rp:updateCheck'),
  updateDownload: () => ipcRenderer.invoke('rp:updateDownload'),
  updateInstall:  () => ipcRenderer.invoke('rp:updateInstall'),

  /** Flux d'événements de mise à jour. Retourne une fonction de désabonnement. */
  onUpdate: cb => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on('rp:update', h);
    return () => ipcRenderer.removeListener('rp:update', h);
  },

  /** Ouvre l'explorateur sur le journal d'exécution. */
  openLog: p => ipcRenderer.invoke('rp:openLog', p),

  /** Boîte de dialogue native de confirmation. */
  confirm: opts => ipcRenderer.invoke('rp:confirm', opts),

  /** Flux de sortie pendant l'exécution. Retourne une fonction de désabonnement. */
  onLog: cb => {
    const h = (_e, chunk) => cb(chunk);
    ipcRenderer.on('rp:log', h);
    return () => ipcRenderer.removeListener('rp:log', h);
  }
});
