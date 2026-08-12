/* =====================================================================
   network.js — mesure réelle de la latence réseau, en LECTURE SEULE
   ---------------------------------------------------------------------
   Remplace la constante « RTT 30 ms » du modèle par un relevé.

   Ce qui est mesuré, et ce que ça vaut :

     - la PASSERELLE isole le réseau domestique. Un temps élevé ici
       (Wi-Fi, CPL, switch saturé) se paie sur toutes les connexions, et
       aucun réglage Windows ne le rattrapera.
     - deux résolveurs publics ANYCAST donnent le plancher de la liaison
       vers Internet : c'est le mieux que la connexion puisse faire.

   Limite à annoncer, jamais à cacher : ce n'est PAS le ping d'un serveur
   de jeu. Un serveur de partie est plus loin, et le trafic de jeu est en
   UDP alors qu'on mesure en ICMP — certains équipements traitent les deux
   différemment. La mesure donne le plancher de la connexion, pas la
   latence en partie. L'interface le dit.

   La GIGUE compte davantage que la moyenne : un ping stable à 40 ms se
   joue mieux qu'un ping à 25 ms qui saute à 90. Elle est donc calculée
   comme l'écart moyen entre deux paquets consécutifs.
   ===================================================================== */
const { spawn } = require('child_process');
const PS = 'powershell.exe';
const UTF8 = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n";

const SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'

# Passerelle portant la route par defaut : le premier saut reel
$gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' |
       Sort-Object RouteMetric, ifMetric | Select-Object -First 1).NextHop

$cibles = @()
if ($gw -and $gw -ne '0.0.0.0') { $cibles += @{ nom = 'Passerelle'; hote = $gw; local = $true } }
$cibles += @{ nom = 'Cloudflare'; hote = '1.1.1.1'; local = $false }
$cibles += @{ nom = 'Google';     hote = '8.8.8.8'; local = $false }

$res = foreach ($c in $cibles){
  $envois = 12
  $p = Test-Connection -ComputerName $c.hote -Count $envois -ErrorAction SilentlyContinue
  $t = @($p | ForEach-Object { [double]$_.ResponseTime })
  if ($t.Count -eq 0){
    [pscustomobject]@{ nom=$c.nom; hote=$c.hote; local=$c.local; joignable=$false }
    continue
  }
  # Gigue : ecart moyen entre deux paquets consecutifs (approche RFC 3550)
  $g = 0.0
  if ($t.Count -gt 1){
    $s = 0.0
    for ($i = 1; $i -lt $t.Count; $i++){ $s += [math]::Abs($t[$i] - $t[$i-1]) }
    $g = $s / ($t.Count - 1)
  }
  [pscustomobject]@{
    nom       = $c.nom
    hote      = $c.hote
    local     = $c.local
    joignable = $true
    min       = [math]::Round(($t | Measure-Object -Minimum).Minimum, 1)
    moy       = [math]::Round(($t | Measure-Object -Average).Average, 1)
    max       = [math]::Round(($t | Measure-Object -Maximum).Maximum, 1)
    gigue     = [math]::Round($g, 1)
    perte     = [math]::Round(100 * ($envois - $t.Count) / $envois, 0)
    envois    = $envois
    recus     = $t.Count
  }
}

$net = @($res | Where-Object { -not $_.local -and $_.joignable })
[pscustomobject]@{
  cibles    = @($res)
  # plancher de la connexion : la meilleure des cibles publiques
  rtt       = if ($net.Count) { ($net | Measure-Object -Property moy -Minimum).Minimum } else { $null }
  gigue     = if ($net.Count) { ($net | Measure-Object -Property gigue -Minimum).Minimum } else { $null }
  perte     = if ($net.Count) { ($net | Measure-Object -Property perte -Maximum).Maximum } else { $null }
} | ConvertTo-Json -Depth 4 -Compress
`;

function readPing(){
  return new Promise(resolve => {
    let out = '';
    const c = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', UTF8 + SCRIPT], { windowsHide: true });
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', d => out += d);
    c.on('error', () => resolve(null));
    c.on('close', () => { try { resolve(JSON.parse(out.trim())); } catch { resolve(null); } });
  });
}

module.exports = { readPing };
