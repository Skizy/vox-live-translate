export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;

export function bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    const chunkSize = 0x8000;

    for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }

    return btoa(binary);
}

export function base64ToBytes(base64: string) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
}

export function getSilentPcm24kDurationMs(base64Audio: string) {
    const pcmBytes = base64ToBytes(base64Audio);

    if (!pcmBytes.every((byte) => byte === 0)) {
        return undefined;
    }

    return (pcmBytes.byteLength / (OUTPUT_SAMPLE_RATE * Int16Array.BYTES_PER_ELEMENT)) * 1_000;
}
