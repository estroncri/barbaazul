/* ============================================================
   Torneos FF — Base de datos (SQLite)
   ------------------------------------------------------------
   Sin dependencias: node:sqlite viene con Node 22 o superior.

   Regla que no se negocia: el saldo NO es una columna que se edita.
   Es la suma del libro de movimientos. Así una recarga, un premio o
   un retiro siempre cuadran, y no hay forma de que un error deje a
   alguien con plata que no existe.
   ============================================================ */

const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const path = require('node:path');

const RUTA = process.env.DB_RUTA || path.join(__dirname, 'torneos.db');
const db = new DatabaseSync(RUTA);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

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
    id            TEXT PRIMARY KEY,
    nombre        TEXT NOT NULL,
    modo          TEXT NOT NULL,
    fecha         TEXT NOT NULL,
    cupo_max      INTEGER NOT NULL,
    costo         INTEGER NOT NULL,
    premio_total  INTEGER NOT NULL,
    distribucion  TEXT NOT NULL,
    mapa          TEXT,
    reglas        TEXT NOT NULL DEFAULT '[]',
    estado        TEXT NOT NULL DEFAULT 'abierto',
    sala_id       TEXT DEFAULT '',
    sala_pass     TEXT DEFAULT '',
    sala_publicada INTEGER NOT NULL DEFAULT 0,
    tema          TEXT DEFAULT 'fuego',
    encuesta      TEXT,
    creado        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inscripciones (
    id           TEXT PRIMARY KEY,
    torneo_id    TEXT NOT NULL REFERENCES torneos(id) ON DELETE CASCADE,
    usuario_id   TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    equipo       TEXT NOT NULL,
    miembros     TEXT NOT NULL,
    estado       TEXT NOT NULL DEFAULT 'confirmada',
    creado       TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_mov_usuario  ON movimientos (usuario_id, estado);
CREATE INDEX IF NOT EXISTS idx_insc_torneo  ON inscripciones (torneo_id);
CREATE INDEX IF NOT EXISTS idx_sesion_user  ON sesiones (usuario_id);
`);

/* ===== Utilidades ===== */
const uid = (p) => p + '_' + crypto.randomBytes(8).toString('hex');
const ahora = () => new Date().toISOString();

function hashPass(pass, sal) {
    const s = sal || crypto.randomBytes(16).toString('hex');
    const h = crypto.scryptSync(pass, s, 64).toString('hex');
    return { hash: h, sal: s };
}

function verificarPass(pass, hash, sal) {
    const calculado = crypto.scryptSync(pass, sal, 64);
    const guardado = Buffer.from(hash, 'hex');
    return guardado.length === calculado.length && crypto.timingSafeEqual(guardado, calculado);
}

/* El saldo sale del libro, nunca de una columna.

   Un movimiento PENDIENTE solo cuenta si RESTA (un retiro sin pagar
   todavía: reserva el dinero para que no se gaste dos veces). Si suma
   —una recarga que el organizador aún no ha confirmado— no cuenta: de
   lo contrario cualquiera pediría una recarga que nunca pagó y gastaría
   ese saldo. */
function saldoDe(usuarioId) {
    const r = db.prepare(`
        SELECT COALESCE(SUM(monto), 0) AS saldo FROM movimientos
        WHERE usuario_id = ?
          AND (estado = 'completada' OR (estado = 'pendiente' AND monto < 0))
    `).get(usuarioId);
    return Number(r.saldo) || 0;
}

module.exports = { db, uid, ahora, hashPass, verificarPass, saldoDe, RUTA };
