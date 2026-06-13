export const COLLECTION_WALL_IMAGE_ASSET_MAX_BYTES = 10 * 1024 * 1024;

export function assertCollectionWallImageBlobCanBeSaved(blob: Pick<Blob, 'size'>): void {
    if (!blob.size) {
        throw new Error('读取到的图片为空，换一张再试');
    }
    if (blob.size > COLLECTION_WALL_IMAGE_ASSET_MAX_BYTES) {
        throw new Error('图片超过 10MB，先压缩后再收进拾光墙');
    }
}

export function getCollectionWallImageSaveErrorMessage(error: unknown): string {
    const source = error as { name?: unknown; message?: unknown };
    const name = typeof source?.name === 'string' ? source.name : '';
    const message = typeof source?.message === 'string' ? source.message.trim() : '';
    const searchable = `${name} ${message}`;

    if (/QuotaExceededError|quota|storage|存储空间|空间不足/i.test(searchable)) {
        return '本地素材空间不足，先清理一些图片素材或备份后再试';
    }
    if (/超过\s*10MB|10MB|too large|exceed/i.test(searchable)) {
        return '图片超过 10MB，先压缩后再收进拾光墙';
    }
    if (/Failed to fetch|NetworkError|Load failed|fetch|network|CORS|跨域|读取原图失败|读取图片失败|服务器返回|图片地址为空|链接可能已失效/i.test(searchable)) {
        return message || '读取原图失败，图片链接可能已失效或被浏览器拦截';
    }

    return message || '图片收藏失败，可以稍后再试';
}
