-- Torneos FF — esquema inicial para D1
-- Se aplica con:  npx wrangler d1 migrations apply torneos-ff

CREATE TABLE IF NOT EXISTS usuarios (
    id          TEXT PRIMARY KEY,
    ff_uid      TEXT NOT NULL UNIQUE,
    nick        TEXT NOT NULL,
    nivel       INTEGER DEFAULT 0,
    region      TEXT DEFAULT 'us',
    email       TEXT,
    whatsapp    TEXT NOT NULL,
    pass_hash   TEXT NOT NULL,
    pass_sal    TEXT NOT NULL,
    rol         TEXT NOT NULL DEFAULT 'jugador',
    verificado  INTEGER NOT NULL DEFAULT 0,
    perfil      TEXT,
    creado      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sesiones (
    token_hash  TEXT PRIMARY KEY,
    usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    creado      TEXT NOT NULL,
    expira      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS torneos (
    id             TEXT PRIMARY KEY,
    nombre         TEXT NOT NULL,
    modo           TEXT NOT NULL,
    fecha          TEXT NOT NULL,
    cupo_max       INTEGER NOT NULL,
    costo          INTEGER NOT NULL,
    premio_total   INTEGER NOT NULL DEFAULT 0,
    distribucion   TEXT NOT NULL DEFAULT '[]',
    precio_kill    INTEGER NOT NULL DEFAULT 0,
    premio_ganador INTEGER NOT NULL DEFAULT 0,
    minimo         INTEGER NOT NULL DEFAULT 0,
    mapa           TEXT,
    reglas         TEXT NOT NULL DEFAULT '[]',
    estado         TEXT NOT NULL DEFAULT 'abierto',
    sala_id        TEXT DEFAULT '',
    sala_pass      TEXT DEFAULT '',
    sala_publicada INTEGER NOT NULL DEFAULT 0,
    tema           TEXT DEFAULT 'fuego',
    encuesta       TEXT,
    creado         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inscripciones (
    id          TEXT PRIMARY KEY,
    torneo_id   TEXT NOT NULL REFERENCES torneos(id) ON DELETE CASCADE,
    usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    equipo      TEXT NOT NULL,
    miembros    TEXT NOT NULL,
    estado      TEXT NOT NULL DEFAULT 'confirmada',
    creado      TEXT NOT NULL,
    UNIQUE (torneo_id, usuario_id)
);

CREATE TABLE IF NOT EXISTS resultados (
    inscripcion_id TEXT PRIMARY KEY REFERENCES inscripciones(id) ON DELETE CASCADE,
    puesto  INTEGER NOT NULL DEFAULT 0,
    kills   INTEGER NOT NULL DEFAULT 0,
    puntos  INTEGER NOT NULL DEFAULT 0,
    premio  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS movimientos (
    id          TEXT PRIMARY KEY,
    usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    tipo        TEXT NOT NULL,
    monto       INTEGER NOT NULL,
    estado      TEXT NOT NULL DEFAULT 'completada',
    metodo      TEXT DEFAULT '',
    referencia  TEXT DEFAULT '',
    nota        TEXT DEFAULT '',
    creado      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mov_usuario ON movimientos (usuario_id, estado);
CREATE INDEX IF NOT EXISTS idx_mov_ref     ON movimientos (referencia);
CREATE INDEX IF NOT EXISTS idx_insc_torneo ON inscripciones (torneo_id);
CREATE INDEX IF NOT EXISTS idx_sesion_user ON sesiones (usuario_id);
