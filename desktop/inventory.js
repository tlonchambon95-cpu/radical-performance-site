/* =====================================================================
   inventory.js — inventaire de la machine, en LECTURE SEULE
   ---------------------------------------------------------------------
   Deux relevés qui alimentent les modules « Processus » et « BIOS » :

     readProcesses() : ce qui tourne et ce qui démarre automatiquement,
                       classé par impact réellement mesuré
     readHardware()  : carte mère, BIOS, processeur, mémoire

   Comme probes.js, ce fichier ne doit JAMAIS écrire. C'est ce qui permet
   de l'exécuter sur la machine d'un client sans rien engager.

   Sur le compte de processus : il est relevé et affiché parce qu'il parle
   à l'utilisateur, mais ce n'est pas un indicateur de performance. Un
   Windows 11 sain tourne entre 150 et 250 processus, et un processus
   endormi ne coûte rien. Ce qui compte est le temps CPU consommé pendant
   une partie — c'est donc lui qui sert au classement.
   ===================================================================== */
const { spawn } = require('child_process');
const PS = 'powershell.exe';

function run(script){
  return new Promise(resolve => {
    let out = '';
    const child = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
                        { windowsHide: true });
    child.stdout.on('data', d => out += d.toString());
    child.on('error', () => resolve(null));
    child.on('close', () => {
      try { resolve(JSON.parse(out.trim())); } catch { resolve(null); }
    });
  });
}

/* ---------------------------------------------------------------------
   Processus et démarrage automatique
   --------------------------------------------------------------------- */
const SCRIPT_PROC = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
$win = $env:SystemRoot

# --- ce qui tourne, regroupe par nom d'executable ---
$procs = Get-Process | Group-Object ProcessName | ForEach-Object {
  $g = $_.Group
  $chemin = ($g | Where-Object { $_.Path } | Select-Object -First 1).Path
  [pscustomobject]@{
    nom     = $_.Name
    n       = $_.Count
    mo      = [math]::Round((($g | Measure-Object WorkingSet64 -Sum).Sum) / 1MB, 1)
    cpu     = [math]::Round((($g | Measure-Object CPU -Sum).Sum), 0)
    chemin  = $chemin
    systeme = [bool]($chemin -and $chemin.StartsWith($win, 'OrdinalIgnoreCase'))
  }
}

# --- ce qui demarre tout seul ---
$demarrage = New-Object System.Collections.ArrayList

foreach ($k in @(
  @{ p = 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';            s = 'HKLM' },
  @{ p = 'HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'; s = 'HKLM32' },
  @{ p = 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run';            s = 'HKCU' }
)){
  $item = Get-Item $k.p
  if (-not $item) { continue }
  foreach ($nom in $item.GetValueNames()){
    if (-not $nom) { continue }
    [void]$demarrage.Add([pscustomobject]@{
      nom = $nom; type = 'registre'; source = $k.s; cible = [string]$item.GetValue($nom); actif = $true
    })
  }
}

foreach ($d in @([Environment]::GetFolderPath('Startup'), "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\StartUp")){
  if (-not (Test-Path $d)) { continue }
  Get-ChildItem $d -File | Where-Object { $_.Extension -ne '.ini' } | ForEach-Object {
    [void]$demarrage.Add([pscustomobject]@{
      nom = $_.BaseName; type = 'dossier'; source = $d; cible = $_.FullName; actif = $true
    })
  }
}

# Taches planifiees hors Microsoft, declenchees a l'ouverture de session
Get-ScheduledTask | Where-Object {
  $_.TaskPath -notlike '\\Microsoft\\*' -and $_.State -ne 'Disabled' -and
  ($_.Triggers | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' -or $_.CimClass.CimClassName -eq 'MSFT_TaskBootTrigger' })
} | ForEach-Object {
  [void]$demarrage.Add([pscustomobject]@{
    nom = $_.TaskName; type = 'tache'; source = $_.TaskPath; cible = $_.TaskPath + $_.TaskName; actif = $true
  })
}

[pscustomobject]@{
  total     = (Get-Process).Count
  procs     = @($procs)
  demarrage = @($demarrage)
} | ConvertTo-Json -Depth 4 -Compress
`;

function readProcesses(){ return run(SCRIPT_PROC); }

/* ---------------------------------------------------------------------
   Matériel : carte mère, BIOS, processeur, mémoire
   --------------------------------------------------------------------- */
const SCRIPT_HW = `
$ErrorActionPreference = 'SilentlyContinue'
$bb  = Get-CimInstance Win32_BaseBoard
$bio = Get-CimInstance Win32_BIOS
$cs  = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$ram = @(Get-CimInstance Win32_PhysicalMemory)

# Un processeur Intel n'est deverrouille que si sa reference finit par K, KF,
# KS ou X. Tous les Ryzen de bureau le sont. Sans ca, aucun overclock n'est
# possible, ni par logiciel ni par BIOS.
$nom = $cpu.Name.Trim()
$intel = $nom -match 'Intel'
$deverrouille = if ($intel) { [bool]($nom -match '\\d{4,5}[A-Z]*(K|KF|KS|X|XE)\\b') } else { [bool]($nom -match 'Ryzen|Threadripper') }

[pscustomobject]@{
  carteFabricant = $bb.Manufacturer
  carteModele    = $bb.Product
  biosFabricant  = $bio.Manufacturer
  biosVersion    = $bio.SMBIOSBIOSVersion
  biosDate       = if ($bio.ReleaseDate) { $bio.ReleaseDate.ToString('yyyy-MM-dd') } else { $null }
  sysFabricant   = $cs.Manufacturer
  sysModele      = $cs.Model
  cpu            = $nom
  cpuCoeurs      = $cpu.NumberOfCores
  cpuThreads     = $cpu.NumberOfLogicalProcessors
  cpuMaxMhz      = $cpu.MaxClockSpeed
  cpuDeverrouille= $deverrouille
  ramBarrettes   = $ram.Count
  # Speed = vitesse notee sur la barrette ; ConfiguredClockSpeed = vitesse
  # reellement appliquee. Un ecart signifie que le profil XMP/EXPO n'est pas
  # actif : c'est le gain BIOS le plus courant, et il est ici mesurable.
  ramVitesse     = ($ram | Measure-Object -Property Speed -Maximum).Maximum
  ramVitesseNom  = ($ram | Measure-Object -Property ConfiguredClockSpeed -Maximum).Maximum
  ramSlots       = (Get-CimInstance Win32_PhysicalMemoryArray | Select-Object -First 1).MemoryDevices
  ramCanaux      = @($ram | Group-Object -Property BankLabel).Count
} | ConvertTo-Json -Compress
`;

function readHardware(){ return run(SCRIPT_HW); }

module.exports = { readProcesses, readHardware };
