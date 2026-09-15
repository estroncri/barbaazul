/* ============================================================
   Torneos FF (Cloudflare) — Contraseñas, sesiones y firmas
   ------------------------------------------------------------
   En Workers no existe node:crypto. Todo se hace con WebCrypto,
   que es lo que trae el motor.

   Las contraseñas nunca se guardan: se guarda el resultado de
   pasarlas por PBKDF2-SHA256 junto a una sal distinta para cada
   persona. Si alguien se lleva la base, no se lleva las claves.

   Cuántas vueltas dar es el punto delicado. Lo ideal serían las
   210.000 que recomienda OWASP, pero eso cuesta unos 33 ms de CPU
   y el plan gratuito de Cloudflare corta cada petición a los 10:
   con ese número nadie podía entrar. Así que se bajan las vueltas
   y se compensa con una pimienta: un secreto que vive en el
   servidor y no en la base. Quien robe la base sin ese secreto no
   puede ni empezar a probar contraseñas, por flojas que sean.

   Sin pimienta configurada esto sigue funcionando, solo que la
   protección es la de las vueltas a secas. Con PASS_VUELTAS se
   pueden subir si algún día el servidor deja de ir por el plan
   gratuito.
   ============================================================ */

const VUELTAS_V2 = 20000;     // ~5 ms de CPU: cabe en el presupuesto
const VUELTAS_V1 = 210000;    // lo de antes, para las claves ya guardadas
const MARCA_V2 = 'v2$';
const SEPARADOR = String.fromCharCode(0);
const enc = new TextEncoder();

const aHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function aleatorio(bytes) {
    return aHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(texto) {
    return aHex(await crypto.subtle.digest('SHA-256', enc.encode(texto)));
}

async function derivar(material, sal, vueltas) {
    const clave = await crypto.subtle.importKey('raw', enc.encode(material), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(sal), iterations: vueltas, hash: 'SHA-256' },
        clave, 256
    );
    return aHex(bits);
}

export const vueltasDe = (env) => Number(env?.PASS_VUELTAS) || VUELTAS_V2;
const pimientaDe = (env) => String(env?.PASS_PIMIENTA || '');

/* La contraseña y la pimienta van separadas por un byte cero para que
   "abc" + "de" y "ab" + "cde" no acaben dando lo mismo. */
const conPimienta = (pass, env) => String(pass) + SEPARADOR + pimientaDe(env);

export async function hashPass(pass, env, sal) {
    const s = sal || aleatorio(16);
    const hash = await derivar(conPimienta(pass, env), s, vueltasDe(env));
    return { hash: MARCA_V2 + hash, sal: s };
}

export async function verificarPass(pass, hashGuardado, sal, env) {
    const guardado = String(hashGuardado || '');

    /* Las claves guardadas antes del cambio no llevan marca ni pimienta.
       Se siguen aceptando para no dejar a nadie fuera; en el plan gratuito
       ni siquiera dará tiempo a calcularlas, pero eso es lo que ya pasaba
       y no empeora nada. */
    if (!guardado.startsWith(MARCA_V2)) {
        return iguales(await derivar(String(pass), sal, VUELTAS_V1), guardado);
    }

    const calculado = await derivar(conPimienta(pass, env), sal, vueltasDe(env));
    return iguales(MARCA_V2 + calculado, guardado);
}

/* Una clave guardada con el sistema viejo hay que rehacerla en cuanto su
   dueño entre: así deja de depender del número de vueltas antiguo. */
export const esViejo = (hashGuardado) => !String(hashGuardado || '').startsWith(MARCA_V2);

/* Comparación en tiempo constante: comparar con === permite deducir el
   secreto midiendo cuánto tarda en fallar. */
export function iguales(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a.length !== b.length) return false;
    let dif = 0;
    for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return dif === 0;
}

export const uid = (prefijo) => prefijo + '_' + aleatorio(8);
export const ahora = () => new Date().toISOString();
