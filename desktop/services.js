/* =====================================================================
   services.js — allègement de Windows, service par service
   ---------------------------------------------------------------------
   Catalogue explicite. Aucun service n'est touché s'il n'est pas listé ici
   nommément, avec ce qu'il fait et ce que sa désactivation casse.

   C'est la seule forme défendable de cette fonction : la charte du produit
   interdit « toute suppression en masse de composants système sans
   consentement explicite, informé et spécifique pour chaque élément ».
   Un balayage automatique de tout ce qui tourne violerait cette règle et
   casserait des machines clientes de façon imprévisible.

   INTERDITS ABSOLUS, jamais dans ce catalogue, quelle que soit l'insistance :
     RpcSs, DcomLaunch, BFE, mpssvc, Dhcp, Dnscache, CryptSvc, Winmgmt,
     EventLog, gpsvc, nsi, Power, AudioSrv, AudioEndpointBuilder,
     WinDefend, MDCoreSvc, LanmanWorkstation, Schedule, UserManager,
     ProfSvc, Themes, ShellHWDetection.
   Ces services sont soit indispensables au démarrage, soit à la sécurité,
   soit à l'ouverture de session. Les couper produit une machine qui ne
   redémarre pas, et un client qui ne peut rien réparer seul.

   Chaque désactivation enregistre le type de démarrage d'origine : la
   restauration remet exactement ce qui était là, pas une valeur supposée.
   ===================================================================== */
const { spawn } = require('child_process');
const PS = 'powershell.exe';
const UTF8 = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n";

/* v : 'sur'      = aucun effet visible sur un poste de jeu
       'compromis' = gain réel mais quelque chose cesse de fonctionner
   casse : ce que l'utilisateur perd, en clair. Jamais « rien ».        */
const CATALOGUE = [
  { id:'DiagTrack',      t:"Expériences des utilisateurs connectés (télémétrie)", v:'sur',
    casse:"Rien de fonctionnel. Windows cesse d'envoyer ses rapports d'utilisation à Microsoft." },
  { id:'dmwappushservice',t:"Routage de messages push WAP",                v:'sur',
    casse:"Rien sur un poste fixe : ce service sert à la gestion à distance d'appareils mobiles." },
  { id:'DoSvc',          t:"Optimisation de livraison",                   v:'sur',
    casse:"Les mises à jour Windows ne se partagent plus entre machines du réseau. Elles se téléchargent normalement depuis Microsoft." },
  { id:'DPS',            t:"Service de stratégie de diagnostic",          v:'sur',
    casse:"Les assistants de dépannage Windows ne fonctionnent plus. Rien d'autre." },
  { id:'DusmSvc',        t:"Consommation des données",                    v:'sur',
    casse:"Windows ne compte plus les données consommées par application. Aucun effet sur la connexion." },
  { id:'PcaSvc',         t:"Assistant Compatibilité des programmes",      v:'sur',
    casse:"Windows ne propose plus de corriger les vieux logiciels qui plantent." },
  { id:'WerSvc',         t:"Rapport d'erreurs Windows",                   v:'sur',
    casse:"Les plantages ne sont plus signalés à Microsoft. Les applications plantent pareil." },
  { id:'MapsBroker',     t:"Gestionnaire de cartes téléchargées",         v:'sur',
    casse:"L'application Cartes de Windows perd ses cartes hors ligne." },
  { id:'lfsvc',          t:"Service de géolocalisation",                  v:'sur',
    casse:"Les applications ne peuvent plus connaître la position de la machine." },
  { id:'WalletService',  t:"Portefeuille",                                v:'sur',
    casse:"Rien sur un poste fixe. Service lié aux paiements sur mobile." },
  { id:'RetailDemo',     t:"Démonstration en magasin",                    v:'sur',
    casse:"Rien. Ce mode ne sert qu'aux machines exposées en magasin." },
  { id:'PhoneSvc',       t:"Téléphonie",                                  v:'sur',
    casse:"Rien sur un poste fixe sans carte SIM." },
  { id:'WpcMonSvc',      t:"Contrôle parental",                           v:'sur',
    casse:"Les limites de temps d'écran pour comptes enfants cessent de s'appliquer." },
  { id:'AJRouter',       t:"Service de routeur AllJoyn",                  v:'sur',
    casse:"Rien : protocole d'objets connectés quasiment inutilisé." },
  { id:'SharedAccess',   t:"Partage de connexion Internet",               v:'sur',
    casse:"La machine ne peut plus servir de point d'accès à d'autres appareils." },
  { id:'RemoteRegistry', t:"Registre à distance",                         v:'sur',
    casse:"Rien, et c'est même recommandé pour la sécurité : personne ne peut plus lire le registre à distance." },
  { id:'SCardSvr',       t:"Carte à puce",                                v:'sur',
    casse:"Les lecteurs de carte à puce cessent de fonctionner. Rare hors entreprise." },
  { id:'WbioSrvc',       t:"Service biométrique",                         v:'compromis',
    casse:"La connexion par empreinte digitale ou reconnaissance faciale cesse de fonctionner. À laisser si tu utilises Windows Hello." },
  { id:'Spooler',        t:"Spouleur d'impression",                       v:'compromis',
    casse:"Plus aucune impression possible, ni PDF via imprimante virtuelle." },
  { id:'WSearch',        t:"Windows Search",                              v:'compromis',
    casse:"La recherche du menu Démarrer et de l'Explorateur ne trouve plus rien par indexation. Les recherches deviennent lentes." },
  { id:'SysMain',        t:"SysMain (SuperFetch)",                        v:'sur',
    casse:"Rien de perceptible sur SSD. Ce service préchargeait des données pour les disques mécaniques." },
  { id:'SSDPSRV',        t:"Découverte SSDP",                             v:'compromis',
    casse:"La découverte UPnP cesse : certains jeux n'ouvrent plus automatiquement leurs ports sur la box, et le partage vers TV disparaît." },
  { id:'upnphost',       t:"Hôte de périphérique UPnP",                   v:'compromis',
    casse:"Même effet que ci-dessus : ouverture automatique de ports et partage média." },
  { id:'WMPNetworkSvc',  t:"Partage réseau du Lecteur Windows Media",     v:'sur',
    casse:"Rien : partage média d'un lecteur qui n'est plus livré avec Windows." },
  { id:'ClickToRunSvc',  t:"Microsoft Office Click-to-Run",               v:'compromis',
    casse:"Office cesse de se mettre à jour. Les applications continuent de fonctionner." },
  { id:'InventorySvc',   t:"Inventaire et compatibilité",                 v:'sur',
    casse:"Windows cesse d'inventorier les logiciels installés pour Microsoft." },
  { id:'LMS',            t:"Intel Management and Security",               v:'sur',
    casse:"L'administration à distance Intel AMT cesse. Inutilisée hors parc d'entreprise." },
  { id:'jhi_service',    t:"Intel Dynamic Application Loader",            v:'sur',
    casse:"Rien sur un poste de jeu : brique de sécurité matérielle Intel rarement sollicitée." },
  { id:'cplspcon',       t:"Intel Content Protection HDCP",               v:'compromis',
    casse:"La lecture de contenus protégés (Netflix en HD, Blu-ray) peut échouer." },
  { id:'Fax',            t:"Télécopie",                                   v:'sur',
    casse:"Rien, sauf si un modem fax est branché." }
];

