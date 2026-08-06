export function decodeCharaPayload(raw) {
    const t = raw.trim();
    try { return JSON.parse(new TextDecoder('utf-8').decode(Uint8Array.from(atob(t), c => c.charCodeAt(0)))); }
    catch { /* */ }
    return JSON.parse(t);
}

export async function decompZ(data) {
    if (typeof DecompressionStream === 'undefined') return null;
    try {
        const ds = new DecompressionStream('deflate');
        const w = ds.writable.getWriter();
        w.write(data); w.close();
        const r = ds.readable.getReader(), ch = [];
        while (true) { const { done, value } = await r.read(); if (done) break; ch.push(value); }
        const t = ch.reduce((s, c) => s + c.length, 0), res = new Uint8Array(t);
        let o = 0;
        for (const c of ch) { res.set(c, o); o += c.length; }
        return res;
    } catch { return null; }
}

const MAX_CARD_BYTES = 2 * 1024 * 1024;

export async function extPNG(file) {
    const buf = await file.arrayBuffer(), dv = new DataView(buf), u8 = new Uint8Array(buf);
    if (dv.byteLength < 8 || dv.getUint32(0) !== 0x89504e47 || dv.getUint32(4) !== 0x0d0a1a0a)
        throw new Error('PNG invalido');
    let off = 8;
    while (off + 12 <= dv.byteLength) {
        const len = dv.getUint32(off);
        if (off + 12 + len > dv.byteLength) throw new Error('PNG truncado');
        const type = String.fromCharCode(u8[off + 4], u8[off + 5], u8[off + 6], u8[off + 7]);
        if (type === 'tEXt') {
            let kw = '', val = '', ik = true;
            for (let i = 0; i < len; i++) {
                const c = u8[off + 8 + i];
                if (c === 0 && ik) { ik = false; continue; }
                if (ik) kw += String.fromCharCode(c); else val += String.fromCharCode(c);
            }
            if (kw === 'chara') return decodeCharaPayload(val);
        } else if (type === 'zTXt') {
            let kw = '', i = 0;
            while (i < len && u8[off + 8 + i] !== 0) { kw += String.fromCharCode(u8[off + 8 + i]); i++; }
            i++;
            if (kw === 'chara' && i < len) {
                const cm = u8[off + 8 + i]; i++;
                if (cm === 0 && i < len) {
                    try {
                        const dec = await decompZ(u8.slice(off + 8 + i, off + 8 + len));
                        if (dec) {
                            if (dec.length > MAX_CARD_BYTES) throw new Error('Payload excede limite de seguridad');
                            return decodeCharaPayload(new TextDecoder('latin1').decode(dec));
                        }
                    } catch (e) { if (e.message?.includes('Payload')) throw e; }
                }
            }
        } else if (type === 'iTXt') {
            let kw = '', i = 0;
            while (i < len && u8[off + 8 + i] !== 0) { kw += String.fromCharCode(u8[off + 8 + i]); i++; }
            i++;
            if (kw === 'chara' && i + 3 < len) {
                const cm = u8[off + 8 + i]; i++;
                const fl = u8[off + 8 + i]; i++;
                i++; // skip lang tag
                while (i < len && u8[off + 8 + i] !== 0) i++; i++; // skip translated keyword
                const payload = u8.slice(off + 8 + i, off + 8 + len);
                let text;
                if (cm === 0) {
                    if (payload.length > MAX_CARD_BYTES) throw new Error('Payload excede limite');
                    text = new TextDecoder('utf-8').decode(payload);
                } else if (cm === 1) {
                    const dec = await decompZ(payload);
                    if (!dec) continue;
                    if (dec.length > MAX_CARD_BYTES) throw new Error('Payload excede limite');
                    text = new TextDecoder('utf-8').decode(dec);
                } else continue;
                try { return decodeCharaPayload(text); } catch { /* */ }
            }
        }
        if (type === 'IEND') break;
        off += 12 + len;
    }
    throw new Error("Sin metadatos 'chara'.");
}
