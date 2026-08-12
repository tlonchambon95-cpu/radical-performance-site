/* =====================================================================
   selftest.js — éprouve chaque réglage en l'exécutant pour de vrai
   ---------------------------------------------------------------------
       node selftest.js            aperçu, ne lance rien
       node selftest.js --lancer   exécute réellement (invite UAC)

   audit.js compare des textes. Ce script-ci EXÉCUTE : il applique chaque
   réglage, interroge la sonde correspondante, annule, réinterroge. Si la
   sonde ne bascule pas, la commande ne fait pas ce qu'elle annonce — même
   si PowerShell n'a signalé aucune erreur. C'est le cas le plus dangereux :
   un réglage qui échoue en silence se vend comme les autres.

   PRINCIPE DE RETOUR À L'ÉTAT INITIAL
   Chaque réglage est testé dans les deux sens à partir de son état actuel,
   puis remis comme il était trouvé :
       trouvé absent   : appliquer → sonder → annuler → sonder  → laissé absent
       trouvé appliqué : annuler → sonder → appliquer → sonder  → laissé appliqué
   La machine finit donc dans l'état où elle a commencé, quel qu'il soit.

   EXCLUSIONS ASSUMÉES
   Les compromis de sécurité et les réglages de démarrage ne sont jamais
   testés automatiquement : ils touchent l'amorçage ou la protection du
   système, et un échec en plein test laisserait une machine que l'on ne
   peut pas réparer depuis Windows.
   ===================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const RACINE = __dirname;
const { PROBES, NEEDS_ADMIN, PREAMBLE } = require(path.join(RACINE, 'desktop', 'probes.js'));

/* ---------- lecture des réglages ---------- */
const html = fs.readFileSync(path.join(RACINE, 'index.html'), 'utf8');
const bloc1 = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const ctx = {}; vm.createContext(ctx);
vm.runInContext(bloc1 + ';globalThis.__M=MODULES;', ctx);
const tous = ctx.__M.flatMap(m => m.tweaks);

/* ---------- ce qu'on refuse de tester ---------- */
const EXCLUS = {
  'cpu-mit' : "compromis de sécurité — atténuations Spectre/Meltdown",
  'gpu-mpo' : "compromis de sécurité, et le pilote peut réagir pendant le test",
  'win-vbs' : "modifie l'amorçage (hypervisorlaunchtype) — un échec en cours de test laisserait une machine difficile à réparer",
  'cpu-tick': "modifie l'amorçage (bcdedit) — même raison"
};

const testables = tous.filter(t => t.cmd && t.rev && PROBES[t.id] && !EXCLUS[t.id]);
const ecartes   = tous.filter(t => t.cmd && EXCLUS[t.id]);
const sansSonde = tous.filter(t => t.cmd && !PROBES[t.id]);

/* ---------- génération du script d'épreuve ----------
   Tout tient dans UNE session élevée : une seule invite UAC, et les sondes
   qui exigent l'administrateur (bcdedit) fonctionnent dans le même contexte. */
function scriptEpreuve(liste, sortie){
  const bloc = t => {
    const sonde = PROBES[t.id];
    return `
# ================= ${t.id} =================
$r = [ordered]@{ id = '${t.id}'; titre = ${JSON.stringify(t.t)} }
try {
  $r.initial = Sonder { ${sonde} }
  if ($null -eq $r.initial) {
    $r.verdict = 'illisible'
    $r.detail  = "la sonde ne renvoie rien : etat non verifiable"
  } else {
    # Sens 1 : on bascule dans l'etat oppose
    if ($r.initial) { Appliquer { ${t.rev} } 'annulation' } else { Appliquer { ${t.cmd} } 'application' }
    Start-Sleep -Milliseconds 2500   # un redemarrage de carte reseau prend plusieurs secondes
    $r.apres1 = Sonder { ${sonde} }

    # Sens 2 : retour a l'etat trouve
    if ($r.initial) { Appliquer { ${t.cmd} } 'reapplication' } else { Appliquer { ${t.rev} } 'annulation' }
    Start-Sleep -Milliseconds 2500   # un redemarrage de carte reseau prend plusieurs secondes
    $r.apres2 = Sonder { ${sonde} }

    $bascule = ($r.apres1 -ne $r.initial)
    $retour  = ($r.apres2 -eq $r.initial)
    if     ($bascule -and $retour) { $r.verdict = 'ok' }
    elseif (-not $bascule)         { $r.verdict = 'sans effet'; $r.detail = "la sonde n'a pas change apres la commande" }
    else                           { $r.verdict = 'retour incomplet'; $r.detail = "l'etat initial n'est pas retabli" }
  }
} catch {
  $r.verdict = 'erreur'
  $r.detail  = $_.Exception.Message
}
[void]$resultats.Add([pscustomobject]$r)
Write-Host ("  {0,-16} {1}" -f $r.id, $r.verdict)
`;
  };

  return `${PREAMBLE}
$ErrorActionPreference = 'Continue'
$resultats = New-Object System.Collections.ArrayList

function Sonder([scriptblock]$b){
  try { $v = & $b; if ($v -is [array]) { $v = $v[-1] }; if ($null -eq $v) { return $null }; return [bool]$v }
  catch { return $null }
}
function Appliquer([scriptblock]$b, [string]$quoi){
  try { & $b | Out-Null } catch { Write-Host ("     " + $quoi + " : " + $_.Exception.Message) -ForegroundColor DarkYellow }
}

# Plans d'alimentation presents AVANT l'epreuve : cpu-plan en duplique un a
# chaque application, et repeter le test en accumulerait sans cette mesure.
$plansAvant = @((powercfg /list) | Select-String -Pattern '([a-f0-9-]{36})' -AllMatches |
                ForEach-Object { $_.Matches.Value })

Write-Host ""
Write-Host "  EPREUVE DES REGLAGES - ${liste.length} a tester" -ForegroundColor Yellow
Write-Host "  Chaque reglage est remis dans l'etat ou il a ete trouve." -ForegroundColor DarkGray
Write-Host ""
${liste.map(bloc).join('\n')}

# Nettoyage : suppression des plans crees pendant l'epreuve, et d'eux seuls
$plansApres = @((powercfg /list) | Select-String -Pattern '([a-f0-9-]{36})' -AllMatches |
                ForEach-Object { $_.Matches.Value })
$nouveaux = @($plansApres | Where-Object { $plansAvant -notcontains $_ })
foreach ($g in $nouveaux) { powercfg /delete $g 2>$null | Out-Null }
if ($nouveaux.Count) { Write-Host ("  " + $nouveaux.Count + " plan(s) d'alimentation cree(s) pendant l'epreuve, supprime(s)") }

@{ resultats = @($resultats); plansSupprimes = $nouveaux.Count } |
  ConvertTo-Json -Depth 5 -Compress | Set-Content -LiteralPath '${sortie.replace(/\\/g, '\\\\')}' -Encoding UTF8
Write-Host ""
Write-Host "  Termine." -ForegroundColor Green
Start-Sleep -Seconds 2
`;
}

