/* =====================================================================
   probes.js — lecture de l'état réel de chaque réglage
   ---------------------------------------------------------------------
   Une sonde par réglage automatisable : une expression PowerShell qui
   répond vrai (le réglage est en place) ou faux (il ne l'est pas).

   STRICTEMENT EN LECTURE SEULE. Aucune sonde ne doit modifier quoi que
   ce soit — c'est la règle qui rend ce fichier testable sans risque.

   Trois états possibles par réglage :
     true   appliqué et vérifié
     false  absent
     null   indéterminable (droits insuffisants, matériel absent)
   Le null est essentiel : afficher « non appliqué » alors qu'on n'a pas
   pu lire serait un mensonge, et c'est exactement ce que le produit
   reproche aux autres outils.

   Les 17 réglages manuels (BIOS, pilote, en jeu) et les 11 mythes n'ont
   pas de sonde : ils ne sont pas applicables par le programme.
   check.js vérifie qu'aucun réglage scriptable n'a été oublié ici.
   ===================================================================== */

/* Sondes exigeant l'élévation : bcdedit refuse la lecture sans admin.
   Sans ce marquage, on lirait « absent » au lieu de « inconnu ». */
const NEEDS_ADMIN = new Set(['cpu-tick', 'win-vbs']);

const PROBES = {

  /* ---------- Processeur ---------- */
  // Le plan « Performances ultimes » est dupliqué à l'application : son GUID
  // change d'une machine à l'autre. On teste donc le nom du plan actif.
  'cpu-plan': `[bool](((powercfg /getactivescheme) -join ' ') -match 'Performances ultimes|Ultimate Performance')`,

  // Parking désactivé = minimum de cœurs à 100 % et throttle minimum à 100 %
  'cpu-park': `(AcIdx 'SUB_PROCESSOR' '0cc5b647-c1df-4637-891a-dec35c318583') -eq 100 -and
               (AcIdx 'SUB_PROCESSOR' '893dee8e-2bef-41e0-89c6-b55d0929964c') -eq 100`,

  'cpu-prio': `(RegVal 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' 'Win32PrioritySeparation') -eq 38`,

  'cpu-mit':  `(RegVal 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management' 'FeatureSettingsOverride') -eq 3`,

  'cpu-tick': `[bool](((bcdedit /enum '{current}') -join ' ') -match 'disabledynamictick\\s+Yes')`,

  /* ---------- Carte graphique ---------- */
  'gpu-hags': `(RegVal 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' 'HwSchMode') -eq 2`,

  // Deux clés posées ensemble par le réglage : les deux doivent l'être
  'gpu-dvr':  `(RegVal 'HKCU:\\System\\GameConfigStore' 'GameDVR_Enabled') -eq 0 -and
               (RegVal 'HKLM:\\SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR' 'AllowGameDVR') -eq 0`,

  'gpu-mpo':  `(RegVal 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm' 'OverlayTestMode') -eq 5`,

  /* ---------- Mémoire ---------- */
  'ram-bg':      `(RegVal 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\BackgroundAccessApplications' 'GlobalUserDisabled') -eq 1`,

  'ram-sysmain': `$s = Get-Service SysMain -ErrorAction SilentlyContinue
                  if ($s) { $s.StartType -eq 'Disabled' } else { $null }`,

  /* ---------- Connexion ---------- */
  // Le réglage écrit sur toutes les interfaces : une seule suffit à le prouver
  'net-nagle': `$p = 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces'
                $n = @(Get-ChildItem $p -ErrorAction SilentlyContinue | Where-Object {
                        (Get-ItemProperty $_.PSPath -Name TcpAckFrequency -ErrorAction SilentlyContinue).TcpAckFrequency -eq 1 })
                $n.Count -gt 0`,

  'net-throttle': `$k = 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile'
                   (RegVal $k 'NetworkThrottlingIndex') -eq 4294967295 -and (RegVal $k 'SystemResponsiveness') -eq 10`,

  // On teste la propriété la plus représentative du lot désactivé par le réglage
  'net-nic': `$nic = ActiveNic
              if (-not $nic) { $null } else {
                $v = @(Get-NetAdapterAdvancedProperty -Name $nic.Name -ErrorAction SilentlyContinue |
                       Where-Object { $_.DisplayName -match 'Energy-Efficient Ethernet|Green Ethernet|Efficient Ethernet' })
                if ($v.Count -eq 0) { $null } else { [bool](@($v | Where-Object { $_.DisplayValue -match 'Disabled|Désactivé' }).Count -eq $v.Count) }
              }`,

  'net-tcp': `$t = Get-NetTCPSetting -SettingName Internet -ErrorAction SilentlyContinue
              if (-not $t) { $null } else { $t.AutoTuningLevelLocal -eq 'Normal' -and $t.CongestionProvider -eq 'CUBIC' }`,

  // Le réglage impose 1.1.1.1 EN PREMIER. Un simple « contient » répondrait
  // vrai alors que le DNS de la box reste primaire et sert toutes les requêtes.
  'net-dns': `$nic = ActiveNic
              if (-not $nic) { $null } else {
                $d = @((Get-DnsClientServerAddress -InterfaceIndex $nic.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses)
                if ($d.Count -eq 0) { $false } else { $d[0] -eq '1.1.1.1' }
              }`,

  /* ---------- Système ---------- */
  'win-vbs': `$hv = [bool](((bcdedit /enum '{current}') -join ' ') -match 'hypervisorlaunchtype\\s+Off')
              $ci = RegVal 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity' 'Enabled'
              $hv -and ($null -eq $ci -or $ci -eq 0)`,

  // Valeurs stockées en chaînes de caractères, pas en DWord
  'win-mouse':  `(RegVal 'HKCU:\\Control Panel\\Mouse' 'MouseSpeed') -eq '0' -and
                 (RegVal 'HKCU:\\Control Panel\\Mouse' 'MouseThreshold1') -eq '0'`,

  'win-notif':  `(RegVal 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\PushNotifications' 'ToastEnabled') -eq 0`,

  'win-visual': `(RegVal 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects' 'VisualFXSetting') -eq 2`,

  /* ---------- Alimentation ---------- */
  'pwr-usb':  `(AcIdx '2a737441-1930-4402-8d77-b2bebba308a3' '48e6b7a6-50f5-4782-a5d4-53bb8f07e226') -eq 0`,

  'pwr-pcie': `(AcIdx '501a4d13-42af-4429-9fd1-a8218c268e20' 'ee12f906-d277-404b-b6da-e5fa1a576df5') -eq 0`,

  'pwr-fast': `(RegVal 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power' 'HiberbootEnabled') -eq 0`,

  // SUB_SLEEP / STANDBYIDLE et SUB_VIDEO / VIDEOIDLE, en secondes
  'pwr-sleep': `(AcIdx '238c9fa8-0aad-41ed-83f4-97be242c8f20' '29f6c1db-86da-48c5-9fdb-f2b67b1f44da') -eq 0 -and
                (AcIdx '7516b95f-f776-4464-8c53-06167f40cc99' '3c0bc021-c8a8-4e07-a973-6b14cbcb2b7e') -eq 0`,

  /* ---------- Détectable bien que manuel ----------
     Ethernet actif et aucun Wi-Fi connecté : lisible sans intervention. */
  'net-eth': `$eth = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' -and $_.PhysicalMediaType -notlike '*802.11*' })
              $wifi = @(Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' -and $_.PhysicalMediaType -like '*802.11*' })
              $eth.Count -gt 0 -and $wifi.Count -eq 0`
};

