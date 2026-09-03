// js/png-writer.js - BONUS: escribe carta de vuelta a PNG (tEXt chara)

export function encodeCharaPayload(obj) {
    const json = JSON.stringify(obj);
    // v2 spec usa base64 de utf-8
    const utf8 = new TextEncoder().encode(json);
    let binary = '';
    utf8.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
}

function crc32(buf) {
    let table = new Uint32Array(256);
    for (let i=0;i<256;i++){ let c=i; for(let k=0;k<8;k++) c = c & 1 ? 0xEDB88320 ^ (c>>>1) : c>>>1; table[i]=c; }
    let crc = 0xFFFFFFFF;
    for (let i=0;i<buf.length;i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc>>>8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildChunk(type, data) {
    const typeBytes = new TextEncoder().encode(type);
    const len = data.length;
    const chunk = new Uint8Array(4 + 4 + len + 4);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, len);
    chunk.set(typeBytes, 4);
    chunk.set(data, 8);
    const crcData = new Uint8Array(typeBytes.length + data.length);
    crcData.set(typeBytes,0); crcData.set(data, typeBytes.length);
    dv.setUint32(8+len, crc32(crcData));
    return chunk;
}

export async function injectCharaToPng(pngFile, cardObj) {
    const payload = encodeCharaPayload(cardObj);
    /* V3 va en un chunk `ccv3`; V2 en `chara`. Mismo encoding (JSON -> utf-8 ->
       base64), cambia el nombre. Si la carta era V3 se escribe V3: degradarla
       aqui seria perder los assets y las flags nuevas del lorebook. */
    const keyword = cardObj?.spec === 'chara_card_v3' ? 'ccv3' : 'chara';
    const text = keyword + '\0' + payload;
    const textBytes = new TextEncoder().encode(text);
    const textChunk = buildChunk('tEXt', textBytes);

    const buf = await pngFile.arrayBuffer();
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    if (dv.getUint32(0) !== 0x89504E47) throw new Error('No es PNG');

    // Busca IEND y inserta antes
    let off = 8;
    let iendPos = -1;
    while (off + 12 <= u8.length) {
        const len = dv.getUint32(off);
        const type = String.fromCharCode(u8[off+4], u8[off+5], u8[off+6], u8[off+7]);
        if (type === 'IEND') { iendPos = off; break; }
        // si ya hay un chara tEXt, lo reemplazamos eliminandolo del output final
        off += 12 + len;
    }
    if (iendPos === -1) throw new Error('PNG sin IEND');

    // Construir nuevo PNG sin chunks chara viejos
    const parts = [];
    off = 0;
    // header 8 bytes
    parts.push(u8.slice(0,8));
    off = 8;
    while (off + 12 <= u8.length) {
        const len = dv.getUint32(off);
        const type = String.fromCharCode(u8[off+4], u8[off+5], u8[off+6], u8[off+7]);
        const totalLen = 12 + len;
        const chunkBytes = u8.slice(off, off+totalLen);
        const isOldChara = (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') && (() => {
            // quick check keyword
            try {
                let kw = '';
                for (let i=0;i<Math.min(len, 20);i++) {
                    const c = u8[off+8+i];
                    if (c===0) break;
                    kw+=String.fromCharCode(c);
                }
                /* Los dos keywords, no solo el que vamos a escribir: si el PNG
                   traia el otro y lo dejamos, mandaria el viejo. La
                   especificacion V3 dice que `ccv3` gana sobre `chara`, asi que
                   un `ccv3` rancio taparia una carta V2 recien guardada. */
                return kw==='chara' || kw==='ccv3';
            } catch { return false; }
        })();
        if (!isOldChara) parts.push(chunkBytes);
        if (type === 'IEND') break;
        off += totalLen;
    }
    // Inserta nuevo chunk antes del IEND (que ya esta en parts como ultimo)
    const iend = parts.pop();
    parts.push(textChunk);
    parts.push(iend);

    const totalSize = parts.reduce((s,p)=>s+p.length,0);
    const out = new Uint8Array(totalSize);
    let o=0;
    for (const p of parts){ out.set(p,o); o+=p.length; }
    return new Blob([out], {type:'image/png'});
}
