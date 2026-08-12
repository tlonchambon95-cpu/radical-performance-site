/* =====================================================================
   diagnostic.js — les problèmes que le logiciel ne peut PAS corriger
   ---------------------------------------------------------------------
   Strictement en LECTURE SEULE.

   Ce module ne règle rien. Il cherche les goulots matériels et de
   configuration qui pèsent bien plus lourd que les 51 réglages réunis :
   une mémoire en simple canal coûte 10 à 15 % de FPS, un jeu sur disque
   mécanique produit des saccades qu'aucune clé de registre ne rattrape.

   RÈGLE ABSOLUE : ne jamais signaler ce qui n'est pas certain.
   Une fausse alerte dans un rapport client détruit la crédibilité plus
   sûrement qu'un diagnostic absent. Deux pièges évités ici :

     - le lien PCIe des cartes NVIDIA retombe en Gen 1 AU REPOS pour
       économiser l'énergie. Lire la valeur courante et crier au scandale
       serait faux : on ne regarde donc que la LARGEUR maximale négociée,
       qui elle révèle un vrai bridage de connecteur.
     - un écran 60 Hz n'est pas forcément mal branché : on ne signale la
       connexion que si elle est effectivement limitante.

   Chaque constat porte son verdict : 'probleme' (perte mesurable),
   'attention' (à vérifier, pas certain), 'ok' (rien à signaler).
   ===================================================================== */
const { spawn } = require('child_process');
const PS = 'powershell.exe';
const UTF8 = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n";

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'
$c = New-Object System.Collections.ArrayList
function Ajouter($id, $titre, $verdict, $constat, $cout, $action){
  [void]$c.Add([pscustomobject]@{ id=$id; titre=$titre; verdict=$verdict; constat=$constat; cout=$cout; action=$action })
}

# ---------- 1. Écran : connexion et fréquence ----------
$tech = @{ 0='VGA'; 1='S-Video'; 2='Composite'; 3='Composante'; 4='DVI'; 5='HDMI';
           6='LVDS'; 8='D-Jpn'; 9='SDI'; 10='DisplayPort'; 11='DisplayPort interne';
           12='UDI'; 13='UDI interne'; 15='Miracast'; 2147483648='Interne' }
$gpu = Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentHorizontalResolution } | Select-Object -First 1
$hz  = [int]$gpu.CurrentRefreshRate
$cons = @(Get-CimInstance -Namespace root\\wmi WmiMonitorConnectionParams |
          ForEach-Object { if ($tech.ContainsKey([int]$_.VideoOutputTechnology)) { $tech[[int]$_.VideoOutputTechnology] } else { 'inconnu' } })
$typeCo = ($cons | Select-Object -Unique) -join ', '

