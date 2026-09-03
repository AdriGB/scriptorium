// png-parser.js - corregido con base64url, validacion extra e iTXt fix

export function decodeCharaPayload(raw) {
    const t = String(raw || '').trim();
    if (!t) throw new Error('Payload vacio');
    const tryBase64 = (s) => {
        let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
        const pad = b64.length % 4;
        if (pad) b64 += '='.repeat(4 - pad);
        try {
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const text = new TextDecoder('utf-8').decode(bytes);
            return JSON.parse(text);
        } catch {
            return null;
        }
    };

    const fromB64 = tryBase64(t);
    if (fromB64) return fromB64;

    try {
        return JSON.parse(t);
    } catch (e) {
        throw new Error('Payload no es JSON ni base64 valido');
    }
}

export async function decompZ(data) {
    if (!(data instanceof Uint8Array)) data = new Uint8Array(data);
    if (typeof DecompressionStream === 'undefined') return null;
    try {
        const ds = new DecompressionStream('deflate');
        const w = ds.writable.getWriter();
        await w.write(data);
        await w.close();
        const r = ds.readable.getReader();
        const ch = [];
        let total = 0;
        while (true) {
            const { done, value } = await r.read();
            if (done) break;
            ch.push(value);
            total += value.length;
            if (total > 5 * 1024 * 1024) throw new Error('Descompresion excede limite');
        }
        const res = new Uint8Array(total);
        let o = 0;
        for (const c of ch) { res.set(c, o); o += c.length; }
        return res;
    } catch (err) {
        if (err.message?.includes('excede')) throw err;
        return null;
    }
}

const MAX_CARD_BYTES = 2 * 1024 * 1024;

export async function extPNG(file) {
    if (!file || file.size === 0) throw new Error('Archivo vacio');
    const buf = await file.arrayBuffer();
    const dv = new DataView(buf);
    const u8 = new Uint8Array(buf);

    if (dv.byteLength < 8) throw new Error('PNG demasiado pequeno');
    if (dv.getUint32(0) !== 0x89504e47 || dv.getUint32(4) !== 0x0d0a1a0a)
        throw new Error('PNG invalido - firma incorrecta');

    let off = 8;
    /* Candidatos, no el primero que aparece. La especificacion V3 es clara:
       "if the application detects both `chara` and `ccv3` chunk, the application
       SHOULD use the `ccv3` chunk". Devolver el primero daria la carta vieja en
       un PNG que SillyTavern reescribio, que es justo el caso que va a ser
       habitual. Se guardan todos y se elige al final por preferencia. */
    const candidates = [];

    while (off + 12 <= dv.byteLength) {
        const len = dv.getUint32(off);
        if (len > 20 * 1024 * 1024) throw new Error('Chunk PNG sospechoso');
        if (off + 12 + len > dv.byteLength) throw new Error('PNG truncado');

        const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);

        if (type === 'tEXt') {
            let kw = '', val = '', ik = true;
            for (let i = 0; i < len; i++) {
                const c = u8[off + 8 + i];
                if (c === 0 && ik) { ik = false; continue; }
                if (ik) kw += String.fromCharCode(c); else val += String.fromCharCode(c);
            }
            /* `ccv3` (V3) y `chara` (V2). La especificacion V3 fija que la carta
               va en un tEXt llamado `ccv3`, con el mismo encoding que V2
               (JSON -> utf-8 -> base64), asi que no hay nada que cambiar en la
               decodificacion: solo el nombre del chunk y la prioridad. */
            if (kw === 'ccv3' || kw === 'chara') {
                if (val.length > MAX_CARD_BYTES) throw new Error('Payload excede limite de seguridad (2MB)');
                candidates.push({ rank: kw === 'ccv3' ? 2 : 1, payload: val });
            }
        } else if (type === 'zTXt') {
            let kw = '', i = 0;
            while (i < len && u8[off + 8 + i] !== 0) { kw += String.fromCharCode(u8[off + 8 + i]); i++; }
            i++;
            if ((kw === 'chara' || kw === 'ccv3') && i < len) {
                const cm = u8[off + 8 + i]; i++;
                if (cm === 0 && i < len) {
                    try {
                        const dec = await decompZ(u8.slice(off + 8 + i, off + 8 + len));
                        if (dec) {
                            if (dec.length > MAX_CARD_BYTES) throw new Error('Payload excede limite de seguridad');
                            const text = new TextDecoder('latin1').decode(dec);
                            candidates.push({ rank: kw === 'ccv3' ? 2 : 1, payload: text });
                        }
                    } catch (e) { if (e.message?.includes('Payload') || e.message?.includes('limite')) throw e; }
                }
            }
        } else if (type === 'iTXt') {
            let kw = '', i = 0;
            while (i < len && u8[off + 8 + i] !== 0) { kw += String.fromCharCode(u8[off + 8 + i]); i++; }
            i++; // null separator after keyword
            if ((kw === 'chara' || kw === 'ccv3') && i + 2 < len) {
                const compressionFlag = u8[off + 8 + i]; i++;
                const compressionMethod = u8[off + 8 + i]; i++;
                // FIX: validar metodo de compresion
                if (compressionFlag === 1 && compressionMethod !== 0) {
                    off += 12 + len;
                    continue;
                }
                // FIX: language tag (sin i++ extra antes del bucle)
                while (i < len && u8[off + 8 + i] !== 0) i++;
                i++; // null terminator del language tag
                // Translated keyword
                while (i < len && u8[off + 8 + i] !== 0) i++;
                i++; // null terminator del translated keyword
                // Payload
                const payload = u8.slice(off + 8 + i, off + 8 + len);
                let text;
                if (payload.length > MAX_CARD_BYTES) throw new Error('Payload excede limite');
                if (compressionFlag === 0) {
                    text = new TextDecoder('utf-8').decode(payload);
                } else if (compressionFlag === 1) {
                    const dec = await decompZ(payload);
                    if (!dec) { off += 12 + len; continue; }
                    if (dec.length > MAX_CARD_BYTES) throw new Error('Payload excede limite');
                    text = new TextDecoder('utf-8').decode(dec);
                } else {
                    off += 12 + len;
                    continue;
                }
                candidates.push({ rank: kw === 'ccv3' ? 2 : 1, payload: text });
            }
        }
        if (type === 'IEND') break;
        off += 12 + len;
    }

    /* Se prueba por orden de preferencia, no solo el de mas rango: un `ccv3`
       roto no puede tapar un `chara` que si se lee. Solo si ninguno decodifica
       se falla, y con el motivo del ultimo intento. */
    if (candidates.length) {
        // sort() es estable: a igual rango gana el que venia primero en el fichero.
        candidates.sort((a, b) => b.rank - a.rank);
        let lastErr;
        for (const c of candidates) {
            try { return decodeCharaPayload(c.payload); } catch (e) { lastErr = e; }
        }
        throw new Error('Se encontro la carta pero no se pudo decodificar: ' + (lastErr?.message || 'sin detalle'));
    }
    throw new Error("Sin metadatos 'chara' ni 'ccv3'. Asegurate que es una tarjeta valida.");
}