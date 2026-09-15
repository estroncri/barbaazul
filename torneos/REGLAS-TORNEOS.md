# Reglas y precios de los torneos

Lo que el panel propone al crear cada torneo. Todo se puede cambiar torneo por
torneo desde *Panel → Editar*, incluso con gente ya inscrita.

| | Solo | Dúo | Escuadra |
|---|---|---|---|
| Partidas | 1 | 1 | 1 |
| Inscripción por jugador | $5.000 | $5.000 | $5.000 |
| Cuesta el equipo completo | $5.000 | $10.000 | $20.000 |
| Premio por kill | $3.000 | $3.000 | $3.500 |
| Premio al ganador | $10.000 | $15.000 | — |
| La sala se juega con mínimo | 20 jugadores | 5 dúos | 10 escuadras |

## Cómo se paga

El premio de cada uno sale de sus propias kills:

```
premio = kills x precio por kill  +  (bono si quedó primero)
```

Un jugador con 6 kills que además gana un torneo Solo se lleva
6 × $3.000 + $10.000 = **$28.000**.

No hay bolsa fija repartida por porcentajes: se paga lo que cada uno hizo.

## Si no se llega al mínimo

La sala no se juega. El organizador cancela el torneo desde el panel y **a todos
se les devuelve el cupo completo** al saldo, al instante. El botón dice cuánto se
va a devolver antes de confirmar.

## Una duda que quedó pendiente

En las reglas que me pasaste, el mínimo de **Dúo** decía "5 escuadras" y el de
**Escuadra** decía "10 dúos". Como cada modo se mide en su propia unidad, lo dejé
así: Dúo se juega con 5 dúos y Escuadra con 10 escuadras. Si querías otra cosa,
se cambia en el panel sin tocar código.

También quedó sin definir el **premio al ganador en Escuadra**: está en $0, o sea
que en ese modo solo se paga por kills. Si quieres un bono, se pone y ya.
