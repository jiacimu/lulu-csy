export function fnv1a(input: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < input.length; index += 1) {
        hash ^= input.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, '0');
}

export function fnv1aWithLength(input: string): string {
    const text = String(input || '');
    return `${fnv1a(text)}-${text.length}`;
}

export function fnv1aBytes(buffer: ArrayBuffer): string {
    let hash = 0x811c9dc5;
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < bytes.length; index += 1) {
        hash ^= bytes[index];
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `${hash.toString(16).padStart(8, '0')}-${bytes.length}`;
}
