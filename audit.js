/* =====================================================================
   audit.js — vérifie que chaque annulation défait bien ce que la commande a fait
   ---------------------------------------------------------------------
       node audit.js

   Analyse STATIQUE : ne lance rien, ne modifie rien. Elle lit les 51
   réglages et compare, pour chacun, les cibles touchées par `cmd` et par
   `rev`.

   check.js vérifie seulement que `rev` existe. Ce n'est pas suffisant :
   une annulation peut exister et ne pas remettre les choses en place, ou
   en remettre bien plus que ce qui avait été changé. Les deux cas laissent
   la machine d'un client dans un état que personne n'a voulu.

   Trois défauts recherchés :
     MANQUE   une valeur posée par cmd n'est pas reprise par rev
     EXCÈS    rev touche une cible que cmd n'a jamais modifiée
     BALAYAGE rev utilise un joker ou une remise à zéro globale, donc
              efface aussi des réglages que l'utilisateur avait faits
              lui-même avant de connaître cet outil
   ===================================================================== */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const bloc1 = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
const ctx = {};
vm.createContext(ctx);
vm.runInContext(bloc1 + ';globalThis.__M=MODULES;', ctx);
const tweaks = ctx.__M.flatMap(m => m.tweaks).filter(t => t.cmd);

/* Extrait les cibles d'un script PowerShell : couples chemin\valeur pour le
   registre, et commandes natives pour le reste. */
/* Les commentaires PowerShell sont retirés avant toute analyse : un commentaire
   qui cite une commande dangereuse pour expliquer pourquoi on l'a retirée ne
   doit pas être compté comme si elle était encore là. */
