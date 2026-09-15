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

/* ============================================================
   Candado contra la pérdida de datos
   ------------------------------------------------------------
   En Render, Railway, Fly y compañía el sistema de archivos del
   contenedor se borra en cada despliegue y cada reinicio. Si la
   base de datos queda ahí, un día cualquiera desaparecen las
   cuentas, los saldos y las inscripciones, y no hay vuelta atrás.

   Por eso, en la nube, el servidor NO ARRANCA si la base de datos
   no está en un disco que sobreviva. Es mejor que el despliegue
   falle hoy, con un mensaje claro, a que se pierda el dinero de
   los jugadores dentro de tres semanas.
   ============================================================ */
(function exigirDiscoPersistente() {
    const proveedor = process.env.RENDER ? 'Render'
        : process.env.RAILWAY_ENVIRONMENT ? 'Railway'
        : process.env.FLY_APP_NAME ? 'Fly.io'
        : process.env.KOYEB_APP_NAME ? 'Koyeb'
        : null;

    if (!proveedor) return;                     // en local no hay nada que proteger

    // Rutas que en estos proveedores corresponden a un disco montado aparte
    const esPersistente = /^\/(data|datos|var\/data|mnt|persistent|storage)(\/|$)/.test(RUTA);
    if (esPersistente) return;

    if (process.env.PERMITIR_DATOS_TEMPORALES === '1') {
        console.warn('\n  ⚠  ATENCIÓN: la base de datos está en almacenamiento temporal.');
        console.warn('     Se borrará en el próximo despliegue o reinicio.');
        console.warn('     Solo sirve para probar. NO lo uses para cobrar.\n');
        return;
    }

    console.error(`
  ══════════════════════════════════════════════════════════════
   NO ARRANCO: la base de datos se perdería
  ══════════════════════════════════════════════════════════════

   Estás en ${proveedor} y la base de datos apunta a:

       ${RUTA}

   Esa carpeta se borra en cada despliegue y cada reinicio. Con
   ella se irían las cuentas, los saldos y las inscripciones de
   todos los jugadores.

   Cómo arreglarlo:

   1. Añade un disco persistente al servicio y móntalo en /data
      (en Render: pestaña Disks → Add Disk → Mount Path /data).
   2. Pon la variable de entorno:
          DB_RUTA=/data/torneos.db
   3. Vuelve a desplegar.

   Si solo estás probando y no te importa perder los datos:
          PERMITIR_DATOS_TEMPORALES=1

  ══════════════════════════════════════════════════════════════
`);
    process.exit(1);
})();

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
    premio_total  INTEGER NOT NULL DEFAULT 0,
    distribucion  TEXT NOT NULL DEFAULT '[]',
    precio_kill    INTEGER NOT NULL DEFAULT 0,
    premio_ganador INTEGER NOT NULL DEFAULT 0,
    minimo         INTEGER NOT NULL DEFAULT 0,
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

/* Migración suave: las bases creadas antes del modelo de premios por kill
   no tienen estas columnas. Se añaden sin tocar los datos existentes. */
(function migrar() {
    const columnas = db.prepare('PRAGMA table_info(torneos)').all().map((c) => c.name);
    const faltantes = [
        ['precio_kill', 'INTEGER NOT NULL DEFAULT 0'],
        ['premio_ganador', 'INTEGER NOT NULL DEFAULT 0'],
        ['minimo', 'INTEGER NOT NULL DEFAULT 0']
    ];
    for (const [nombre, tipo] of faltantes) {
        if (!columnas.includes(nombre)) {
            db.exec(`ALTER TABLE torneos ADD COLUMN ${nombre} ${tipo}`);
            console.log('  base de datos: columna añadida →', nombre);
        }
    }
})();

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
