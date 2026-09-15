/* ============================================================
   Torneos FF (Cloudflare) — Contraseñas, sesiones y firmas
   ------------------------------------------------------------
   En Workers no existe node:crypto. Todo se hace con WebCrypto,
   que es lo que trae el motor.

   Contraseñas: PBKDF2-SHA256 con 210.000 vueltas, que es lo que
   recomienda OWASP para PBKDF2 hoy. No se guarda la contraseña
   sino el resultado, junto a una sal distinta para cada persona:
   si alguien se lleva la base de datos, no tiene las contraseñas.
   ============================================================ */

const VUELTAS = 210000;
const enc = new TextEncoder();

const aHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export function aleatorio(bytes) {
    return aHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(texto) {
    return aHex(await crypto.subtle.digest('SHA-256', enc.encode(texto)));
}

export async function hashPass(pass, sal) {
    const s = sal || aleatorio(16);
    const clave = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(s), iterations: VUELTAS, hash: 'SHA-256' },
        clave, 256
    );
    return { hash: aHex(bits), sal: s };
}

export async function verificarPass(pass, hashGuardado, sal) {
    const { hash } = await hashPass(pass, sal);
    return iguales(hash, hashGuardado);
}

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
