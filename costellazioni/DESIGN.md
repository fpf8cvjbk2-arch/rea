# Design

Mondo visivo: **Genosociogramma**. La notazione dell'albero genealogico (quadrati, cerchi, linee di legame, date sotto i simboli) diventa la grammatica della cornice. La colonna di lettura resta calma e fuori dal gioco.

## Principio

La cornice (testata, prima schermata, indice, indice laterale, chiusura) parla il linguaggio del genogramma. Il testo degli articoli no: carattere da lettura, contrasto pieno, misura di 66 caratteri.

## Colore (strategia: Restrained)

| Ruolo | Chiaro | Scuro |
| --- | --- | --- |
| Carta `--paper` | #F6F7F5 | #121417 |
| Ink `--ink` | #15171B | #ECEDEA |
| Ink secondario `--ink-2` | #4B5058 | #A5ABB3 |
| Filetto `--line` | #C5C9C4 | #2F3439 |
| Rosso segnale `--red` (solo grafica) | #D4351C | #FF5A3C |
| Rosso per testo `--red-ink` | #B22812 | #FF7A5F |

Il rosso è l'unico colore: indica ciò che passa da una generazione all'altra (il filo nel diagramma, l'avanzamento nell'indice, il nodo della sezione in lettura, la barra di progresso). Non si usa mai per testo corrente sotto 4.5:1.

## Tipografia

- Display e etichette: **Bricolage Grotesque** (peso 620, `font-stretch` 96%, tracking -0.018em). Date e numeri con `tabular-nums`.
- Lettura: **Literata**, 17-19px fluidi, interlinea 1.7, colonna `66ch`.
- Nessun monospazio, nessun sopratitolo sopra i titoli.

## Segni del genogramma e dove vivono

- Cerchio aperto = nodo (articolo nell'indice, sezione nell'indice laterale, punto elenco).
- Cerchio doppio = "persona indice": nodo sotto il puntatore e simbolo nel diagramma.
- Doppia linea = legame forte: filetto sopra la nota finale e sopra la chiusura Instagram.
- Linea rossa = ciò che discende: disegno in apertura, filo che si colora scorrendo l'indice, nodo corrente.

## Componenti

- Bottone primario: ink pieno, raggio 2px, `:active` scala .97. Bottone secondario: contorno 1.5px.
- Elenco: voce intera cliccabile, nodo a sinistra su una linea verticale, linea che sfuma oltre l'ultimo articolo (il journal continua).
- Articolo: data, titolo, riassunto e pulsante "Leggi l'articolo completo"; il pulsante (e solo lui) espande il testo dentro l'elenco, indirizzabile con `#/slug`; senza JavaScript tutti gli articoli sono già aperti.

## Palette alternative

Selezionabili con `data-palette` su `<html>` o con `?palette=` nell'indirizzo: `originale` (con versione scura automatica), `indaco`, `archivio`, `notturno` (scura), `rame`, `vinaccia`. Ognuna ridefinisce gli stessi token (`--paper`, `--ink`, `--ink-2`, `--line`, `--acc`, `--acc-ink`, `--on-acc`).

## Movimento (versione precedente, superata)

Il diagramma si disegna da sé all'apertura (~2.3s, ease-out esponenziale `cubic-bezier(.23,1,.32,1)`): prima l'ink, in ultimo il rosso. Il resto è funzionale (<=200ms): hover, transizione tra vista elenco e articolo. `prefers-reduced-motion` disattiva disegno e transizioni.

## Schermi stretti

- Da 1000px in su: layout originale, invariato.
- 760-999px (iPad in verticale): stesse due colonne, colonna sinistra più stretta, titoli delle sezioni a lato.
- Sotto 760px (telefono): linea di 3px e pallini più grandi; in basso una barra con la sezione corrente e l'avanzamento, che apre un pannello dal basso con tutte le sezioni e "Chiudi l'articolo".

## Movimento attuale

- Titolo: le parole salgono una alla volta, poi "prende la parola" si sottolinea nel colore d'accento.
- Schema: si disegna da sé; un punto percorre in loop la linea d'accento; il nodo indice respira; segue appena il puntatore.
- Elenco: le voci entrano scorrendo; il filo scende con la lettura e accende i nodi che raggiunge.
- Articolo: si apre nel posto in cui si trova (`grid-template-rows` 0fr→1fr, 0.8s, curva drawer), i primi paragrafi entrano in sequenza, i nodi delle sezioni si accendono quando le superi. Su desktop un pannello laterale mostra le sezioni; su telefono un pulsante flottante chiude l'articolo.
- `prefers-reduced-motion` spegne ogni animazione.

## Limiti e note

- Il diagramma è uno schema illustrativo con date inventate, dichiarato nella didascalia.
- Nessun link "Chi sono": la pagina originale puntava a un'ancora inesistente e non c'è contenuto da inventare.
