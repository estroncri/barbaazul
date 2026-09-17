-- Jugadores que se inscriben sin compañero
--
-- Hasta ahora una inscripción era un equipo completo: el que la hacía traía
-- a los suyos y pagaba por todos. Pero mucha gente no tiene con quién, y
-- perderlos es perder torneos.
--
-- Ahora cada inscripción es una PARTE de un equipo. Las que van juntas
-- comparten "grupo". Un equipo normal es un grupo de una sola fila, así que
-- nada de lo de antes cambia de significado: por eso las existentes se
-- quedan con su propio id como grupo.

ALTER TABLE inscripciones ADD COLUMN grupo TEXT;
ALTER TABLE inscripciones ADD COLUMN buscando INTEGER NOT NULL DEFAULT 0;

-- Las que ya existían son equipos completos, cada una el suyo.
UPDATE inscripciones SET grupo = id WHERE grupo IS NULL;

CREATE INDEX IF NOT EXISTS idx_inscripciones_grupo ON inscripciones (torneo_id, grupo);
CREATE INDEX IF NOT EXISTS idx_inscripciones_buscando ON inscripciones (torneo_id, buscando);