const sansCommentaires = s => s.replace(/\r/g, '').split('\n')
  .map(l => l.replace(/^\s*#.*$/, ''))
  .join('\n');

function cibles(src){
  const set = new Set();
  const s = sansCommentaires(src)
    // $_.PSPath dans une boucle et $nic.Name désignent la même cible qu'une
    // variable simple : on normalise pour ne pas comparer des écritures.
    .replace(/\$_\.PSPath/gi, '$VAR')
    .replace(/\$[\w]+\.Name/gi, '$VAR')
    .replace(/\$[\w]+/g, m => (m === '$VAR' ? m : '$VAR'));

  // Set-ItemProperty / New-ItemProperty "chemin" -Name valeur
  for (const m of s.matchAll(/(?:Set|New)-ItemProperty\s+"([^"]+)"\s+-Name\s+([\w]+)/g))
    set.add('reg:' + m[1].toLowerCase() + '\\' + m[2].toLowerCase());
  // Set-ItemProperty $VAR -Name valeur   (boucle sur des interfaces)
  for (const m of s.matchAll(/(?:Set|New)-ItemProperty\s+\$VAR\s+-Name\s+([\w]+)/g))
    set.add('reg:$*\\' + m[1].toLowerCase());
  // Remove-ItemProperty "chemin" -Name valeur — chemin littéral seulement :
  // la forme à variable est traitée juste en dessous, sinon la même cible
  // produirait deux jetons différents et passerait pour un écart.
  for (const m of s.matchAll(/Remove-ItemProperty\s+"?(HK[A-Z]{2,4}:[^"\s]*)"?\s+-Name\s+([\w]+)/g))
    set.add('reg:' + m[1].toLowerCase() + '\\' + m[2].toLowerCase());
  for (const m of s.matchAll(/Remove-ItemProperty\s+\$VAR\s+-Name\s+([\w]+)/g))
    set.add('reg:$*\\' + m[1].toLowerCase());
  // Remove-Item "chemin" -Recurse  => suppression d'une clé entière
  for (const m of s.matchAll(/Remove-Item\s+"([^"]+)"\s+-Recurse/g))
    set.add('regcle:' + m[1].toLowerCase());
  // powercfg /setacvalueindex SOUS-GROUPE PARAMETRE
  for (const m of s.matchAll(/setacvalueindex\s+\S+\s+(\S+)\s+(\S+)/gi))
    set.add('pwr:' + m[1].toLowerCase() + '/' + m[2].toLowerCase());
  for (const m of s.matchAll(/powercfg\s+\/change\s+([\w-]+)/gi))
    set.add('pwr:' + m[1].toLowerCase());
  // services
  for (const m of s.matchAll(/Set-Service\s+(\S+)/gi))    set.add('svc:' + m[1].toLowerCase());
  // bcdedit
  for (const m of s.matchAll(/bcdedit\s+\/(?:set|deletevalue)\s+(\S+)/gi))
    set.add('bcd:' + m[1].toLowerCase());
  // netsh
  for (const m of s.matchAll(/netsh\s+int\s+tcp\s+set\s+\w+\s+(\w+)=/gi))
    set.add('netsh:' + m[1].toLowerCase());
  // Propriétés avancées de carte : on nomme chacune, Set et Reset visent la même
  for (const m of s.matchAll(/(?:Set|Reset)-NetAdapterAdvancedProperty[^\n]*-DisplayName\s+"([^"]+)"/gi))
    set.add('nic:' + m[1].toLowerCase());
  // une boucle foreach sur $props couvre les valeurs listées juste avant
  if (/-DisplayName\s+\$VAR/i.test(s)){
    for (const m of s.matchAll(/\$props\s*=\s*([^\n]+)/gi))
      for (const p of m[1].matchAll(/"([^"]+)"/g)) set.add('nic:' + p[1].toLowerCase());
  }
  // Enable et Disable visent la même cible : c'est une bascule, pas deux choses
  if (/(?:Enable|Disable)-NetAdapterPowerManagement/i.test(s)) set.add('nic:energie');
  if (/Set-DnsClientServerAddress/i.test(s)) set.add('dns:serveurs');
  return set;
}

/* Écarts connus, examinés et assumés. Les lister ici plutôt que de les taire
   garde l'audit crédible : un outil qui signale des faux positifs finit ignoré,
   un outil qui cache des vrais écarts ne sert à rien. */
const ACCEPTES = {
  'net-dns': "L'adresse DNS d'origine n'est nulle part enregistrée avant modification. " +
             "-ResetServerAddresses repasse en DNS fourni par la box, ce qui est la configuration " +
             "de la très grande majorité des postes. Un utilisateur ayant saisi un DNS manuel " +
             "devra le ressaisir : c'est indiqué dans la description du réglage."
};

/* Formes qui remettent à zéro bien plus large que ce qui a été modifié. */
const BALAYAGES = [
  { re: /netsh\s+int\s+tcp\s+reset/i,                       quoi: "netsh int tcp reset — remet TOUTE la pile TCP à zéro, y compris des réglages que l'utilisateur avait faits avant" },
  { re: /Reset-NetAdapterAdvancedProperty[^\n]*-DisplayName\s+"\*"/i, quoi: "Reset-NetAdapterAdvancedProperty -DisplayName \"*\" — remet TOUTES les propriétés avancées de la carte, pas seulement celles modifiées" },
  { re: /Remove-Item[^\n]*-Recurse/i,                       quoi: "Remove-Item -Recurse — supprime une clé entière, y compris des valeurs voisines non posées par cet outil" },
  { re: /-ResetServerAddresses/i,                           quoi: "-ResetServerAddresses — repasse en DNS automatique, même si l'utilisateur avait un DNS manuel avant" }
];

const lignes = [], connus = [];

for (const t of tweaks){
  const a = cibles(t.cmd), b = cibles(t.rev || '');
  const manque = [...a].filter(x => !b.has(x));
  const exces  = [...b].filter(x => !a.has(x));
  // Les balayages sont cherchés dans le script débarrassé de ses commentaires :
  // un commentaire qui cite la commande retirée ne doit pas la ressusciter.
  const balaye = BALAYAGES.filter(x => x.re.test(sansCommentaires(t.rev || '')));

  if (!manque.length && !exces.length && !balaye.length) continue;
  if (ACCEPTES[t.id]){ connus.push({ id: t.id, t: t.t, note: ACCEPTES[t.id] }); continue; }
  lignes.push({ id: t.id, t: t.t, v: t.v, manque, exces, balaye });
}

console.log('\nAUDIT DES ANNULATIONS');
console.log('  réglages scriptables analysés : ' + tweaks.length);
console.log('  annulation symétrique         : ' + (tweaks.length - lignes.length - connus.length));
console.log('  écart connu et assumé         : ' + connus.length);
console.log('  À CORRIGER                    : ' + lignes.length);

for (const l of lignes){
  console.log('\n  [' + l.id + '] ' + l.t + '   (' + l.v + ')');
  l.balaye.forEach(b => console.log('      BALAYAGE  ' + b.quoi));
  if (l.manque.length) console.log('      MANQUE    ' + l.manque.join(', '));
  if (l.exces.length)  console.log('      EXCÈS     ' + l.exces.join(', '));
}

for (const c of connus){
  console.log('\n  [' + c.id + '] ' + c.t + '   — écart assumé');
  console.log('      ' + c.note.replace(/(.{78}\s)/g, '$1\n      '));
}

console.log('\n  Cette analyse ne lance rien et ne modifie rien.\n');
process.exit(lignes.length ? 1 : 0);
