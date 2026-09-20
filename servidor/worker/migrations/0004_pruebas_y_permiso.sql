-- Dos cosas que hacen falta el día que entra el primer jugador de verdad

-- 1. La evidencia de un resultado
--
-- La tabla de un torneo mueve dinero: un puesto mal escrito le quita el
-- premio a alguien. Hasta ahora la única prueba de lo que pasó en la sala
-- era la memoria del organizador, y con eso no se resuelve un reclamo.
--
-- Aquí va el enlace a la captura del marcador final. Una por torneo, que es
-- lo que hay: la pantalla de resultados de Free Fire los trae a todos.
ALTER TABLE torneos ADD COLUMN evidencia TEXT;

-- 2. Que el jugador aceptó las reglas, y cuándo
--
-- Las Reglas dicen que un menor necesita permiso de un acudiente. Decirlo y
-- no guardarlo en ninguna parte es no haberlo dicho: el día que un papá
-- llame preguntando por qué su hijo de catorce años pagó un cupo, hay que
-- poder enseñar qué aceptó y qué día.
--
-- Se guarda la versión del texto, no un simple sí. Las reglas cambian, y
-- "aceptó" sin saber qué aceptó no sirve de nada.
ALTER TABLE usuarios ADD COLUMN terminos TEXT;
ALTER TABLE usuarios ADD COLUMN terminos_fecha TEXT;