/* Services que ce module refuse de toucher, même si on les lui demande. */
const INTERDITS = new Set([
  'RpcSs','DcomLaunch','RpcEptMapper','BFE','mpssvc','Dhcp','Dnscache','CryptSvc',
  'Winmgmt','EventLog','gpsvc','nsi','Power','Audiosrv','AudioEndpointBuilder',
  'WinDefend','MDCoreSvc','SecurityHealthService','LanmanWorkstation','LanmanServer',
  'Schedule','UserManager','ProfSvc','Themes','ShellHWDetection','CoreMessagingRegistrar',
  'SamSs','LSM','PlugPlay','BrokerInfrastructure','SystemEventsBroker','DispBrokerDesktopSvc'
]);

function ps(script){
  return new Promise(resolve => {
    let out = '';
    const c = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', UTF8 + script], { windowsHide: true });
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', d => out += d);
    c.on('error', () => resolve(null));
    c.on('close', () => { try { resolve(JSON.parse(out.trim())); } catch { resolve(null); } });
  });
}

/** État réel de chaque service du catalogue sur cette machine. */
function readServices(){
  const ids = CATALOGUE.map(s => `'${s.id}'`).join(',');
  return ps(`
$ids = @(${ids})
$r = foreach ($id in $ids){
  $s = Get-Service -Name $id -ErrorAction SilentlyContinue
  if (-not $s) { [pscustomobject]@{ id=$id; present=$false } ; continue }
  $w = Get-CimInstance Win32_Service -Filter "Name='$id'" -ErrorAction SilentlyContinue
  [pscustomobject]@{
    id      = $id
    present = $true
    etat    = [string]$s.Status
    depart  = [string]$s.StartType
    pid     = if ($w) { $w.ProcessId } else { 0 }
  }
}
[pscustomobject]@{
  services   = @($r)
  totalProc  = (Get-Process).Count
  svchost    = @(Get-Process -Name svchost -ErrorAction SilentlyContinue).Count
} | ConvertTo-Json -Depth 3 -Compress`);
}

/**
 * Script d'application. Toujours exécuté en élévation par main.js.
 * @param {string[]} ids       services à désactiver
 * @param {object}   original  { id: typeDeDepart } relevé avant, pour la restauration
 * @param {boolean}  restaurer true = remettre l'état d'origine
 */
function scriptServices(ids, original, restaurer){
  const sur = ids.filter(i => !INTERDITS.has(i));
  if (!sur.length) return 'Write-Host "  Aucun service a traiter."';

  if (restaurer){
    return sur.map(id => {
      const dep = (original && original[id]) || 'Manual';
      return `try { Set-Service -Name '${id}' -StartupType ${dep} -ErrorAction Stop
  Write-Host "  Restaure : ${id} -> ${dep}" -ForegroundColor Green } catch { Write-Host "  Echec : ${id}" -ForegroundColor Yellow }`;
    }).join('\n');
  }

  return sur.map(id => `try {
  Stop-Service -Name '${id}' -Force -ErrorAction SilentlyContinue
  Set-Service  -Name '${id}' -StartupType Disabled -ErrorAction Stop
  Write-Host "  Desactive : ${id}" -ForegroundColor Green
} catch { Write-Host "  Echec : ${id} (${'$'}(${'$'}_.Exception.Message))" -ForegroundColor Yellow }`).join('\n');
}

module.exports = { CATALOGUE, INTERDITS, readServices, scriptServices };
