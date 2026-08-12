/* =====================================================================
   main.js — processus principal Electron
   ---------------------------------------------------------------------
   Charge l'interface web partagée (../index.html) dans une fenêtre native
   et expose la couche système via IPC. L'interface est le MÊME fichier que
   la version en ligne : une seule source de vérité pour les 51 réglages.
   ===================================================================== */
const electron = require('electron');

/* Garde-fou : si ELECTRON_RUN_AS_NODE est défini, Electron démarre en simple
   Node — pas de fenêtre, et require('electron') renvoie le chemin du binaire
   au lieu de l'API. VS Code pose cette variable pour ses sous-processus, donc
   `npm start` depuis son terminal intégré tombe dedans. Le script npm la
   nettoie déjà ; ce message couvre les lancements manuels. */
if (typeof electron === 'string' || !electron.app){
  console.error(
    '\n  Electron a demarre en mode Node, pas en mode application.\n' +
    '  Cause : la variable ELECTRON_RUN_AS_NODE est definie' +
    (process.env.ELECTRON_RUN_AS_NODE ? ' (= ' + process.env.ELECTRON_RUN_AS_NODE + ').' : '.') +
    '\n  C\'est le cas dans le terminal integre de VS Code.\n\n' +
    '  Corriger avec :  npm start        (le script nettoie la variable)\n' +
    '  Ou manuellement : set ELECTRON_RUN_AS_NODE= && npx electron .\n'
  );
  process.exit(1);
}

const { app, BrowserWindow, ipcMain, shell, dialog } = electron;
const path = require('path');
const { spawn } = require('child_process');
const { runElevated, readMachine, readState, setStartupEntry, scriptStartup,
        listApps, closeApps } = require('./system');

/* Une seule instance : deux fenêtres pourraient appliquer des réglages
   concurrents sur la même machine. */
if (!app.requestSingleInstanceLock()){
  /* Sans ce message, un second lancement se termine en silence et donne
     l'impression que l'application est cassée. */
  console.log('Radical Performance est deja ouvert — la fenetre existante a ete ramenee au premier plan.');
  app.quit();
} else {

let win = null;

const uiPath = () => app.isPackaged
  ? path.join(process.resourcesPath, 'ui', 'index.html')
  : path.join(__dirname, '..', 'index.html');

function createWindow(){
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#060507',      // évite le flash blanc au démarrage
    show: false,
    autoHideMenuBar: true,
    title: 'Radical Performance',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false                 // le preload a besoin de require('electron')
    }
  });

  win.once('ready-to-show', () => win.show());
  win.loadFile(uiPath());

  /* Les liens externes partent dans le navigateur, jamais dans l'app */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.on('closed', () => { win = null; });
}

