/* Construye PNGs con una CharaCard v2 incrustada para los tests.
   No hay ningun .png en el repo: se generan en memoria y se le pasan al parser
   real (js/png-parser.js), que corre en Node sin navegador porque File, atob
   y DecompressionStream son globales desde Node 18. */

import zlib from 'node:zlib';

const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

const W = 8, H = 8;

function pngBytes(extraChunks = []) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0);
    ihdr.writeUInt32BE(H, 4);
    ihdr[8] = 8;  // 8 bits por canal
    ihdr[9] = 2;  // truecolor RGB
    // Una fila = byte de filtro (0) + W*3 bytes RGB.
    const raw = Buffer.alloc(H * (1 + W * 3));
    for (let y = 0; y < H; y++) {
        const off = y * (1 + W * 3);
        for (let x = 0; x < W; x++) {
            raw[off + 1 + x * 3] = (x * 30) & 0xFF;
            raw[off + 2 + x * 3] = (y * 30) & 0xFF;
            raw[off + 3 + x * 3] = 0x80;
        }
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw)),
        ...extraChunks,
        chunk('IEND', Buffer.alloc(0))
    ]);
}

/** tEXt con keyword y valor arbitrarios: para los casos que no son una carta. */
export function tEXtRaw(keyword, value) {
    return pngBytes([chunk('tEXt', Buffer.concat([
        Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(value, 'utf8')
    ]))]);
}

/** tEXt con el JSON tal cual, sin codificar. */
export function tEXtJson(card) {
    return pngBytes([chunk('tEXt', Buffer.concat([
        Buffer.from('chara', 'latin1'), Buffer.from([0]),
        Buffer.from(JSON.stringify(card), 'utf8')
    ]))]);
}

/** tEXt con el JSON en base64. `url` usa el alfabeto de base64url y sin padding. */
export function tEXtBase64(card, { url = false } = {}) {
    let b64 = Buffer.from(JSON.stringify(card), 'utf8').toString('base64');
    if (url) b64 = b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return pngBytes([chunk('tEXt', Buffer.concat([
        Buffer.from('chara', 'latin1'), Buffer.from([0]), Buffer.from(b64, 'utf8')
    ]))]);
}

/** zTXt: el JSON deflado, que es como lo escriben la mayoria de las herramientas. */
export function zTXt(card) {
    return pngBytes([chunk('zTXt', Buffer.concat([
        Buffer.from('chara', 'latin1'), Buffer.from([0]), Buffer.from([0]),
        zlib.deflateSync(Buffer.from(JSON.stringify(card), 'utf8'))
    ]))]);
}

/** iTXt sin comprimir: keyword, idioma y keyword traducido separados por nulos. */
export function iTXt(card, { lang = 'es', translated = '' } = {}) {
    return pngBytes([chunk('iTXt', Buffer.concat([
        Buffer.from('chara', 'latin1'), Buffer.from([0]),
        Buffer.from([0]), Buffer.from([0]),           // sin comprimir, metodo 0
        Buffer.from(lang, 'latin1'), Buffer.from([0]),
        Buffer.from(translated, 'latin1'), Buffer.from([0]),
        Buffer.from(JSON.stringify(card), 'utf8')
    ]))]);
}

/** PNG valido sin metadatos: lo que pasa si se arrastra una imagen cualquiera. */
export function plainPng() {
    return pngBytes([]);
}

export const toFile = (bytes, name = 'carta.png') =>
    new File([bytes], name, { type: 'image/png' });

/** Una carta v2 completa, con lorebook y saludos alternativos. */
export const sampleCard = () => ({
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
        name: 'Ada Lovelace',
        description: 'Matematica. {{char}} trabaja con {{user}} en la maquina analitica.',
        personality: 'Curiosa y precisa.',
        scenario: 'Londres, 1843.',
        first_mes: 'Buenos dias, soy {{char}}.',
        mes_example: '{{user}}: hola.\n{{char}}: hola.',
        system_prompt: '',
        post_history_instructions: '',
        alternate_greetings: ['Llego tarde, como siempre.'],
        /* No es adorno: con ASCII normal el base64 de la carta no contiene ni +
           ni / (hacen falta ~ ? o > en el tercer byte de cada grupo de tres),
           asi que las variantes base64 y base64url saldrian identicas y el caso
           que comprueba la conversion no estaria probando nada. El test lo
           vigila con un assert antes de usarlo. */
        signature: '~?~?~?>~?>',
        tags: ['historico'],
        character_book: {
            name: 'Mundo',
            entries: [{
                name: 'Maquina analitica',
                keys: ['maquina', 'motor'],
                content: 'Proyectada por Babbage.',
                enabled: true,
                insertion_order: 0,
                extensions: {}
            }],
            extensions: {}
        },
        extensions: {}
    }
});