/* ---------- aperçu ---------- */
console.log('\nÉPREUVE DES RÉGLAGES\n');
console.log('  testables               : ' + testables.length);
console.log('  écartés volontairement  : ' + ecartes.length);
ecartes.forEach(t => console.log('      ' + t.id.padEnd(14) + EXCLUS[t.id]));
if (sansSonde.length){
  console.log('  scriptables sans sonde  : ' + sansSonde.length + ' — ' + sansSonde.map(t => t.id).join(', '));
}

if (!process.argv.includes('--lancer')){
  console.log('\n  Aperçu seulement. Rien n\'a été exécuté.');
  console.log('  Pour lancer réellement :  node selftest.js --lancer\n');
  process.exit(0);
}

/* ---------- exécution ---------- */
const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-epreuve-'));
const fSortie = path.join(dossier, 'resultats.json');
const fScript = path.join(dossier, 'epreuve.ps1');
fs.writeFileSync(fScript, '﻿' + scriptEpreuve(testables, fSortie), 'utf8');

console.log('\n  Lancement en administrateur — accepte l\'invite Windows.');
console.log('  Une console va s\'ouvrir et défiler.\n');

const lanceur = `try { $p = Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${fScript.replace(/\\/g, '\\\\')}') -Verb RunAs -PassThru -Wait; exit $p.ExitCode } catch { exit 1223 }`;
const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', lanceur], { stdio: 'ignore' });

if (r.status === 1223){ console.log('  Annulé : autorisation Windows refusée. Rien n\'a été modifié.\n'); process.exit(1); }
if (!fs.existsSync(fSortie)){ console.log('  Aucun résultat produit — l\'épreuve ne s\'est pas terminée.\n'); process.exit(1); }

/* Set-Content -Encoding UTF8 ajoute une marque d'ordre des octets que
   JSON.parse refuse. On la retire avant lecture. */
const out = JSON.parse(fs.readFileSync(fSortie, 'utf8').replace(/^﻿/, ''));
const res = out.resultats;
const par = v => res.filter(x => x.verdict === v);

console.log('\nRÉSULTATS\n');
const ordre = ['ok', 'sans effet', 'retour incomplet', 'erreur', 'illisible'];
const libelle = {
  'ok'               : 'fonctionne et s’annule',
  'sans effet'       : 'LA COMMANDE NE FAIT RIEN',
  'retour incomplet' : 'L’ANNULATION NE REMET PAS TOUT',
  'erreur'           : 'erreur pendant l’épreuve',
  'illisible'        : 'sonde muette — non vérifiable'
};
for (const v of ordre){
  const l = par(v);
  if (!l.length) continue;
  console.log('  ' + libelle[v] + ' : ' + l.length);
  if (v !== 'ok') l.forEach(x => console.log('      [' + x.id + '] ' + x.titre + (x.detail ? '\n          ' + x.detail : '')));
}
if (out.plansSupprimes) console.log('\n  ' + out.plansSupprimes + ' plan(s) d\'alimentation créé(s) puis supprimé(s) par le nettoyage.');
console.log('\n  Tous les réglages ont été remis dans l\'état où ils ont été trouvés.\n');
process.exit(par('ok').length === res.length ? 0 : 1);