app.on('second-instance', () => {
  if (win){ if (win.isMinimized()) win.restore(); win.focus(); }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

/* ================= IPC ================= */

/* Une seule exécution à la fois : deux scripts d'optimisation en parallèle
   se marcheraient dessus (mêmes clés de registre, même plan d'alimentation). */
let busy = false;

ipcMain.handle('rp:apply', async (e, { script, revert }) => {
  if (busy) return { ok: false, busy: true };
  if (typeof script !== 'string' || !script.trim()){
    return { ok: false, error: 'Script vide' };
  }
  busy = true;
  try {
    const res = await runElevated(script, chunk => {
      if (win && !win.isDestroyed()) win.webContents.send('rp:log', chunk);
    });
    return {
      ok: !res.cancelled && res.code === 0,
      cancelled: res.cancelled,
      code: res.code,
      logPath: res.logPath,
      revert: !!revert
    };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    busy = false;
  }
});

/* ================= MISES À JOUR =================
   Le client interroge l'URL déclarée dans package.json > build.publish.
   `npm run dist` y dépose trois fichiers : l'installeur, son .blockmap et
   latest.yml. Le .blockmap est ce qui permet le téléchargement différentiel :
   sans lui chaque mise à jour repart pour ~95 Mo, avec lui seuls les blocs
   modifiés transitent. Ne jamais l'oublier à la mise en ligne.

   autoDownload est désactivé : rien ne se télécharge sans un clic. */
const { autoUpdater } = require('electron-updater');
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = false;

const sendUpd = (evt, data = {}) => {
  if (win && !win.isDestroyed()) win.webContents.send('rp:update', Object.assign({ evt }, data));
};

autoUpdater.on('checking-for-update', () => sendUpd('checking'));
autoUpdater.on('update-available',     i => sendUpd('available', { version: i.version, date: i.releaseDate }));
autoUpdater.on('update-not-available', i => sendUpd('none',      { version: i.version }));
autoUpdater.on('error',                e => sendUpd('error',     { message: e && e.message }));
autoUpdater.on('download-progress',    p => sendUpd('progress',  {
  percent: p.percent, transferred: p.transferred, total: p.total, bps: p.bytesPerSecond
}));
autoUpdater.on('update-downloaded',    i => sendUpd('ready',     { version: i.version }));

ipcMain.handle('rp:version', () => ({
  version: app.getVersion(),
  packaged: app.isPackaged
}));

ipcMain.handle('rp:updateCheck', async () => {
  // En développement il n'y a pas d'application installée à remplacer :
  // autoUpdater échouerait sur un dev-app-update.yml absent.
  if (!app.isPackaged){ sendUpd('dev'); return { ok: false, dev: true }; }
  try { await autoUpdater.checkForUpdates(); return { ok: true }; }
  catch (e) { sendUpd('error', { message: e && e.message }); return { ok: false, error: e && e.message }; }
});

ipcMain.handle('rp:updateDownload', async () => {
  try { await autoUpdater.downloadUpdate(); return { ok: true }; }
  catch (e) { sendUpd('error', { message: e && e.message }); return { ok: false, error: e && e.message }; }
});

ipcMain.handle('rp:updateInstall', () => {
  /* quitAndInstall(isSilent, isForceRunAfter)
     isSilent=true : l'installeur NSIS tourne sans interface. Sans ça il
     affiche sa fenêtre ET réclame la fermeture de l'application — trois
     écrans pour ce qui doit être un seul clic. L'installation étant par
     utilisateur (perMachine: false), aucune élévation n'est requise.
     isForceRunAfter=true : l'application se rouvre seule à la fin.
     setImmediate : laisse la réponse IPC partir avant de quitter. */
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return { ok: true };
});

const { readProcesses, readHardware } = require('./inventory');

/* ---- Allègement de Windows ----
   L'état de départ de chaque service est enregistré AVANT modification, dans
   le dossier de données de l'application. La restauration remet exactement ce
   qui était là, pas une valeur par défaut supposée : un service réglé sur
   « Manuel » ne doit pas revenir en « Automatique ». */
const { CATALOGUE, readServices, scriptServices } = require('./services');
const fsp = require('fs');
const sauvegardeServices = () => path.join(app.getPath('userData'), 'services-origine.json');

ipcMain.handle('rp:services', async () => {
  try {
    const r = await readServices();
    let origine = {};
    try { origine = JSON.parse(fsp.readFileSync(sauvegardeServices(), 'utf8')); } catch {}
    return { catalogue: CATALOGUE, ...(r || {}), origine };
  } catch (e) { return { __err: e.message }; }
});

ipcMain.handle('rp:applyServices', async (e, { ids, restaurer }) => {
  if (!Array.isArray(ids) || !ids.length) return { ok: false, error: 'aucun service' };
  let origine = {};
  try { origine = JSON.parse(fsp.readFileSync(sauvegardeServices(), 'utf8')); } catch {}

  if (!restaurer){
    // on ne relève l'état d'origine qu'une fois : une seconde désactivation
    // ne doit pas enregistrer « Disabled » comme état à restaurer
    const etat = await readServices();
    (etat && etat.services || []).forEach(s => {
      if (s.present && ids.includes(s.id) && !(s.id in origine)) origine[s.id] = s.depart;
    });
    try { fsp.writeFileSync(sauvegardeServices(), JSON.stringify(origine, null, 2), 'utf8'); } catch {}
  }

  const script =
    `Write-Host "  ${restaurer ? 'RESTAURATION' : 'ALLEGEMENT'} DE WINDOWS" -ForegroundColor Yellow\n` +
    `Write-Host ""\n` + scriptServices(ids, origine, restaurer) +
    `\nWrite-Host ""\nWrite-Host "  Termine. Un redemarrage rend l'effet complet." -ForegroundColor DarkGray`;

  const res = await runElevated(script, chunk => {
    if (win && !win.isDestroyed()) win.webContents.send('rp:log', chunk);
  });
  if (restaurer){
    ids.forEach(i => delete origine[i]);
    try { fsp.writeFileSync(sauvegardeServices(), JSON.stringify(origine, null, 2), 'utf8'); } catch {}
  }
  return { ok: !res.cancelled && res.code === 0, cancelled: res.cancelled, code: res.code, logPath: res.logPath };
});

const { readPing } = require('./network');
ipcMain.handle('rp:ping', async () => { try { return await readPing(); } catch (e) { return { __err: e.message }; } });

ipcMain.handle('rp:listApps',  async () => { try { return await listApps();  } catch (e) { return { __err: e.message }; } });
ipcMain.handle('rp:closeApps', async () => { try { return await closeApps(); } catch (e) { return { __err: e.message }; } });

/* Une entrée HKLM ou une tâche planifiée exige l'élévation. Si l'application
   n'est pas administrateur, on repasse par runElevated : une invite UAC, la
   console visible, exactement le même chemin que pour les réglages. */
ipcMain.handle('rp:setStartup', async (e, { entree, actif }) => {
  if (!entree || typeof entree.nom !== 'string') return { ok: false, error: 'entrée invalide' };
  try {
    const direct = await setStartupEntry(entree, actif);
    if (direct.ok) return direct;
    if (!entree.admin) return direct;
    const res = await runElevated(
      `Write-Host "  ${actif ? 'Reactivation' : 'Desactivation'} au demarrage : ${String(entree.nom).replace(/"/g, '')}"\n` +
      scriptStartup(entree, actif) +
      `\nWrite-Host "  Termine." -ForegroundColor Green`,
      chunk => { if (win && !win.isDestroyed()) win.webContents.send('rp:log', chunk); }
    );
    return { ok: !res.cancelled && res.code === 0, cancelled: res.cancelled, code: res.code };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('rp:processes', async () => { try { return await readProcesses(); } catch (e) { return { __err: e && e.message }; } });
ipcMain.handle('rp:hardware',  async () => { try { return await readHardware();  } catch (e) { return { __err: e && e.message }; } });

ipcMain.handle('rp:machine', () => readMachine());
ipcMain.handle('rp:state', async () => {
  try { return await readState(); }
  catch (e) {
    // Remonte la cause au lieu de rejeter : un rejet opaque laissait la
    // fenêtre vide et sans message (cas d'un probes.js absent du paquet).
    console.error('readState:', e && e.stack);
    return { __err: e && e.message };
  }
});

/* Relance l'application avec les droits administrateur, puis quitte celle-ci.
   Sans élévation, deux sondes sur vingt-quatre restent illisibles (bcdedit). */
ipcMain.handle('rp:elevate', async () => {
  const exe = process.execPath;
  const args = app.isPackaged ? [] : [path.join(__dirname)];
  const list = [exe, ...args].map(a => `'${a.replace(/'/g, "''")}'`);
  const cmd = `Start-Process -FilePath ${list[0]}` +
              (list.length > 1 ? ` -ArgumentList ${list.slice(1).join(',')}` : '') +
              ` -Verb RunAs`;
  return new Promise(resolve => {
    const child = spawn('powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
      { windowsHide: true, detached: true, stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('spawn', () => {
      // laisse le temps à l'invite UAC de s'afficher avant de fermer l'instance courante
      setTimeout(() => { if (win && !win.isDestroyed()) app.exit(0); }, 1200);
      resolve(true);
    });
    child.unref();
  });
});

ipcMain.handle('rp:openLog', (e, p) => {
  if (typeof p === 'string' && p) shell.showItemInFolder(p);
});

ipcMain.handle('rp:confirm', async (e, { title, message, detail, confirmLabel }) => {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: [confirmLabel || 'Continuer', 'Annuler'],
    defaultId: 1,
    cancelId: 1,
    title: title || 'Confirmation',
    message: message || '',
    detail: detail || ''
  });
  return response === 0;
});

}