/* Fonctions d'aide partagées par les sondes. */
const PREAMBLE = `
$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference    = 'SilentlyContinue'

$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# Valeur de registre, ou $null si la clé ou la valeur n'existe pas
function RegVal($path, $name){
  $i = Get-ItemProperty -Path $path -Name $name -ErrorAction SilentlyContinue
  if ($null -eq $i) { return $null }
  return $i.$name
}

# Index d'alimentation SECTEUR d'un paramètre du plan actif.
# powercfg /query liste min, max, incrément, puis secteur, puis batterie :
# l'avant-dernière valeur hexadécimale est donc toujours celle du secteur,
# quelle que soit la langue de Windows — parser les libellés serait fragile.
function AcIdx($sub, $setting){
  $o = powercfg /query SCHEME_CURRENT $sub $setting 2>$null
  if (-not $o) { return $null }
  $m = [regex]::Matches(($o -join "\`n"), '0x[0-9a-fA-F]{8}')
  if ($m.Count -lt 2) { return $null }
  return [Convert]::ToInt64($m[$m.Count - 2].Value, 16)
}

# Carte réseau réellement utilisée pour sortir sur Internet.
# On l'identifie par la route par défaut et non par « première carte active » :
# les cartes virtuelles (VMware, VirtualBox, Hyper-V, VPN) sont « Up » elles
# aussi et passent souvent en premier, ce qui ferait sonder la mauvaise carte.
function ActiveNic {
  $idx = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
          Sort-Object RouteMetric, ifMetric | Select-Object -First 1).InterfaceIndex
  if ($idx) {
    $n = Get-NetAdapter -InterfaceIndex $idx -ErrorAction SilentlyContinue
    if ($n -and $n.Status -eq 'Up') { return $n }
  }
  return Get-NetAdapter -ErrorAction SilentlyContinue |
         Where-Object { $_.Status -eq 'Up' -and $_.PhysicalMediaType -notlike '*802.11*' -and $_.Virtual -eq $false } |
         Select-Object -First 1
}
`;

/**
 * Construit le script qui évalue toutes les sondes en une seule passe
 * et renvoie un objet JSON { id: true | false | null }.
 */
function buildProbeScript(){
  let s = PREAMBLE + '\n$r = [ordered]@{}\n';
  for (const [id, expr] of Object.entries(PROBES)){
    const admin = NEEDS_ADMIN.has(id);
    s += `\n$r['${id}'] = $null\n`;
    s += `try {\n`;
    if (admin) s += `  if ($IsAdmin) {\n`;
    s += `  $v = $(${expr})\n`;
    // Une expression PowerShell peut produire plusieurs valeurs : on garde la dernière
    s += `  if ($v -is [array]) { $v = $v[-1] }\n`;
    s += `  if ($null -ne $v) { $r['${id}'] = [bool]$v }\n`;
    if (admin) s += `  }\n`;
    s += `} catch {}\n`;
  }
  s += `\n$r['__admin'] = $IsAdmin\n$r | ConvertTo-Json -Compress\n`;
  return s;
}

module.exports = { PROBES, NEEDS_ADMIN, buildProbeScript };