# Le DVI simple lien et le VGA plafonnent en pratique a 1920x1200 @ 60 Hz.
# On ne le signale que si l'ecran tourne effectivement a 60 Hz ou moins :
# au-dela, la connexion n'est manifestement pas limitante.
if ($typeCo -match 'DVI|VGA' -and $hz -le 60){
  Ajouter 'ecran-connexion' "Écran branché en $typeCo" 'probleme' \`
    "Connexion $typeCo a $hz Hz. Le DVI simple lien et le VGA ne depassent pas 1920x1200 en 60 Hz." \`
    "L'ecran est le premier poste de latence de la chaine : une image dure $([math]::Round(1000/[math]::Max($hz,1),1)) ms a $hz Hz, contre 6,9 ms a 144 Hz." \`
    "Verifier si l'ecran et la carte ont une sortie DisplayPort ou HDMI 2.0, et changer de cable avant d'envisager tout autre reglage."
} elseif ($hz -le 60) {
  Ajouter 'ecran-hz' "Écran a $hz Hz" 'probleme' \`
    "Frequence de rafraichissement : $hz Hz (connexion $typeCo)." \`
    "Une image dure $([math]::Round(1000/[math]::Max($hz,1),1)) ms, contre 6,9 ms a 144 Hz. C'est plus que le total des 51 reglages." \`
    "Verifier dans les parametres d'affichage que la frequence maximale de l'ecran est bien selectionnee. Sinon, c'est le materiel qui limite."
} else {
  Ajouter 'ecran-hz' "Écran a $hz Hz" 'ok' "Frequence $hz Hz, connexion $typeCo." '' ''
}

# ---------- 2. Mémoire : canaux et fréquence ----------
$ram = @(Get-CimInstance Win32_PhysicalMemory)
$canaux = @($ram | Group-Object BankLabel).Count
$noteE = ($ram | Measure-Object -Property Speed -Maximum).Maximum
$appl  = ($ram | Measure-Object -Property ConfiguredClockSpeed -Maximum).Maximum
if ($ram.Count -eq 1 -or $canaux -lt 2){
  Ajouter 'ram-canaux' 'Mémoire en simple canal' 'probleme' \`
    "$($ram.Count) barrette(s) repartie(s) sur $canaux canal(aux)." \`
    "Le simple canal divise par deux la bande passante memoire : 10 a 15 % de FPS en moins sur un jeu competitif. Aucun reglage logiciel ne compense." \`
    "Ajouter une barrette identique, ou repartir les barrettes existantes sur les slots A2 et B2 de la carte mere."
} else {
  Ajouter 'ram-canaux' 'Mémoire en double canal' 'ok' "$($ram.Count) barrettes sur $canaux canaux." '' ''
}
if ($noteE -and $appl -and $appl -lt $noteE){
  Ajouter 'ram-xmp' 'Mémoire sous-cadencée' 'probleme' \`
    "Barrettes notees $noteE MT/s, appliquees a $appl MT/s." \`
    "Ecart de $([math]::Round(100*($noteE-$appl)/$noteE)) %. La latence memoire pese directement sur le 1 % low, donc sur les micro-saccades." \`
    "Activer le profil XMP ou EXPO au BIOS. Aucun logiciel ne peut le faire : le profil est lu par le firmware avant Windows."
}

# ---------- 3. Stockage : ou sont les jeux ? ----------
$disques = @{}
foreach ($p in (Get-Partition -EA 0 | Where-Object { $_.DriveLetter })){
  $d = Get-PhysicalDisk -EA 0 | Where-Object { $_.DeviceId -eq (Get-Disk -Number $p.DiskNumber -EA 0).Number }
  if ($d) { $disques["$($p.DriveLetter):"] = $d.MediaType }
}
$chemins = @()
$steam = (Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -Name SteamPath -EA 0).SteamPath
if ($steam) { $chemins += @{ nom='Steam'; chemin=$steam } }
$vdf = if ($steam) { Join-Path $steam 'steamapps\\libraryfolders.vdf' } else { $null }
if ($vdf -and (Test-Path $vdf)){
  foreach ($m in ([regex]::Matches((Get-Content $vdf -Raw), '"path"\\s+"([^"]+)"'))){
    $chemins += @{ nom='Bibliotheque Steam'; chemin=($m.Groups[1].Value -replace '\\\\\\\\','\\') }
  }
}
foreach ($k in 'HKLM:\\SOFTWARE\\WOW6432Node\\Blizzard Entertainment\\Battle.net\\Capabilities',
               'HKLM:\\SOFTWARE\\Epic Games\\EpicGamesLauncher'){
  $v = Get-ItemProperty $k -EA 0
  if ($v.ApplicationIcon) { $chemins += @{ nom='Battle.net'; chemin=(Split-Path $v.ApplicationIcon) } }
  if ($v.AppDataPath)     { $chemins += @{ nom='Epic Games'; chemin=$v.AppDataPath } }
}
$surHdd = @()
foreach ($ch in $chemins){
  $lettre = ($ch.chemin -replace '^([A-Za-z]:).*','$1')
  if ($disques.ContainsKey($lettre) -and $disques[$lettre] -eq 'HDD'){ $surHdd += "$($ch.nom) ($lettre)" }
}
if ($surHdd.Count){
  Ajouter 'jeux-hdd' 'Jeux installés sur disque mécanique' 'probleme' \`
    ("Detecte sur disque mecanique : " + (($surHdd | Select-Object -Unique) -join ', ') + ".") \`
    "Le streaming de textures depuis un disque mecanique produit des saccades en pleine partie et des temps de chargement qui font perdre le debut des manches." \`
    "Deplacer le jeu competitif sur le SSD. C'est le gain le plus important de cette liste apres l'ecran."
} elseif ($chemins.Count) {
  Ajouter 'jeux-hdd' 'Jeux sur SSD' 'ok' ("Lanceurs detectes : " + (($chemins | ForEach-Object { $_.nom }) -join ', ') + ".") '' ''
}
$sysDisque = $disques['C:']
if ($sysDisque -eq 'HDD'){
  Ajouter 'windows-hdd' 'Windows sur disque mécanique' 'probleme' \`
    "Le disque systeme C: est mecanique." \`
    "Tout Windows en souffre : demarrage, chargement, pagination. C'est le premier investissement a faire, avant tout reglage." \`
    "Migrer Windows sur un SSD."
}

# ---------- 4. Lien PCIe de la carte graphique ----------
$smi = Get-Command nvidia-smi.exe -EA 0
if ($smi){
  $l = (& $smi.Source --query-gpu=pcie.link.width.max,pcie.link.gen.max --format=csv,noheader 2>$null) -join ''
  $p = $l -split ',' | ForEach-Object { $_.Trim() }
  $largeur = [int]($p[0]); $gen = [int]($p[1])
  # On ne lit QUE le maximum negocie : la valeur courante retombe en Gen 1
  # au repos par economie d'energie, et la signaler serait une fausse alerte.
  if ($largeur -gt 0 -and $largeur -lt 16){
    Ajouter 'pcie-largeur' "Carte graphique bridée sur x$largeur" 'probleme' \`
      "Lien PCIe negocie au maximum en x$largeur (Gen $gen) au lieu de x16." \`
      "Un lien reduit limite le transfert vers la carte : perte variable selon le jeu, sensible sur les textures haute resolution." \`
      "Verifier que la carte est dans le connecteur x16 principal, et qu'aucun autre peripherique PCIe ne partage ses lignes."
  } else {
    Ajouter 'pcie-largeur' 'Lien PCIe complet' 'ok' "Negocie en x$largeur Gen $gen au maximum." '' ''
  }
}

# ---------- 5. Âge du pilote graphique ----------
if ($gpu.DriverDate){
  $jours = [int]((Get-Date) - $gpu.DriverDate).TotalDays
  if ($jours -gt 365){
    Ajouter 'pilote-gpu' 'Pilote graphique ancien' 'probleme' \`
      "Pilote du $($gpu.DriverDate.ToString('yyyy-MM-dd')), soit $jours jours." \`
      "Les optimisations par jeu et les correctifs de latence arrivent par le pilote. Au-dela d'un an, les jeux recents ne sont pas pris en charge." \`
      "Installer le pilote le plus recent du constructeur, en installation propre."
  } elseif ($jours -gt 180){
    Ajouter 'pilote-gpu' 'Pilote graphique à rafraîchir' 'attention' \`
      "Pilote du $($gpu.DriverDate.ToString('yyyy-MM-dd')), soit $jours jours." \`
      "Sans urgence, mais les optimisations recentes manquent." "Mise a jour conseillee avant une competition."
  } else {
    Ajouter 'pilote-gpu' 'Pilote graphique à jour' 'ok' "Pilote du $($gpu.DriverDate.ToString('yyyy-MM-dd')), $jours jours." '' ''
  }
}

# ---------- 6. Bridage thermique ou électrique ----------
# Evenement 37 de Kernel-Processor-Power : le firmware limite la frequence.
# C'est le signal fiable ; lire une temperature instantanee ne prouve rien.
$ev = @(Get-WinEvent -FilterHashtable @{ LogName='System'; ProviderName='Microsoft-Windows-Kernel-Processor-Power'; Id=37 } -MaxEvents 20 -EA 0)
if ($ev.Count){
  $dernier = $ev[0].TimeCreated
  Ajouter 'bridage' 'Processeur bridé par le firmware' 'probleme' \`
    "$($ev.Count) evenement(s) de limitation, le plus recent le $($dernier.ToString('yyyy-MM-dd HH:mm'))." \`
    "Le processeur a ete ralenti par la carte mere : temperature, limite de puissance ou alimentation insuffisante. Aucun reglage Windows ne passe outre." \`
    "Verifier le refroidissement, la pate thermique et les limites de puissance au BIOS."
} else {
  Ajouter 'bridage' 'Aucun bridage détecté' 'ok' "Aucun evenement de limitation dans le journal systeme." '' ''
}

@{ constats = @($c) } | ConvertTo-Json -Depth 4 -Compress
`;

function readDiagnostic(){
  return new Promise(resolve => {
    let out = '';
    const c = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', UTF8 + SCRIPT], { windowsHide: true });
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', d => out += d);
    c.on('error', () => resolve(null));
    c.on('close', () => { try { resolve(JSON.parse(out.trim())); } catch { resolve(null); } });
  });
}

module.exports = { readDiagnostic };
