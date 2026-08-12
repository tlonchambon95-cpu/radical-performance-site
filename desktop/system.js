/* =====================================================================
   system.js — couche système de Radical Performance (processus principal)
   ---------------------------------------------------------------------
   C'est ici, et seulement ici, que l'application touche à Windows.
   Tout le reste (interface, données, verdicts) est du web sans privilège.

   Deux responsabilités :
     1. runElevated() — exécuter un script PowerShell avec élévation UAC
     2. readMachine() — lire l'état réel de la machine (lecture seule)

   Choix assumé : on ne réimplémente pas les 51 réglages en Node. On
   réutilise exactement le script que buildScript() produit déjà côté
   interface. L'application native ne change donc pas *ce qui* est
   appliqué, seulement *comment* : plus de copier-coller manuel.
   Conséquence directe : un réglage corrigé dans index.html l'est aussi
   dans l'application, sans rien toucher ici.
   ===================================================================== */
const { spawn } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const PS = 'powershell.exe';
/* 1223 = ERROR_CANCELLED : l'utilisateur a refusé l'invite UAC */
const USER_CANCELLED = 1223;

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/** Écrit un .ps1 en UTF-8 avec BOM — sans le BOM, PowerShell 5.1 casse les accents */
function writeScript(dir, name, text){
  const p = path.join(dir, name);
  fs.writeFileSync(p, '﻿' + text, 'utf8');
  return p;
}

/**
 * Exécute un script PowerShell en élévation.
 * Une seule invite UAC pour tout le lot. La console élevée reste visible :
 * c'est volontaire — le garde-fou « Taper OUI » des réglages à compromis
 * exige une saisie, et voir défiler les commandes fait partie du contrat
 * de transparence du produit.
 *
 * @param {string}   scriptText  le script généré par buildScript()
 * @param {function} onLine      appelée au fil de l'eau avec le texte produit
 * @returns {Promise<{code:number, cancelled:boolean, log:string, logPath:string}>}
 */
function runElevated(scriptText, onLine = () => {}){
  return new Promise((resolve, reject) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radical-perf-'));
    const id  = stamp();
    const scriptPath = writeScript(dir, `profil-${id}.ps1`, scriptText);
    const logPath    = path.join(dir, `journal-${id}.txt`);

    /* Enveloppe : transcription du déroulé pour pouvoir le rejouer dans l'UI.
       Le script réel est appelé par & pour que son propre `exit` (refus du
       prompt OUI) n'empêche pas la transcription d'être écrite. */
    const wrapper = [
      `$ErrorActionPreference = 'Continue'`,
      `try { Start-Transcript -Path '${logPath}' -Force | Out-Null } catch {}`,
      `& '${scriptPath}'`,
      `$rc = $LASTEXITCODE`,
      `try { Stop-Transcript | Out-Null } catch {}`,
      `Write-Host ""`,
      `Write-Host "  Termine. Cette fenetre peut etre fermee." -ForegroundColor DarkGray`,
      `Start-Sleep -Seconds 2`,
      `exit $rc`
    ].join('\n');
    const wrapperPath = writeScript(dir, `execution-${id}.ps1`, wrapper);

    /* Lanceur non élevé : demande l'élévation puis attend la fin */
    const launcher = [
      `try {`,
      `  $p = Start-Process -FilePath '${PS}' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${wrapperPath}') -Verb RunAs -PassThru -Wait`,
      `  exit $p.ExitCode`,
      `} catch { exit ${USER_CANCELLED} }`
    ].join('\n');

    /* Recopie du transcript vers l'interface pendant l'exécution */
    let sent = 0;
    const tail = setInterval(() => {
      try {
        const buf = fs.readFileSync(logPath, 'utf8');
        if (buf.length > sent){ onLine(buf.slice(sent)); sent = buf.length; }
      } catch { /* le fichier n'existe pas encore */ }
    }, 250);

    const child = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', launcher],
                        { windowsHide: true });

    child.on('error', err => { clearInterval(tail); reject(err); });

    child.on('close', code => {
      clearInterval(tail);
      let log = '';
      try {
        log = fs.readFileSync(logPath, 'utf8');
        if (log.length > sent) onLine(log.slice(sent));
      } catch { /* transcription indisponible */ }
      resolve({
        code,
        cancelled: code === USER_CANCELLED,
        log,
        logPath
      });
    });
  });
}

/* ---------------------------------------------------------------------
   Lecture de l'état réel de la machine — strictement en lecture seule.
   C'est ce que la version web ne peut pas faire : elle affiche un modèle
   théorique (240 Hz, RTT 30 ms), l'application affiche la vraie machine.
   --------------------------------------------------------------------- */
const PROBE = `
$ErrorActionPreference = 'SilentlyContinue'
$os  = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpu = Get-CimInstance Win32_VideoController |
       Where-Object { $_.CurrentHorizontalResolution } | Select-Object -First 1
$plan = (powercfg /getactivescheme) -join ' '
$planName = if ($plan -match '\\(([^)]+)\\)') { $Matches[1] } else { 'inconnu' }
[pscustomobject]@{
  os        = $os.Caption
  build     = $os.BuildNumber
  cpu       = $cpu.Name
  cores     = $cpu.NumberOfCores
  threads   = $cpu.NumberOfLogicalProcessors
  ramGo     = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
  gpu       = $gpu.Name
  hz        = $gpu.CurrentRefreshRate
  largeur   = $gpu.CurrentHorizontalResolution
  hauteur   = $gpu.CurrentVerticalResolution
  planNom   = $planName
  admin     = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
} | ConvertTo-Json -Compress
`;

/**
 * Évalue toutes les sondes en une seule passe PowerShell.
 * Strictement en lecture seule — aucune élévation demandée : les sondes
 * qui exigent l'admin renvoient null plutôt qu'un faux « non appliqué ».
 * @returns {Promise<{state: Object<string, boolean|null>, admin: boolean}|null>}
 */
function readState(){
  const { buildProbeScript } = require('./probes');
  return new Promise(resolve => {
    let out = '';
    const child = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', buildProbeScript()],
                        { windowsHide: true });
    child.stdout.on('data', d => out += d.toString());
    child.on('error', () => resolve(null));
    child.on('close', () => {
      try {
        const o = JSON.parse(out.trim());
        const admin = o.__admin === true;
        delete o.__admin;
        resolve({ state: o, admin });
      } catch { resolve(null); }
    });
  });
}

function readMachine(){
  return new Promise(resolve => {
    let out = '';
    const child = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', PROBE],
                        { windowsHide: true });
    child.stdout.on('data', d => out += d.toString());
    child.on('error', () => resolve(null));
    child.on('close', () => {
      try { resolve(JSON.parse(out.trim())); }
      catch { resolve(null); }
    });
  });
}

module.exports = { runElevated, readMachine, readState, USER_CANCELLED };
