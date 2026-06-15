import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const MIME_EXTENSION: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

export function isNativeFileShareAvailable(): boolean {
    try {
        return Capacitor.isNativePlatform();
    } catch {
        return false;
    }
}

function sanitizeFilename(value: string): string {
    return (value || 'sully-image')
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80)
        || 'sully-image';
}

function inferExtension(src: string, mimeType: string): string {
    const mimeExtension = MIME_EXTENSION[mimeType.toLowerCase()];
    if (mimeExtension) return mimeExtension;

    const dataUrlMime = src.match(/^data:([^;,]+)/i)?.[1];
    if (dataUrlMime && MIME_EXTENSION[dataUrlMime.toLowerCase()]) {
        return MIME_EXTENSION[dataUrlMime.toLowerCase()];
    }

    try {
        const pathname = new URL(src).pathname;
        const extension = pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
        if (extension && ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) {
            return extension === 'jpeg' ? 'jpg' : extension;
        }
    } catch {
        // blob: and data: URLs may not expose a useful pathname.
    }

    return 'png';
}

function blobToBase64Payload(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = String(reader.result || '');
            const payload = dataUrl.includes(',') ? dataUrl.split(',').pop() || '' : dataUrl;
            payload ? resolve(payload) : reject(new Error('文件编码为空'));
        };
        reader.onerror = () => reject(reader.error || new Error('文件编码失败'));
        reader.readAsDataURL(blob);
    });
}

async function fetchBlob(src: string): Promise<Blob> {
    const response = await fetch(src);
    if (!response.ok) {
        throw new Error(`图片读取失败: HTTP ${response.status}`);
    }
    return response.blob();
}

export async function shareImageFile(src: string, filenameBase: string): Promise<void> {
    if (!src) throw new Error('图片地址为空');

    const blob = await fetchBlob(src);
    const extension = inferExtension(src, blob.type || 'image/png');
    const filename = `${sanitizeFilename(filenameBase)}.${extension}`;
    const data = await blobToBase64Payload(blob);

    await Filesystem.writeFile({
        path: filename,
        data,
        directory: Directory.Cache,
    });

    const uri = await Filesystem.getUri({
        path: filename,
        directory: Directory.Cache,
    });

    await Share.share({
        title: '保存图片',
        dialogTitle: '保存图片',
        files: [uri.uri],
    });
}
