# Final Table Hold'em

Torneo di No-Limit Texas Hold'em contro 8 bot di livello pro, giocabile nel
browser. Nessuna dipendenza e nessun build: apri `index.html`.

## Struttura del torneo

- 9 giocatori (tu + 8 bot), stack iniziale **30.000** fiches a testa.
- Bui crescenti a livelli di 6, 9 o 12 mani (turbo, standard, deep), da
  100/200 fino a 50.000/100.000; dal livello 3 c'è l'ante del big blind.
- Buy-in 1.000 €, montepremi 9.000 €: pagati i primi tre (50/30/20 %).
- Regole complete: rilancio minimo, all-in corti che non riaprono l'azione,
  side pot, fiche dispari al primo giocatore a sinistra del bottone,
  heads-up con il bottone al small blind.

## Come giocano i bot

Ogni avversario ha una personalità, che scopri solo a fine torneo:
LAG, Squalo TAG, Maniaco controllato, Teorico GTO, Roccia, Trappolone,
Hero caller e Sfruttatore. Tutti partono dalle stesse basi da pro:

- **Preflop**: range di apertura per posizione (più larghi con l'ante e
  contro bui che foldano tanto), 3-bet e 4-bet polarizzati con bluff a
  blocker e squeeze, limp-trap occasionali con AA/KK, difesa del big blind in
  base al prezzo, push/fold sotto i 12-14 BB scelto calcolando l'EV del shove.
- **Postflop**: equity Monte Carlo contro il range di ogni avversario,
  ristretto da quello che ha fatto nella mano. Lo stesso calcolo stima quanta
  parte del suo range è aria o mano debole, cioè la fold equity. Puntate e
  rilanci confrontano l'EV della pressione con quello del check o del call.
  Così i bot bluffano quando la storia regge: avversario che ha mostrato
  debolezza, carta spaventosa (colore o scala che entra, overcard), progetto
  mancato al river, blocker, giocatori che foldano troppo. In più: float in
  posizione, check-raise, slowplay, overbet polarizzati, hero call.
- **Umore e memoria**: dopo una bad beat un bot può andare in tilt e giocare
  più largo e aggressivo per qualche mano; se viene beccato a bluffare
  rallenta, se i bluff passano insiste. Tutti ricordano i bluff visti allo
  showdown e chi li ha battuti in un piatto grosso.
- **Lettura degli avversari**: VPIP, PFR, fattore di aggressività e
  fold-to-bet di tutti, compreso te. Chi punta troppo viene pagato di più,
  chi non folda mai viene bluffato meno e valorizzato di più. Le statistiche
  sono visibili nell'HUD sopra ogni avversario.
- **ICM**: vicino alla bolla e a premio servono più equity per rischiare lo
  stack; i chip leader invece fanno pressione sugli stack medi.
- **Comportamento al tavolo**: tempi di pensiero realistici (fold veloci,
  lunghe riflessioni sulle decisioni difficili, qualche "tank" con il
  punto), chat in italiano e bluff mostrati dopo aver vinto il piatto.

## Mazzo e statistiche

Il mazzo è mescolato con il generatore crittografico del browser
(`crypto.getRandomValues`, Fisher-Yates), quindi ogni ordine del mazzo è
possibile e nessun giocatore è favorito. Il riquadro "Le tue carte" mostra
coppie servite, JJ+/AK e flop accoppiati accanto ai valori attesi.

## Comandi

Fold, Check/Chiama, Punta/Rilancia con slider, importo libero e preset
(2,2-3 BB e 2,5-4× preflop; 33 %, 50 %, 75 % e piatto postflop; all-in).
Tastiera: `F` fold, `C` check/call, `R` punta/rilancia, `T` time bank.

## Tempo di azione e time bank

Hai un tempo limitato per ogni decisione: 15, 20 (predefinito) o 30
secondi, oppure nessun limite, da scegliere all'inizio del torneo. Parti con
3 time bank card da 30 secondi e ne ricevi una nuova ogni 3 livelli (livelli
4, 7, 10…), fino a un massimo di 6. Puoi usarne una quando vuoi durante il
tuo turno con il pulsante "Usa +30 s" o il tasto `T`; se il tempo scade e
hai ancora carte, una si usa da sola. Senza carte, allo scadere fai check
se puoi, altrimenti passi. Il cronometro si ferma mentre è aperto un
dialogo.

## Verifica

```sh
node games/poker/test/simulate.mjs 50
node games/poker/test/deal.mjs
```

Il simulatore gioca tornei completi tra 9 bot (uno per personalità) e
controlla a ogni mano che le fiches si conservino, che gli stack non vadano
mai sotto zero, che ci sia un solo vincitore e che piazzamenti e premi siano
coerenti. `deal.mjs` mescola 300.000 mazzi e verifica che coppie servite,
JJ+/AK e flop accoppiati rispettino le probabilità esatte.
