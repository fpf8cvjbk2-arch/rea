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

- **Preflop**: range di apertura per posizione (più larghi con l'ante),
  3-bet e 4-bet polarizzati con bluff a blocker, difesa del big blind in base
  al prezzo, push/fold sotto i 12-14 BB scelto calcolando l'EV del shove
  contro i range di chiamata di chi deve ancora parlare.
- **Postflop**: equity Monte Carlo contro il range di ogni avversario. Il
  range parte dall'azione preflop e si restringe secondo quello che
  l'avversario fa nella mano (check, call, bet, raise e dimensione della
  puntata). Ne derivano c-bet in base alla texture del board, semi-bluff con
  i progetti, barrel e bluff al river, value bet sottili, check-raise e
  slowplay occasionali.
- **Lettura degli avversari**: ogni bot registra VPIP, PFR, fattore di
  aggressività e fold-to-bet di tutti, compreso te, e si adatta: paga di più
  chi bluffa spesso e bluffa meno chi non folda mai. Le stesse statistiche
  sono visibili nell'HUD sopra ogni avversario.
- **ICM**: vicino alla bolla e a premio i bot chiedono più equity per
  rischiare lo stack, soprattutto contro chi li copre.
- Ogni bot ha un proprio stile (aggressività e ampiezza dei range
  leggermente diverse), quindi non giocano tutti allo stesso modo.

## Comandi

Fold, Check/Chiama, Punta/Rilancia con slider, importo libero e preset
(2,2-3 BB e 2,5-4× preflop; 33 %, 50 %, 75 % e piatto postflop; all-in).
Tastiera: `F` fold, `C` check/call, `R` punta/rilancia.

## Verifica

```sh
node games/poker/test/simulate.mjs 50
```

Il simulatore gioca tornei completi tra 9 bot e controlla a ogni mano che le
fiches si conservino, che gli stack non vadano mai sotto zero, che ci sia un
solo vincitore e che piazzamenti e premi siano coerenti.
