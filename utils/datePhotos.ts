import type { Message } from '../types';

export const DATE_PHOTO_SOURCE = 'date_photo';
export const DATE_PHOTO_FAILED_SOURCE = 'date_photo_delivery_failed';

function readString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function compactText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

function truncateText(value: string, limit: number): string {
    const clean = compactText(value);
    return clean.length > limit ? `${clean.slice(0, limit)}...` : clean;
}

export function isDatePhotoMessage(message: Message): boolean {
    return message.type === 'image'
        && message.metadata?.source === DATE_PHOTO_SOURCE
        && message.metadata?.isDatePhoto === true;
}

export function isDatePhotoFailureMessage(message: Message): boolean {
    return message.metadata?.source === DATE_PHOTO_FAILED_SOURCE
        && message.metadata?.hiddenFromUser === true;
}

export function formatDatePhotoContextContent(message: Message, maxChars = 420): string {
    const metadata = message.metadata || {};
    const photoMeta = metadata.photoMeta || {};
    const director = photoMeta.directorResult || {};
    const caption = readString(metadata.caption) || readString(director.caption);
    const visualSummary = readString(metadata.visualSummary) || readString(metadata.photoSummary);
    const continuity = readString(photoMeta.continuity_summary)
        || readString(director.continuity_summary)
        || readString(metadata.continuitySummary)
        || readString(metadata.continuity_summary);
    const scene = readString(director.scene_zh);

    const parts = [
        caption ? `配文「${truncateText(caption, 80)}」` : '',
        visualSummary ? `画面：${truncateText(visualSummary, 180)}` : '',
        continuity ? `后续承接：${truncateText(continuity, 180)}` : '',
        !visualSummary && !continuity && scene ? `画面：${truncateText(scene, 180)}` : '',
    ].filter(Boolean);

    return parts.length > 0
        ? `[见面照片] ${truncateText(parts.join('；'), maxChars)}`
        : '[见面照片]';
}

export function formatDatePhotoFailureContextContent(message: Message, maxChars = 240): string {
    const metadata = message.metadata || {};
    const detail = readString(metadata.errorMessage);
    const content = readString(message.content)
        || '刚才尝试生成一张见面照片，但图片没有成功送达。下一轮不要声称已经发过照片。';
    const suffix = detail ? `；失败原因：${truncateText(detail, 80)}` : '';
    return `[见面照片失败] ${truncateText(`${content}${suffix}`, maxChars)}`;
}

export function filterDatePhotoMessages(messages: Message[], sessionStartMsgId?: number): Message[] {
    return messages
        .filter(isDatePhotoMessage)
        .filter(message => sessionStartMsgId === undefined || message.metadata?.sessionStartMsgId === sessionStartMsgId)
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0) || (a.id || 0) - (b.id || 0));
}

export function filterDatePhotoFailureMessages(messages: Message[], sessionStartMsgId?: number): Message[] {
    return messages
        .filter(isDatePhotoFailureMessage)
        .filter(message => sessionStartMsgId === undefined || message.metadata?.sessionStartMsgId === sessionStartMsgId)
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0) || (a.id || 0) - (b.id || 0));
}
