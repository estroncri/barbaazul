-- Recuperar contraseña, verificación de cuenta y freno a los intentos de entrar.

-- El jugador que olvidó su contraseña pide ayuda; el organizador le genera
-- una temporal y se la manda por WhatsApp. Sin correo de por medio, que es
-- como funciona esta comunidad.
CREATE TABLE IF NOT EXISTS recuperaciones (
    id          TEXT PRIMARY KEY,
    usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    estado      TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | resuelta | rechazada
    nota        TEXT DEFAULT '',
    creado      TEXT NOT NULL,
    resuelto    TEXT
);

-- Solicitudes de verificación: el jugador pone el código en su biografía
-- del juego y avisa; el organizador comprueba y aprueba.
CREATE TABLE IF NOT EXISTS verificaciones (
    id          TEXT PRIMARY KEY,
    usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    codigo      TEXT NOT NULL,
    estado      TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | aprobada | rechazada
    nota        TEXT DEFAULT '',
    creado      TEXT NOT NULL,
    resuelto    TEXT
);

-- Freno a la fuerza bruta: se cuentan los intentos fallidos por cuenta y por
-- dirección de internet. Sin esto se pueden probar contraseñas sin parar.
CREATE TABLE IF NOT EXISTS intentos (
    clave    TEXT PRIMARY KEY,      -- "login:2148563097" o "ip:1.2.3.4"
    fallos   INTEGER NOT NULL DEFAULT 0,
    desde    TEXT NOT NULL,
    bloqueado_hasta TEXT
);

-- Cuando el organizador da una contraseña temporal, el jugador tiene que
-- cambiarla al entrar.
ALTER TABLE usuarios ADD COLUMN debe_cambiar INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_recu_estado ON recuperaciones (estado, creado);
CREATE INDEX IF NOT EXISTS idx_veri_estado ON verificaciones (estado, creado);
