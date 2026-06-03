import React,{ useState,useEffect,useRef,useMemo } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { AppID,CharacterProfile,GalleryImage,PhoneDesktopAppearance,PhoneEvidence,PhoneCustomApp } from '../types';
import { ContextBuilder } from '../utils/context';
import Modal from '../components/os/Modal';
import { extractContent, extractJson, safeResponseJson } from '../utils/safeApi';
import { getFiniteMessageIds, removePhoneRecordsLinkedToMessageIds } from '../utils/phoneRecordSync';
import { getGalleryImageDisplayUrl,resolveGalleryImageOriginalUrl } from '../utils/generatedImageStorage';
import { searchSongs } from '../utils/musicService';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import type { NeteaseSong } from '../types/music';
import {
    BowlFood,
    Camera,
    ChatTeardrop,
    GearSix,
    MusicNote,
    Phone,
    Plus,
    ShoppingBagOpen,
    WifiHigh,
    type Icon,
} from '@phosphor-icons/react';
// === [Deprecated] 高德地图 POI 搜索已因额度耗尽停用，外卖商家改由大模型生成 ===
// import { searchNearbyRestaurants } from '../utils/mapService';
import MeituanTakeoutCard from '../components/chat/cards/phone/MeituanTakeoutCard';

// 朋友圈封面背景图池 —— 每次进入随机选一张
const MOMENTS_BG_POOL = [
    'https://i.postimg.cc/FKHSBpn0/Camera-1040g3k031roibveui4405pjvpo8gu1m2pj5m6bg.jpg',
    'https://i.postimg.cc/0NySBnHp/Camera-XHS-17719469368011040g2sg31dsqqr5ngccg5o6it4n098c9sr3goe0.jpg',
    'https://i.postimg.cc/W41ZH8fG/Camera-XHS-17719472040941040g2sg31enohhbkmi7g5pu896g399ls9l2jb1o.jpg',
    'https://i.postimg.cc/5yYqkgjj/Camera-XHS-17719473891901040g00831dne1qidge305o3i8irg8p0lbup6im0.jpg',
    'https://i.postimg.cc/prhY1Crw/Camera-XHS-17719479279871040g2sg30ttugsjr4m605ojdbvn8d1ctvlghth8.jpg',
    'https://i.postimg.cc/rs0CYjzK/mmexport1771947836221.jpg',
];

export const MAX_PHONE_RECORDS_PER_APP = 80;
export const MAX_PHONE_RECORDS_TOTAL = 640;
export const MAX_PHONE_VISIBLE_RECORDS = 60;
export const MAX_PHONE_TITLE_CHARS = 96;
export const MAX_PHONE_DETAIL_CHARS = 2400;
export const MAX_PHONE_CHAT_DETAIL_CHARS = 6000;
export const MAX_PHONE_PROMPT_MESSAGES = 50;
const MAX_PHONE_META_CHARS = 160;
const MAX_CHAT_DETAIL_LINES_RENDERED = 120;
const MOBILE_VISIBLE_DELETE_CLASS = 'opacity-100 md:opacity-0 md:group-hover:opacity-100';
const NETEASE_MUSIC_RECORD_TYPE = 'netease_music';

export const NETEASE_MUSIC_PROMPT = `用户正在查看你网易云音乐的「个人主页」。请基于你的人设，生成主页内容，泄露你不会明说的情绪与生活。

输出一个 JSON 对象：

1. profile（资料）：
   - nickname：网易云昵称（贴合性格，不一定真名）
   - level：等级数字（1-10）
   - signature：个性签名一句话（最透性格/心境的一句）
   - playCount：累计听歌总数（整数）

2. playlists（歌单，2-3 个，可含一个"我喜欢的音乐"红心歌单）：
   - name：歌单名（重点！最能泄露心思，贴合性格，别太直白）
   - count：歌单内歌曲总数（整数，可大于下面列出的）
   - songs：该歌单里 10-13 首歌：
       - song / artist：真实存在、网易云可搜到的歌（官方歌名+主要演唱者，避免 live/remix/翻自）
       - tag：状态（如"单曲循环 12 次""红心 / 2015年秋""昨夜 23:45 播放"），可空 ""
       - comment：你在这首歌下留过的话或此刻的心声

要求：选歌、签名、歌单名、批注都贴合人设与处境；所有歌曲必须真实可搜到；批注宁缺毋滥，留白比硬写更有张力。
只输出 JSON，不要前后缀/解释/代码块包裹。
格式：
{
  "profile": { "nickname": "", "level": 8, "signature": "", "playCount": 4821 },
  "playlists": [
    { "name": "", "count": 23, "songs": [
      { "song": "", "artist": "", "tag": "", "comment": "" }
    ]}
  ]
}`;

const limitPhoneText = (value: string, maxChars: number): string => {
    if (value.length <= maxChars) return value;
    return `${value.slice(0, maxChars).trimEnd()}...`;
};

const normalizePhoneText = (value: unknown, fallback = '', maxChars = MAX_PHONE_DETAIL_CHARS): string => {
    let normalized = fallback;

    if (value == null) return fallback;
    if (typeof value === 'string') normalized = value.trim() || fallback;
    else if (typeof value === 'number' || typeof value === 'boolean') normalized = String(value);

    else if (Array.isArray(value)) {
        const parts = value.map(item => normalizePhoneText(item, '')).filter(Boolean);
        normalized = parts.join('; ') || fallback;
    }

    else if (typeof value === 'object') {
        const record = value as Record<string, unknown>;
        const candidate = record.text ?? record.content ?? record.name ?? record.label ?? record.title ?? record.detail ?? record.status ?? record.amount ?? record.value ?? record.shop;
        if (candidate !== undefined && candidate !== value) {
            const normalized = normalizePhoneText(candidate, '');
            if (normalized) return limitPhoneText(normalized, maxChars);
        }

        try {
            normalized = JSON.stringify(value);
        } catch {
            normalized = fallback;
        }
    }

    return limitPhoneText(normalized, maxChars);
};

const normalizeOptionalPhoneText = (value: unknown, maxChars = MAX_PHONE_META_CHARS): string | undefined => {
    const normalized = normalizePhoneText(value, '', maxChars);
    return normalized || undefined;
};

const normalizeTimestamp = (value: unknown): number => {
    const timestamp = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
};

type SelectTargetMode = 'live' | 'recent' | 'idle';

interface SelectTargetMeta {
    character: CharacterProfile;
    mode: SelectTargetMode;
    fingerprint: string;
    statusLabel: string;
    peekLabel: string;
    actionLabel: string;
    signalStrength: number;
    recordsCount: number;
    appCount: number;
    avatarGradient: string;
}

interface AccessOverlayState {
    name: string;
    status: 'connecting' | 'granted';
}

interface DesktopPhotoCard {
    id: string;
    src: string;
    caption: string;
    timestamp: number;
    isFallback?: boolean;
    isCustom?: boolean;
}

interface DesktopAppEntry {
    id: string;
    label: string;
    icon?: Icon;
    emoji?: string;
    customIcon?: string;
    badge?: number | 'dot';
    danger?: boolean;
    isUtility?: boolean;
    customAppId?: string;
    onClick: () => void;
    onDelete?: () => void;
}

interface DesktopCoreAppConfig {
    id: string;
    label: string;
    icon: Icon;
    recordType?: string;
}

interface NeteaseMusicTrace {
    song: string;
    artist: string;
    tag: string;
    comment: string;
}

interface NeteaseMusicProfile {
    nickname: string;
    level: number;
    signature: string;
    playCount: number;
}

interface NeteaseMusicPlaylist {
    name: string;
    count: number;
    songs: NeteaseMusicTrace[];
}

interface NeteaseMusicProfilePayload {
    profile: NeteaseMusicProfile;
    playlists: NeteaseMusicPlaylist[];
}

interface NeteaseMusicPlaylistView {
    key: string;
    name: string;
    count: number;
    index: number;
    records: PhoneEvidence[];
}

const CHECKPHONE_AVATAR_GRADIENTS = [
    'radial-gradient(120% 120% at 30% 20%, #3a4d6e, #161d2b)',
    'radial-gradient(120% 120% at 70% 10%, #4d4036, #1f1813)',
    'radial-gradient(120% 120% at 40% 30%, #3b4a44, #161d1a)',
    'radial-gradient(120% 120% at 60% 20%, #4a3a4d, #1c151f)',
    'radial-gradient(120% 120% at 35% 15%, #4f4a2f, #1a1810)',
];

const CHECKPHONE_DESKTOP_CAPTIONS = ['午后', '夜色', '初夏'];
const CHECKPHONE_DESKTOP_PHOTO_SLOT_COUNT = 3;
const CHECKPHONE_DESKTOP_APP_PAGE_SIZE = 8;
const CHECKPHONE_DESKTOP_PAGE_APPS: DesktopCoreAppConfig[] = [
    { id: 'chat', label: '信息', icon: ChatTeardrop, recordType: 'chat' },
    { id: NETEASE_MUSIC_RECORD_TYPE, label: '网易云音乐', icon: MusicNote, recordType: NETEASE_MUSIC_RECORD_TYPE },
    { id: 'taobao', label: '淘宝', icon: ShoppingBagOpen, recordType: 'order' },
    { id: 'delivery', label: '美团外卖', icon: BowlFood, recordType: 'delivery' },
    { id: 'social', label: '朋友圈', icon: Camera, recordType: 'social' },
];
const CHECKPHONE_DESKTOP_DOCK_APPS: DesktopCoreAppConfig[] = [
    { id: 'call', label: '通话记录', icon: Phone, recordType: 'call' },
    { id: 'settings', label: '设置', icon: GearSix },
];
const NETEASE_PROFILE_ART_GRADIENTS = [
    'linear-gradient(155deg,#4a5066,#1b1e2b)',
    'linear-gradient(155deg,#7a564a,#2c1a16)',
    'linear-gradient(155deg,#5c574c,#1f1c16)',
    'linear-gradient(155deg,#445a54,#16201d)',
    'linear-gradient(155deg,#6a4a58,#241620)',
    'linear-gradient(155deg,#8a6f4c,#2b2118)',
];

const getNeteaseProfileArtGradient = (index: number): string =>
    NETEASE_PROFILE_ART_GRADIENTS[index % NETEASE_PROFILE_ART_GRADIENTS.length];

const formatNeteaseProfileNumber = (value: number): string =>
    new Intl.NumberFormat('zh-CN').format(value);

const formatNeteaseProfileIndex = (index: number): string =>
    String(index + 1).padStart(2, '0');

const buildCheckPhoneDeviceHash = (value: string): string => {
    let hash = 2166136261;
    for (const char of value) {
        hash ^= char.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    const hex = (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
    return `${hex.slice(0, 2)}-${hex.slice(2, 6)}-${hex.slice(6, 8)}`;
};

const getLatestTargetSignal = (character: CharacterProfile): number => {
    const latestRecord = Math.max(
        0,
        ...(character.phoneState?.records || []).map(record => normalizeTimestamp(record.timestamp))
    );
    const moodUpdatedAt = normalizeTimestamp((character.moodState as { updatedAt?: unknown } | undefined)?.updatedAt);
    return Math.max(latestRecord, moodUpdatedAt);
};

const formatTargetSignalAge = (timestamp: number): string => {
    if (!timestamp) return '等待首次采样';

    const diffMs = Math.max(0, Date.now() - timestamp);
    const diffMins = Math.floor(diffMs / 60_000);
    const diffHours = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 5) return '刚刚活跃';
    if (diffMins < 60) return `${diffMins} 分钟前`;
    if (diffHours < 24) return `${diffHours} 小时前`;
    return `${diffDays} 天前`;
};

const formatTargetDisplayName = (name: string): string => {
    const trimmed = name.trim();
    if (trimmed.length > 1 && trimmed.length <= 3 && !/\s/.test(trimmed)) {
        return Array.from(trimmed).join(' ');
    }
    return trimmed || 'Unknown';
};

const formatDesktopClock = (date: Date): string =>
    date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

const formatDesktopDateLine = (date: Date): string => {
    const weekday = date.toLocaleDateString('zh-CN', { weekday: 'short' });
    return `${weekday} · 多云 13°`;
};

const formatDesktopActiveTime = (date: Date): string =>
    date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

const formatGalleryPhotoCaption = (image: GalleryImage, index: number): string => {
    if (image.savedDate) return image.savedDate.replace(/-/g, '.');
    const summary = image.visualSummary?.trim();
    if (summary) return limitPhoneText(summary, 10);
    return CHECKPHONE_DESKTOP_CAPTIONS[index] || `照片 ${index + 1}`;
};

const toDesktopPhotoCard = (image: GalleryImage, index: number, src?: string): DesktopPhotoCard => ({
    id: image.id,
    src: src || getGalleryImageDisplayUrl(image) || image.url || '',
    caption: formatGalleryPhotoCaption(image, index),
    timestamp: normalizeTimestamp(image.timestamp),
});

const stripJsonFence = (value: string): string =>
    value
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

export const parseNeteaseMusicTraceJson = (content: string): unknown[] => {
    try {
        const parsed = JSON.parse(stripJsonFence(content));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

export const parseNeteaseMusicProfileJson = (content: string): unknown | null => {
    try {
        return JSON.parse(stripJsonFence(content));
    } catch {
        return null;
    }
};

const normalizeNeteaseInteger = (value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number => {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, Math.trunc(parsed)));
};

const normalizeGeneratedNeteaseProfile = (value: unknown): NeteaseMusicProfile => {
    const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
        nickname: normalizePhoneText(source.nickname ?? source.name, '未命名', MAX_PHONE_TITLE_CHARS),
        level: normalizeNeteaseInteger(source.level, 1, 1, 10),
        signature: normalizePhoneText(source.signature ?? source.bio ?? source.detail, '', MAX_PHONE_DETAIL_CHARS),
        playCount: normalizeNeteaseInteger(source.playCount ?? source.listenCount ?? source.count, 0, 0),
    };
};

export const normalizeGeneratedNeteaseMusicTrace = (item: unknown): NeteaseMusicTrace | null => {
    const source = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const song = normalizePhoneText(source.song ?? source.title ?? source.name, '', MAX_PHONE_TITLE_CHARS);
    const artist = normalizePhoneText(source.artist ?? source.singer ?? source.author, '', MAX_PHONE_META_CHARS);
    if (!song || !artist) return null;

    return {
        song,
        artist,
        tag: normalizePhoneText(source.tag ?? source.value ?? source.status, '', MAX_PHONE_META_CHARS),
        comment: normalizePhoneText(source.comment ?? source.detail ?? source.content, '', MAX_PHONE_DETAIL_CHARS),
    };
};

export const normalizeGeneratedNeteaseMusicProfilePayload = (item: unknown): NeteaseMusicProfilePayload | null => {
    const source = item && typeof item === 'object' && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
    const rawPlaylists = Array.isArray(source.playlists)
        ? source.playlists
        : Array.isArray(item)
            ? [{ name: '最近听歌痕迹', count: item.length, songs: item }]
            : [];

    const playlists = rawPlaylists
        .slice(0, 3)
        .map((playlist, playlistIndex): NeteaseMusicPlaylist | null => {
            const playlistSource = playlist && typeof playlist === 'object'
                ? playlist as Record<string, unknown>
                : {};
            const rawSongs = Array.isArray(playlistSource.songs) ? playlistSource.songs : [];
            const songs = rawSongs
                .slice(0, 13)
                .map(normalizeGeneratedNeteaseMusicTrace)
                .filter((trace): trace is NeteaseMusicTrace => Boolean(trace));

            if (songs.length === 0) return null;

            return {
                name: normalizePhoneText(
                    playlistSource.name ?? playlistSource.title,
                    playlistIndex === 0 ? '我喜欢的音乐' : `歌单 ${playlistIndex + 1}`,
                    MAX_PHONE_TITLE_CHARS
                ),
                count: normalizeNeteaseInteger(playlistSource.count, songs.length, songs.length),
                songs,
            };
        })
        .filter((playlist): playlist is NeteaseMusicPlaylist => Boolean(playlist));

    if (playlists.length === 0) return null;

    return {
        profile: normalizeGeneratedNeteaseProfile(source.profile),
        playlists,
    };
};

const getNeteaseArtistLine = (song: NeteaseSong): string =>
    song.artists.map(artist => artist.name).filter(Boolean).join(' / ');

const buildNeteaseSongUrl = (songId: number): string =>
    `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;

const splitNeteaseArtistLine = (artistLine?: string): string[] => {
    const artists = normalizePhoneText(artistLine, '未知歌手', MAX_PHONE_META_CHARS)
        .split(/\s*(?:\/|／|、|,|，|&|＆)\s*/)
        .map(name => name.trim())
        .filter(Boolean);

    return artists.length > 0 ? artists : ['未知歌手'];
};

export const phoneRecordToNeteaseSong = (record: PhoneEvidence): NeteaseSong | null => {
    if (!record.songId || record.songId <= 0) return null;

    return {
        kind: 'song',
        id: record.songId,
        name: record.title || '未知歌曲',
        artists: splitNeteaseArtistLine(record.artist || record.detail.split('\n')[0]).map(name => ({ id: 0, name })),
        album: {
            kind: 'album',
            id: 0,
            name: '',
            picUrl: record.albumCover,
        },
        duration: 0,
    };
};

export const buildNeteaseMusicProfileViewModel = (
    records: PhoneEvidence[],
    fallbackName = '听歌的人'
): { profile: NeteaseMusicProfile; playlists: NeteaseMusicPlaylistView[] } => {
    const sortedRecords = [...records].sort((a, b) => {
        const playlistDelta = (a.playlistIndex ?? 999) - (b.playlistIndex ?? 999);
        if (playlistDelta !== 0) return playlistDelta;
        const songDelta = (a.songIndex ?? 999) - (b.songIndex ?? 999);
        if (songDelta !== 0) return songDelta;
        return b.timestamp - a.timestamp;
    });
    const newestRecord = [...records].sort((a, b) => b.timestamp - a.timestamp)[0];
    const grouped = new Map<string, NeteaseMusicPlaylistView>();

    for (const record of sortedRecords) {
        const playlistIndex = record.playlistIndex ?? 0;
        const playlistName = record.playlistName || '最近听歌痕迹';
        const key = `${playlistIndex}:${playlistName}`;
        const existing = grouped.get(key);

        if (existing) {
            existing.records.push(record);
        } else {
            grouped.set(key, {
                key,
                name: playlistName,
                count: record.playlistCount || sortedRecords.filter(item => item.playlistName === playlistName).length,
                index: playlistIndex,
                records: [record],
            });
        }
    }

    return {
        profile: {
            nickname: newestRecord?.profileNickname || fallbackName,
            level: newestRecord?.profileLevel || 1,
            signature: newestRecord?.profileSignature || '把没说出口的话都放进播放列表。',
            playCount: newestRecord?.profilePlayCount || records.length,
        },
        playlists: [...grouped.values()].sort((a, b) => a.index - b.index),
    };
};

const resolveNeteaseMusicTrace = async (trace: NeteaseMusicTrace) => {
    try {
        const result = await searchSongs(`${trace.song} ${trace.artist}`, 1, 0);
        const matchedSong = result.songs?.[0];
        if (!matchedSong) return { trace };

        return {
            trace,
            matchedSong,
            songUrl: buildNeteaseSongUrl(matchedSong.id),
        };
    } catch {
        return { trace };
    }
};

const chunkDesktopApps = <T,>(items: T[], size: number): T[][] => {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks.length ? chunks : [[]];
};

const getDesktopFanRotation = (count: number, index: number): number => {
    if (count <= 1) return 0;
    if (count === 2) return index === 0 ? -10 : 10;
    return [-15, 0, 15][index] ?? 0;
};

const readImageFileAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
};

const buildSelectTargetMeta = (character: CharacterProfile, index: number): SelectTargetMeta => {
    const latestSignal = getLatestTargetSignal(character);
    const recordsCount = character.phoneState?.records?.length || 0;
    const appCount = CHECKPHONE_DESKTOP_PAGE_APPS.length + CHECKPHONE_DESKTOP_DOCK_APPS.length + (character.phoneState?.customApps?.length || 0);
    const diffMs = latestSignal ? Date.now() - latestSignal : Number.POSITIVE_INFINITY;
    const mode: SelectTargetMode = index === 0 || diffMs < 5 * 60_000
        ? 'live'
        : latestSignal
            ? 'recent'
            : 'idle';
    const signalStrength = mode === 'live'
        ? 4
        : mode === 'recent'
            ? Math.max(1, 4 - Math.floor(Math.max(0, diffMs) / (6 * 3_600_000)))
            : 1;
    const ageLabel = formatTargetSignalAge(latestSignal);

    return {
        character,
        mode,
        fingerprint: buildCheckPhoneDeviceHash(`${character.id}-${character.name}-${index}`),
        statusLabel: mode === 'live' ? '在线' : ageLabel,
        peekLabel: mode === 'live'
            ? '实时镜像 · 可接入'
            : mode === 'recent'
                ? `最近缓存 · ${ageLabel}`
                : '静默设备 · 等待采样',
        actionLabel: mode === 'live'
            ? '接入实时画面'
            : mode === 'recent'
                ? '建立连接'
                : '读取设备缓存',
        signalStrength,
        recordsCount,
        appCount,
        avatarGradient: CHECKPHONE_AVATAR_GRADIENTS[index % CHECKPHONE_AVATAR_GRADIENTS.length],
    };
};

export const normalizeGeneratedPhoneItem = (item: unknown): Pick<PhoneEvidence, 'title' | 'detail' | 'value' | 'shop'> => {
    const source = item && typeof item === 'object' ? item as Record<string, unknown> : { detail: item };
    return {
        title: normalizePhoneText(source.title ?? source.name ?? source.label, 'Unknown', MAX_PHONE_TITLE_CHARS),
        detail: normalizePhoneText(source.detail ?? source.content ?? source.text ?? source.items, '...', MAX_PHONE_DETAIL_CHARS),
        value: normalizeOptionalPhoneText(source.value ?? source.amount ?? source.price),
        shop: normalizeOptionalPhoneText(source.shop ?? source.store ?? source.status)
    };
};

export const normalizeStoredPhoneRecord = (record: PhoneEvidence): PhoneEvidence => {
    const unsafeRecord = record as unknown as Record<string, unknown>;
    const type = normalizePhoneText(unsafeRecord.type, 'generic', MAX_PHONE_META_CHARS);
    const detailLimit = type === 'chat' ? MAX_PHONE_CHAT_DETAIL_CHARS : MAX_PHONE_DETAIL_CHARS;
    const systemMessageId = typeof unsafeRecord.systemMessageId === 'number' ? unsafeRecord.systemMessageId : undefined;
    const value = normalizeOptionalPhoneText(unsafeRecord.value);
    const shop = normalizeOptionalPhoneText(unsafeRecord.shop);
    const artist = normalizeOptionalPhoneText(unsafeRecord.artist);
    const comment = normalizeOptionalPhoneText(unsafeRecord.comment, MAX_PHONE_DETAIL_CHARS);
    const songId = typeof unsafeRecord.songId === 'number' && Number.isFinite(unsafeRecord.songId) && unsafeRecord.songId > 0
        ? Math.trunc(unsafeRecord.songId)
        : undefined;
    const songUrl = normalizeOptionalPhoneText(unsafeRecord.songUrl, MAX_PHONE_DETAIL_CHARS);
    const albumCover = normalizeOptionalPhoneText(unsafeRecord.albumCover, MAX_PHONE_DETAIL_CHARS);
    const profileNickname = normalizeOptionalPhoneText(unsafeRecord.profileNickname, MAX_PHONE_TITLE_CHARS);
    const profileLevel = typeof unsafeRecord.profileLevel === 'number' && Number.isFinite(unsafeRecord.profileLevel)
        ? normalizeNeteaseInteger(unsafeRecord.profileLevel, 1, 1, 10)
        : undefined;
    const profileSignature = normalizeOptionalPhoneText(unsafeRecord.profileSignature, MAX_PHONE_DETAIL_CHARS);
    const profilePlayCount = typeof unsafeRecord.profilePlayCount === 'number' && Number.isFinite(unsafeRecord.profilePlayCount)
        ? normalizeNeteaseInteger(unsafeRecord.profilePlayCount, 0, 0)
        : undefined;
    const playlistName = normalizeOptionalPhoneText(unsafeRecord.playlistName, MAX_PHONE_TITLE_CHARS);
    const playlistCount = typeof unsafeRecord.playlistCount === 'number' && Number.isFinite(unsafeRecord.playlistCount)
        ? normalizeNeteaseInteger(unsafeRecord.playlistCount, 0, 0)
        : undefined;
    const playlistIndex = typeof unsafeRecord.playlistIndex === 'number' && Number.isFinite(unsafeRecord.playlistIndex)
        ? normalizeNeteaseInteger(unsafeRecord.playlistIndex, 0, 0)
        : undefined;
    const songIndex = typeof unsafeRecord.songIndex === 'number' && Number.isFinite(unsafeRecord.songIndex)
        ? normalizeNeteaseInteger(unsafeRecord.songIndex, 0, 0)
        : undefined;

    const normalized: PhoneEvidence = {
        id: normalizePhoneText(unsafeRecord.id, `rec-${normalizeTimestamp(unsafeRecord.timestamp) || 'unknown'}`, MAX_PHONE_META_CHARS),
        type,
        title: normalizePhoneText(unsafeRecord.title, 'Unknown', MAX_PHONE_TITLE_CHARS),
        detail: normalizePhoneText(unsafeRecord.detail, '...', detailLimit),
        timestamp: normalizeTimestamp(unsafeRecord.timestamp),
    };

    if (systemMessageId !== undefined) normalized.systemMessageId = systemMessageId;
    if (value !== undefined) normalized.value = value;
    if (shop !== undefined) normalized.shop = shop;
    if (artist !== undefined) normalized.artist = artist;
    if (comment !== undefined) normalized.comment = comment;
    if (songId !== undefined) normalized.songId = songId;
    if (songUrl !== undefined) normalized.songUrl = songUrl;
    if (albumCover !== undefined) normalized.albumCover = albumCover;
    if (profileNickname !== undefined) normalized.profileNickname = profileNickname;
    if (profileLevel !== undefined) normalized.profileLevel = profileLevel;
    if (profileSignature !== undefined) normalized.profileSignature = profileSignature;
    if (profilePlayCount !== undefined) normalized.profilePlayCount = profilePlayCount;
    if (playlistName !== undefined) normalized.playlistName = playlistName;
    if (playlistCount !== undefined) normalized.playlistCount = playlistCount;
    if (playlistIndex !== undefined) normalized.playlistIndex = playlistIndex;
    if (songIndex !== undefined) normalized.songIndex = songIndex;

    return normalized;
};

export const prunePhoneRecords = (records: PhoneEvidence[]): PhoneEvidence[] => {
    const normalized = records
        .map((record, index) => ({ record: normalizeStoredPhoneRecord(record), index }))
        .sort((a, b) => (b.record.timestamp - a.record.timestamp) || (b.index - a.index));

    const countByType = new Map<string, number>();
    const kept: Array<{ record: PhoneEvidence; index: number }> = [];

    for (const item of normalized) {
        const typeCount = countByType.get(item.record.type) || 0;
        if (typeCount >= MAX_PHONE_RECORDS_PER_APP) continue;

        countByType.set(item.record.type, typeCount + 1);
        kept.push(item);

        if (kept.length >= MAX_PHONE_RECORDS_TOTAL) break;
    }

    return kept
        .sort((a, b) => (a.record.timestamp - b.record.timestamp) || (a.index - b.index))
        .map(item => item.record);
};

export interface NormalizedPhoneState {
    records: PhoneEvidence[];
    customApps: PhoneCustomApp[];
    desktopAppearance?: PhoneDesktopAppearance;
}

interface GenerateOptions {
    replaceExisting?: boolean;
}

type ContextExitAction = 'exit_phone' | 'close_app';

export const normalizePhoneState = (
    phoneState: CharacterProfile['phoneState'] | undefined,
): NormalizedPhoneState => {
    const desktopAppearance = phoneState?.desktopAppearance;
    return {
        records: prunePhoneRecords(phoneState?.records || []),
        customApps: phoneState?.customApps || [],
        ...(desktopAppearance ? { desktopAppearance } : {}),
    };
};

const phoneRecordEquals = (a: PhoneEvidence, b: PhoneEvidence): boolean => {
    const aKeys = Object.keys(a as unknown as Record<string, unknown>).sort().join('|');
    const bKeys = Object.keys(b as unknown as Record<string, unknown>).sort().join('|');

    return (
        aKeys === bKeys &&
        a.id === b.id &&
        a.type === b.type &&
        a.title === b.title &&
        a.detail === b.detail &&
        a.timestamp === b.timestamp &&
        a.systemMessageId === b.systemMessageId &&
        a.value === b.value &&
        a.shop === b.shop &&
        a.artist === b.artist &&
        a.comment === b.comment &&
        a.songId === b.songId &&
        a.songUrl === b.songUrl &&
        a.albumCover === b.albumCover &&
        a.profileNickname === b.profileNickname &&
        a.profileLevel === b.profileLevel &&
        a.profileSignature === b.profileSignature &&
        a.profilePlayCount === b.profilePlayCount &&
        a.playlistName === b.playlistName &&
        a.playlistCount === b.playlistCount &&
        a.playlistIndex === b.playlistIndex &&
        a.songIndex === b.songIndex
    );
};

export const phoneStateNeedsNormalization = (
    current: CharacterProfile['phoneState'] | undefined,
    normalized = normalizePhoneState(current),
): boolean => {
    const records = current?.records || [];
    if (records.length !== normalized.records.length) return true;
    for (let i = 0; i < records.length; i += 1) {
        if (!phoneRecordEquals(records[i], normalized.records[i])) return true;
    }
    return false;
};

export const unlinkPhoneRecordFromContext = (record: PhoneEvidence): PhoneEvidence => {
    const nextRecord = { ...record };
    delete nextRecord.systemMessageId;
    return nextRecord;
};

export function buildPhoneSystemMessageDraft(input: {
    type: string;
    charName: string;
    charAvatar?: string;
    logPrefix: string;
    title: string;
    detail: string;
    value?: string;
    shop?: string;
    artist?: string;
    comment?: string;
    songId?: number;
    songUrl?: string;
    albumCover?: string;
    profileNickname?: string;
    profileLevel?: number;
    profileSignature?: string;
    profilePlayCount?: number;
    playlistName?: string;
    playlistCount?: number;
    playlistIndex?: number;
    songIndex?: number;
}) {
    const detailLimit = input.type === 'chat' ? MAX_PHONE_CHAT_DETAIL_CHARS : MAX_PHONE_DETAIL_CHARS;
    const phoneDetail = normalizePhoneText(input.detail, '', detailLimit);
    const inlineDetail = phoneDetail.replace(/\n/g, ' ');
    const phoneLabel = input.logPrefix || input.type;
    const content = input.type === 'chat'
        ? `[系统: ${input.charName} 与 "${input.title}" 的聊天记录-内容涉及: ${inlineDetail}]`
        : `[系统: ${input.charName}的手机(${phoneLabel}) 显示: ${input.title} - ${inlineDetail}]`;

    return {
        content,
        metadata: {
            source: 'phone',
            phoneType: input.type,
            phoneLabel,
            phoneTitle: limitPhoneText(input.title, MAX_PHONE_TITLE_CHARS),
            phoneDetail,
            phoneValue: input.value ? limitPhoneText(input.value, MAX_PHONE_META_CHARS) : null,
            phoneShop: input.shop ? limitPhoneText(input.shop, MAX_PHONE_META_CHARS) : null,
            phoneArtist: input.artist ? limitPhoneText(input.artist, MAX_PHONE_META_CHARS) : null,
            phoneComment: input.comment ? limitPhoneText(input.comment, MAX_PHONE_DETAIL_CHARS) : null,
            phoneSongId: input.songId ?? null,
            phoneSongUrl: input.songUrl ? limitPhoneText(input.songUrl, MAX_PHONE_DETAIL_CHARS) : null,
            phoneAlbumCover: input.albumCover ? limitPhoneText(input.albumCover, MAX_PHONE_DETAIL_CHARS) : null,
            phoneProfileNickname: input.profileNickname ? limitPhoneText(input.profileNickname, MAX_PHONE_TITLE_CHARS) : null,
            phoneProfileLevel: input.profileLevel ?? null,
            phoneProfileSignature: input.profileSignature ? limitPhoneText(input.profileSignature, MAX_PHONE_DETAIL_CHARS) : null,
            phoneProfilePlayCount: input.profilePlayCount ?? null,
            phonePlaylistName: input.playlistName ? limitPhoneText(input.playlistName, MAX_PHONE_TITLE_CHARS) : null,
            phonePlaylistCount: input.playlistCount ?? null,
            phonePlaylistIndex: input.playlistIndex ?? null,
            phoneSongIndex: input.songIndex ?? null,
            charName: input.charName,
            charAvatar: input.charAvatar
        }
    };
}

// === [LEGACY] 原配合 searchNearbyRestaurants 使用，暂停 ===
// function shuffleAndPick<T>(arr: T[], count: number): T[] {
//     const shuffled = [...arr].sort(() => Math.random() - 0.5);
//     return shuffled.slice(0, count);
// }

const CheckPhone: React.FC = () => {
    const { closeApp, openApp, characters, updateCharacter, apiConfig, addToast, userProfile } = useOS();
    const { playSong } = useAudioPlayer();
    const [view, setView] = useState<'select' | 'phone'>('select');
    // activeAppId: 'home' | 'chat_detail' | 'app_id'
    const [activeAppId, setActiveAppId] = useState<string>('home');
    const [targetChar, setTargetChar] = useState<CharacterProfile | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [accessOverlay, setAccessOverlay] = useState<AccessOverlayState | null>(null);
    const accessTimersRef = useRef<number[]>([]);

    // Chat Detail State
    const [selectedChatRecord, setSelectedChatRecord] = useState<PhoneEvidence | null>(null);
    const chatEndRef = useRef<HTMLDivElement>(null);

    // Custom App Creation State
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newAppName, setNewAppName] = useState('');
    const [newAppIcon, setNewAppIcon] = useState('📱');
    const [newAppColor, setNewAppColor] = useState('#3b82f6');
    const [newAppPrompt, setNewAppPrompt] = useState('');
    const [desktopNow, setDesktopNow] = useState(() => new Date());
    const [desktopGalleryPhotos, setDesktopGalleryPhotos] = useState<DesktopPhotoCard[]>([]);
    const [activeDesktopPhotoId, setActiveDesktopPhotoId] = useState<string | null>(null);
    const [desktopPage, setDesktopPage] = useState(0);
    const [showDesktopSettings, setShowDesktopSettings] = useState(false);
    const [desktopIconUploadTargetId, setDesktopIconUploadTargetId] = useState<string | null>(null);
    const [desktopPhotoUploadSlot, setDesktopPhotoUploadSlot] = useState<number | null>(null);
    const [isDesktopEditing, setIsDesktopEditing] = useState(false);
    const [openNeteasePlaylistKeys, setOpenNeteasePlaylistKeys] = useState<Record<string, boolean>>({});
    const [openNeteaseSongId, setOpenNeteaseSongId] = useState<string | null>(null);
    const [neteaseConfirmRecord, setNeteaseConfirmRecord] = useState<PhoneEvidence | null>(null);
    const [pendingPhoneContextRecordIds, setPendingPhoneContextRecordIds] = useState<string[]>([]);
    const [contextExitAction, setContextExitAction] = useState<ContextExitAction | null>(null);
    const [isResolvingContextExit, setIsResolvingContextExit] = useState(false);
    const desktopPagerRef = useRef<HTMLDivElement | null>(null);
    const desktopEditTimerRef = useRef<number | null>(null);
    const desktopLongPressTriggeredRef = useRef(false);
    const desktopWallpaperInputRef = useRef<HTMLInputElement | null>(null);
    const desktopIconInputRef = useRef<HTMLInputElement | null>(null);
    const desktopPhotoInputRef = useRef<HTMLInputElement | null>(null);

    // Derived state for evidence records
    const records = useMemo(
        () => prunePhoneRecords(targetChar?.phoneState?.records || []),
        [targetChar?.phoneState?.records]
    );
    const pendingPhoneContextRecords = useMemo(() => {
        if (pendingPhoneContextRecordIds.length === 0) return [];
        const pendingIds = new Set(pendingPhoneContextRecordIds);
        return records.filter(record => pendingIds.has(record.id) && typeof record.systemMessageId === 'number');
    }, [pendingPhoneContextRecordIds, records]);
    const customApps = targetChar?.phoneState?.customApps || [];
    const desktopAppearance = targetChar?.phoneState?.desktopAppearance || {};
    const desktopIconOverrides = desktopAppearance.appIcons || {};
    const desktopCustomPhotoCount = (desktopAppearance.galleryPhotos || [])
        .slice(0, CHECKPHONE_DESKTOP_PHOTO_SLOT_COUNT)
        .filter(photo => Boolean(photo?.trim())).length;
    const selectTargets = useMemo(
        () => characters.map((character, index) => buildSelectTargetMeta(character, index)),
        [characters]
    );
    const desktopPhotoCards = useMemo<DesktopPhotoCard[]>(() => {
        if (!targetChar) return [];

        const customPhotos = (desktopAppearance.galleryPhotos || []).slice(0, CHECKPHONE_DESKTOP_PHOTO_SLOT_COUNT);
        const fallbackSrc = targetChar.dateBackground || targetChar.avatar || '';
        return Array.from({ length: CHECKPHONE_DESKTOP_PHOTO_SLOT_COUNT }, (_, index) => {
            const customSrc = customPhotos[index]?.trim();
            if (customSrc) {
                return {
                    id: `custom-${targetChar.id}-${index}`,
                    src: customSrc,
                    caption: `原图 ${index + 1}`,
                    timestamp: index,
                    isCustom: true,
                };
            }

            const galleryPhoto = desktopGalleryPhotos[index];
            if (galleryPhoto) return galleryPhoto;

            return {
                id: `fallback-${targetChar.id}-${index}`,
                src: index === 0 ? fallbackSrc : '',
                caption: index === 0 && fallbackSrc ? '壁纸' : `照片 ${index + 1}`,
                timestamp: index,
                isFallback: true,
            };
        });
    }, [desktopAppearance.galleryPhotos, desktopGalleryPhotos, targetChar?.avatar, targetChar?.dateBackground, targetChar?.id]);
    const desktopSettingsApps = useMemo(
        () => [
            ...CHECKPHONE_DESKTOP_PAGE_APPS,
            ...CHECKPHONE_DESKTOP_DOCK_APPS,
            ...customApps.map(app => ({
                id: app.id,
                label: app.name,
                emoji: app.icon,
                isCustom: true,
            })),
        ],
        [customApps]
    );
    const getRecentRecordsByType = (type: string) =>
        records
            .filter(r => r.type === type)
            .sort((a, b) => b.timestamp - a.timestamp)
            .slice(0, MAX_PHONE_VISIBLE_RECORDS);

    const normalizeTargetCharacter = (character: CharacterProfile): CharacterProfile => {
        const normalizedPhoneState = normalizePhoneState(character.phoneState);
        if (!phoneStateNeedsNormalization(character.phoneState, normalizedPhoneState)) return character;
        updateCharacter(character.id, { phoneState: normalizedPhoneState });
        return { ...character, phoneState: normalizedPhoneState };
    };

    useEffect(() => {
        const timer = window.setInterval(() => setDesktopNow(new Date()), 30_000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => () => {
        accessTimersRef.current.forEach(timer => window.clearTimeout(timer));
        if (desktopEditTimerRef.current !== null) window.clearTimeout(desktopEditTimerRef.current);
    }, []);

    useEffect(() => {
        let cancelled = false;

        if (!targetChar) {
            setDesktopGalleryPhotos([]);
            setDesktopPage(0);
            setIsDesktopEditing(false);
            return;
        }

        DB.getGalleryImages(targetChar.id)
            .then(async images => {
                const latestImages = [...images]
                    .sort((a, b) => normalizeTimestamp(b.timestamp) - normalizeTimestamp(a.timestamp))
                    .slice(0, CHECKPHONE_DESKTOP_PHOTO_SLOT_COUNT);
                const previewCards = latestImages.map((image, index) => toDesktopPhotoCard(image, index));

                if (!cancelled) {
                    setDesktopGalleryPhotos(previewCards);
                    setDesktopPage(0);
                }

                const originalCards = await Promise.all(latestImages.map(async (image, index) => {
                    const previewSrc = previewCards[index]?.src || image.url || '';
                    try {
                        const originalSrc = await resolveGalleryImageOriginalUrl(image);
                        return toDesktopPhotoCard(image, index, originalSrc || previewSrc);
                    } catch {
                        return toDesktopPhotoCard(image, index, previewSrc);
                    }
                }));

                if (!cancelled) {
                    setDesktopGalleryPhotos(originalCards);
                }
            })
            .catch(error => {
                console.warn('[CheckPhone] Failed to load gallery photos for desktop:', error);
                if (!cancelled) setDesktopGalleryPhotos([]);
            });

        return () => {
            cancelled = true;
        };
    }, [targetChar?.id]);

    useEffect(() => {
        setActiveDesktopPhotoId(current => (
            desktopPhotoCards.some(photo => photo.id === current)
                ? current
                : desktopPhotoCards[0]?.id || null
        ));
    }, [desktopPhotoCards]);

    useEffect(() => {
        if (targetChar) {
            // Keep targetChar in sync with global state if it updates (e.g. deletion)
            const updated = characters.find(c => c.id === targetChar.id);
            if (updated) {
                const normalizedCharacter = normalizeTargetCharacter(updated);
                setTargetChar(normalizedCharacter);
                // Update selected record ref if open
                if (selectedChatRecord) {
                    const freshRecord = normalizedCharacter.phoneState?.records?.find(r => r.id === selectedChatRecord.id);
                    if (freshRecord) setSelectedChatRecord(normalizeStoredPhoneRecord(freshRecord));
                }
            }
        }
    }, [characters]);

    useEffect(() => {
        if (!targetChar || view !== 'phone') return;

        const linkedMessageIds = getFiniteMessageIds(
            records
                .map(record => record.systemMessageId)
                .filter((id): id is number => typeof id === 'number')
        );
        if (linkedMessageIds.length === 0) return;

        let cancelled = false;
        DB.getMessagesByIds(linkedMessageIds)
            .then(existingMessages => {
                if (cancelled) return;
                const existingMessageIds = new Set(existingMessages.map(message => message.id));
                const missingMessageIds = linkedMessageIds.filter(id => !existingMessageIds.has(id));
                const nextPhoneState = removePhoneRecordsLinkedToMessageIds(targetChar.phoneState, missingMessageIds);
                if (!nextPhoneState) return;

                updateCharacter(targetChar.id, { phoneState: nextPhoneState });
                setTargetChar(prev => prev && prev.id === targetChar.id
                    ? { ...prev, phoneState: nextPhoneState }
                    : prev
                );

                if (
                    selectedChatRecord?.systemMessageId
                    && missingMessageIds.includes(selectedChatRecord.systemMessageId)
                ) {
                    setSelectedChatRecord(null);
                    setActiveAppId('chat');
                }
            })
            .catch(error => {
                console.warn('[CheckPhone] Failed to reconcile phone records with chat history:', error);
            });

        return () => {
            cancelled = true;
        };
    }, [targetChar?.id, view, records, selectedChatRecord?.systemMessageId, updateCharacter]);

    // Reset page scroll on navigation to prevent mobile layout shift
    useEffect(() => {
        window.scrollTo(0, 0);
    }, [activeAppId, view]);

    // 朋友圈封面：每次组件挂载随机选一张背景
    const momentsCoverBg = useMemo(() =>
        MOMENTS_BG_POOL[Math.floor(Math.random() * MOMENTS_BG_POOL.length)],
        []);

    // Auto scroll to bottom of chat detail
    // NOTE: Do NOT use scrollIntoView - it propagates to page scroll on mobile, shifting the entire layout up
    useEffect(() => {
        if (activeAppId === 'chat_detail' && chatEndRef.current) {
            const container = chatEndRef.current.parentElement;
            if (container) {
                container.scrollTop = container.scrollHeight;
            }
        }
    }, [selectedChatRecord?.detail, activeAppId]);

    const handleSelectChar = (c: CharacterProfile) => {
        setTargetChar(normalizeTargetCharacter(c));
        setView('phone');
        setActiveAppId('home');
    };

    const handleConnectTarget = (c: CharacterProfile) => {
        accessTimersRef.current.forEach(timer => window.clearTimeout(timer));
        setAccessOverlay({ name: c.name, status: 'connecting' });

        const grantedTimer = window.setTimeout(() => {
            setAccessOverlay({ name: c.name, status: 'granted' });
        }, 560);

        const enterTimer = window.setTimeout(() => {
            setAccessOverlay(null);
            handleSelectChar(c);
        }, 1080);

        accessTimersRef.current = [grantedTimer, enterTimer];
    };

    const performExitPhone = () => {
        setPendingPhoneContextRecordIds([]);
        setContextExitAction(null);
        setView('select');
        setTargetChar(null);
        setActiveAppId('home');
        setDesktopGalleryPhotos([]);
        setDesktopPage(0);
        setIsDesktopEditing(false);
        setShowDesktopSettings(false);
    };

    const performCheckPhoneExit = (action: ContextExitAction) => {
        if (action === 'close_app') {
            performExitPhone();
            closeApp();
            return;
        }

        performExitPhone();
    };

    const requestCheckPhoneExit = (action: ContextExitAction) => {
        if (pendingPhoneContextRecords.length > 0 && targetChar) {
            setContextExitAction(action);
            return;
        }

        performCheckPhoneExit(action);
    };

    const cancelContextExitPrompt = () => {
        if (isResolvingContextExit) return;
        setContextExitAction(null);
    };

    const handleKeepPhoneContext = () => {
        const action = contextExitAction || 'exit_phone';
        const pendingCount = pendingPhoneContextRecords.length;
        setPendingPhoneContextRecordIds([]);
        setContextExitAction(null);
        addToast(
            pendingCount > 0 ? `他会知道这次翻到的 ${pendingCount} 条痕迹` : '他会知道这次翻到的痕迹',
            'success'
        );
        performCheckPhoneExit(action);
    };

    const handleHidePhoneContext = async () => {
        if (!targetChar) return;

        const action = contextExitAction || 'exit_phone';
        const pendingRecords = pendingPhoneContextRecords;
        if (pendingRecords.length === 0) {
            setContextExitAction(null);
            performCheckPhoneExit(action);
            return;
        }

        setIsResolvingContextExit(true);

        try {
            const pendingRecordIds = new Set(pendingRecords.map(record => record.id));
            const messageIds = getFiniteMessageIds(
                pendingRecords
                    .map(record => record.systemMessageId)
                    .filter((id): id is number => typeof id === 'number')
            );

            if (messageIds.length > 0) {
                await DB.deleteMessages(messageIds);
            }

            const nextRecords = (targetChar.phoneState?.records || []).map(record =>
                pendingRecordIds.has(record.id) ? unlinkPhoneRecordFromContext(record) : record
            );
            const nextPhoneState: CharacterProfile['phoneState'] = {
                ...targetChar.phoneState,
                records: nextRecords,
            };

            updateCharacter(targetChar.id, { phoneState: nextPhoneState });
            setTargetChar(prev => prev && prev.id === targetChar.id
                ? { ...prev, phoneState: nextPhoneState }
                : prev
            );
            setSelectedChatRecord(prev => prev && pendingRecordIds.has(prev.id)
                ? unlinkPhoneRecordFromContext(prev)
                : prev
            );
            setPendingPhoneContextRecordIds(prev => prev.filter(id => !pendingRecordIds.has(id)));
            setContextExitAction(null);
            addToast('他不会知道这次翻到的痕迹', 'success');
            performCheckPhoneExit(action);
        } catch (error) {
            console.warn('[CheckPhone] Failed to hide phone records from chat context:', error);
            addToast('处理失败，请再试一次', 'error');
        } finally {
            setIsResolvingContextExit(false);
        }
    };

    const handleExitPhone = () => {
        requestCheckPhoneExit('exit_phone');
    };

    const updateDesktopAppearance = (updater: (appearance: PhoneDesktopAppearance) => PhoneDesktopAppearance) => {
        if (!targetChar) return;
        const nextAppearance = updater(targetChar.phoneState?.desktopAppearance || {});
        const nextPhoneState: CharacterProfile['phoneState'] = {
            ...targetChar.phoneState,
            desktopAppearance: nextAppearance,
        };
        updateCharacter(targetChar.id, { phoneState: nextPhoneState });
        setTargetChar(prev => prev ? { ...prev, phoneState: nextPhoneState } : prev);
    };

    const handleDesktopWallpaperUpload = async (file: File) => {
        try {
            const dataUrl = await readImageFileAsDataUrl(file);
            if (!dataUrl) throw new Error('empty image');
            updateDesktopAppearance(appearance => ({ ...appearance, wallpaper: dataUrl }));
            addToast('查手机桌面已更新', 'success');
        } catch (error) {
            console.error('[CheckPhone] Failed to update desktop wallpaper:', error);
            addToast('壁纸读取失败', 'error');
        }
    };

    const handleResetDesktopWallpaper = () => {
        updateDesktopAppearance(appearance => {
            const rest = { ...appearance };
            delete rest.wallpaper;
            return rest;
        });
        addToast('已恢复默认桌面', 'success');
    };

    const handleDesktopPhotoUpload = async (file: File) => {
        if (desktopPhotoUploadSlot === null) return;

        try {
            const dataUrl = await readImageFileAsDataUrl(file);
            if (!dataUrl) throw new Error('empty image');
            const slotIndex = desktopPhotoUploadSlot;

            updateDesktopAppearance(appearance => {
                const nextPhotos = (appearance.galleryPhotos || []).slice(0, CHECKPHONE_DESKTOP_PHOTO_SLOT_COUNT);
                while (nextPhotos.length < CHECKPHONE_DESKTOP_PHOTO_SLOT_COUNT) nextPhotos.push('');
                nextPhotos[slotIndex] = dataUrl;
                return { ...appearance, galleryPhotos: nextPhotos };
            });
            addToast(`照片 ${slotIndex + 1} 已更新`, 'success');
        } catch (error) {
            console.error('[CheckPhone] Failed to update desktop photo:', error);
            addToast('照片读取失败', 'error');
        } finally {
            setDesktopPhotoUploadSlot(null);
        }
    };

    const handleResetDesktopPhoto = (slotIndex: number) => {
        updateDesktopAppearance(appearance => {
            const nextPhotos = (appearance.galleryPhotos || []).slice(0, CHECKPHONE_DESKTOP_PHOTO_SLOT_COUNT);
            while (nextPhotos.length < CHECKPHONE_DESKTOP_PHOTO_SLOT_COUNT) nextPhotos.push('');
            nextPhotos[slotIndex] = '';

            const rest = { ...appearance };
            delete rest.galleryPhotos;
            return nextPhotos.some(Boolean) ? { ...rest, galleryPhotos: nextPhotos } : rest;
        });
        addToast(`照片 ${slotIndex + 1} 已恢复默认`, 'success');
    };

    const openDesktopPhotoUpload = (slotIndex: number) => {
        setDesktopPhotoUploadSlot(slotIndex);
        window.setTimeout(() => desktopPhotoInputRef.current?.click(), 0);
    };

    const handleDesktopIconUpload = async (file: File) => {
        if (!desktopIconUploadTargetId) return;
        try {
            const dataUrl = await readImageFileAsDataUrl(file);
            if (!dataUrl) throw new Error('empty image');
            const targetId = desktopIconUploadTargetId;
            updateDesktopAppearance(appearance => ({
                ...appearance,
                appIcons: {
                    ...(appearance.appIcons || {}),
                    [targetId]: dataUrl,
                },
            }));
            addToast('查手机图标已更新', 'success');
        } catch (error) {
            console.error('[CheckPhone] Failed to update desktop icon:', error);
            addToast('图标读取失败', 'error');
        } finally {
            setDesktopIconUploadTargetId(null);
        }
    };

    const handleResetDesktopIcon = (appId: string) => {
        updateDesktopAppearance(appearance => {
            const nextIcons = { ...(appearance.appIcons || {}) };
            delete nextIcons[appId];
            const rest = { ...appearance };
            delete rest.appIcons;
            return Object.keys(nextIcons).length ? { ...rest, appIcons: nextIcons } : rest;
        });
        addToast('已恢复默认图标', 'success');
    };

    const openDesktopIconUpload = (appId: string) => {
        setDesktopIconUploadTargetId(appId);
        window.setTimeout(() => desktopIconInputRef.current?.click(), 0);
    };

    const cancelDesktopEditPress = () => {
        if (desktopEditTimerRef.current !== null) {
            window.clearTimeout(desktopEditTimerRef.current);
            desktopEditTimerRef.current = null;
        }
    };

    const startDesktopEditPress = () => {
        cancelDesktopEditPress();
        desktopLongPressTriggeredRef.current = false;
        desktopEditTimerRef.current = window.setTimeout(() => {
            desktopLongPressTriggeredRef.current = true;
            setIsDesktopEditing(true);
            desktopEditTimerRef.current = null;
        }, 520);
    };

    const handleDesktopAppClick = (action: () => void) => {
        cancelDesktopEditPress();
        if (desktopLongPressTriggeredRef.current) {
            desktopLongPressTriggeredRef.current = false;
            return;
        }
        action();
    };

    const handleDesktopPageScroll = (event: React.UIEvent<HTMLDivElement>) => {
        const element = event.currentTarget;
        const nextPage = Math.round(element.scrollLeft / Math.max(1, element.clientWidth));
        setDesktopPage(nextPage);
    };

    const scrollDesktopPage = (pageIndex: number) => {
        const element = desktopPagerRef.current;
        if (!element) return;
        element.scrollTo({ left: pageIndex * element.clientWidth, behavior: 'smooth' });
        setDesktopPage(pageIndex);
    };

    const handleDeleteRecord = async (record: PhoneEvidence) => {
        if (!targetChar) return;

        const newRecords = (targetChar.phoneState?.records || []).filter(r => r.id !== record.id);
        updateCharacter(targetChar.id, {
            phoneState: { ...targetChar.phoneState, records: newRecords }
        });

        if (record.systemMessageId) {
            await DB.deleteMessage(record.systemMessageId);
        }

        if (selectedChatRecord?.id === record.id) {
            setActiveAppId('chat'); // Go back to list
            setSelectedChatRecord(null);
        }

        addToast('记录已删除', 'success');
    };

    const handleOpenNeteaseMusicRecord = (record: PhoneEvidence) => {
        const song = phoneRecordToNeteaseSong(record);

        if (!song) {
            addToast('这条听歌痕迹还没匹配到可播放歌曲', 'info');
            return;
        }

        setNeteaseConfirmRecord(null);
        void playSong(song);
        openApp(AppID.Music, { autoShowPlayer: true });
    };

    const toggleNeteasePlaylist = (key: string) => {
        setOpenNeteasePlaylistKeys(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleNeteaseSongPress = (record: PhoneEvidence) => {
        if (openNeteaseSongId === record.id) {
            if (record.songId && record.songId > 0) {
                setNeteaseConfirmRecord(record);
            }
            return;
        }

        setOpenNeteaseSongId(record.id);
    };

    const handleDeleteApp = (appId: string) => {
        if (!targetChar) return;
        const newApps = (targetChar.phoneState?.customApps || []).filter(a => a.id !== appId);
        const nextIcons = { ...(targetChar.phoneState?.desktopAppearance?.appIcons || {}) };
        delete nextIcons[appId];
        const appearanceRest = { ...(targetChar.phoneState?.desktopAppearance || {}) };
        delete appearanceRest.appIcons;
        const nextAppearance = Object.keys(nextIcons).length
            ? { ...appearanceRest, appIcons: nextIcons }
            : appearanceRest;
        const nextPhoneState: CharacterProfile['phoneState'] = {
            ...targetChar.phoneState,
            customApps: newApps,
            ...(Object.keys(nextAppearance).length ? { desktopAppearance: nextAppearance } : {}),
        };
        updateCharacter(targetChar.id, { phoneState: nextPhoneState });
        setTargetChar(prev => prev ? { ...prev, phoneState: nextPhoneState } : prev);
        addToast('App 已卸载', 'success');
    };

    const handleCreateCustomApp = () => {
        if (!targetChar || !newAppName || !newAppPrompt) return;

        const newApp: PhoneCustomApp = {
            id: `app-${Date.now()}`,
            name: newAppName,
            icon: newAppIcon,
            color: newAppColor,
            prompt: newAppPrompt
        };

        const currentApps = targetChar.phoneState?.customApps || [];
        const nextPhoneState: CharacterProfile['phoneState'] = {
            ...targetChar.phoneState,
            customApps: [...currentApps, newApp],
        };
        updateCharacter(targetChar.id, { phoneState: nextPhoneState });
        setTargetChar(prev => prev ? { ...prev, phoneState: nextPhoneState } : prev);

        setShowCreateModal(false);
        setNewAppName('');
        setNewAppPrompt('');
        addToast(`已安装 ${newAppName}`, 'success');
    };

    // Calculate Time Gap - Duplicated logic from other apps for consistent experience
    const getTimeGapHint = (lastMsgTimestamp: number | undefined): string => {
        if (!lastMsgTimestamp) return '这是初次见面。';
        const now = Date.now();
        const diffMs = now - lastMsgTimestamp;
        const diffMins = Math.floor(diffMs / (1000 * 60));
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 5) return '你们刚刚还在聊天。';
        if (diffMins < 60) return `距离上次互动只有 ${diffMins} 分钟。`;
        if (diffHours < 24) return `距离上次互动已经过了 ${diffHours} 小时。`;
        return `距离上次互动已经过了 ${diffDays} 天。`;
    };

    // --- Core Generation Logic ---

    const handleGenerate = async (type: string, customPrompt?: string, options: GenerateOptions = {}) => {
        if (!targetChar || !apiConfig.apiKey) {
            addToast('配置错误', 'error');
            return;
        }
        setIsLoading(true);

        try {
            const existingRecords = targetChar.phoneState?.records || [];
            const shouldReplaceExisting = options.replaceExisting || type === NETEASE_MUSIC_RECORD_TYPE;
            const replacedRecords = shouldReplaceExisting
                ? existingRecords.filter(record => record.type === type)
                : [];
            const replacedSystemMessageIds = new Set(
                replacedRecords
                    .map(record => record.systemMessageId)
                    .filter((id): id is number => typeof id === 'number')
            );

            // Include full memory details for accuracy
            const context = ContextBuilder.buildCoreContext(targetChar, userProfile, true);
            const msgs = await DB.getRecentMessagesByCharId(targetChar.id, MAX_PHONE_PROMPT_MESSAGES);
            const contextMsgs = msgs.filter(m => !replacedSystemMessageIds.has(m.id));

            const lastMsg = contextMsgs[contextMsgs.length - 1];
            const timeGap = getTimeGapHint(lastMsg?.timestamp);

            const recentMsgs = contextMsgs
                .slice(-50)
                .map(m => {
                    const roleName = m.role === 'user' ? userProfile.name : targetChar.name;
                    const content = m.type === 'text' ? m.content : `[${m.type}]`;
                    return `${roleName}: ${content}`;
                }).join('\n');

            let promptInstruction = "";
            let logPrefix = "";

            if (customPrompt) {
                promptInstruction = `用户正在查看你的手机 App: "${type}"。
该 App 的功能/用户想看的内容是: "${customPrompt}"。
请生成 2-4 条符合该 App 功能的记录。
必须符合你的人设（例如银行余额要符合身份，备忘录要符合性格）。
格式JSON数组: [{ "title": "标题/项目名", "detail": "详细内容/金额/状态", "value": "可选的数值状态(如 +100)" }, ...]`;
                const customApp = customApps.find(a => a.id === type);
                logPrefix = customApp ? customApp.name : type;
            } else {
                if (type === 'chat') {
                    promptInstruction = `生成 3 个该角色手机聊天软件(Message/Line)中的**对话片段**。
    要求：
    1. **自动匹配角色**: 根据人设，虚构 3 个合理的联系人（如：如果是学生，联系人可以是“辅导员”、“社团学长”；如果是杀手，联系人可以是“中间人”）。不要使用“User”作为联系人。
    2. **对话感**: 内容必须是有来有回的对话脚本（3-4句），体现他们之间的关系。
    3. **格式**: 必须严格使用 "我:..." 代表主角(你)，"对方:..." 或 "人名:..." 代表联系人。
    格式JSON数组: [{ "title": "联系人名称 (身份)", "detail": "对方: 最近怎么样？\\n我: 还活着。\\n对方: 那就好。" }, ...]`;
                    logPrefix = "聊天软件";
                } else if (type === NETEASE_MUSIC_RECORD_TYPE) {
                    promptInstruction = NETEASE_MUSIC_PROMPT;
                    logPrefix = "网易云音乐";
                } else if (type === 'call') {
                    promptInstruction = `生成 3 条该角色的近期**通话记录**。
    格式JSON数组: [{ "title": "联系人名称", "value": "呼入 (5分钟) / 未接 / 呼出 (30秒)", "detail": "关于下周聚会的事..." }, ...]`;
                    logPrefix = "通话记录";
                } else if (type === 'order') {
                    promptInstruction = `生成 3 条该角色最近的购物订单（淘宝/天猫）。
    要求：
    1. 商品名必须具体、生动，包含品牌名和型号（例如 "NIKE Air Max 270 黑白配色 男款"）。
    2. detail 必须包含 "规格 | 状态" 两部分，用 "|" 分隔（例如 "黑色/42码 | 已发货"）。
    3. value 是实付款金额，必须带 ¥ 前缀。
    4. shop 是店铺名（例如 "Nike官方旗舰店"）。
    格式JSON数组: [{ "title": "商品名", "detail": "规格 | 状态", "value": "¥金额", "shop": "店铺名" }, ...]`;
                    logPrefix = "购物APP";
                } else if (type === 'delivery') {
                    // ─── LLM-Native 外卖生成（无需地图 API）─────────────────
                    const cityOverride = targetChar.cityOverride?.trim();
                    const cityReferenceReal = targetChar.cityReferenceReal?.trim();

                    // 构建城市与美食文化上下文
                    let cityContext = '';
                    if (targetChar.isFictionalCity && cityOverride) {
                        if (cityReferenceReal) {
                            // 架空城市 + 有现实参照
                            cityContext = `你身处「${cityOverride}」——这是一个以「${cityReferenceReal}」为蓝本的架空城市。
生成外卖订单时请遵循以下规则：
- 商家名称和菜品风格要融合「${cityReferenceReal}」的真实饮食文化特色（比如当地知名菜系、连锁品牌的本地化变体）
- 但商家名必须做世界观改编：可以谐音、化用、加上符合设定的前缀后缀（如"阿卡姆速递"、"璃月港茶餐厅"），让它听起来像真实存在于「${cityOverride}」的店
- 菜品种类和价位仍然以「${cityReferenceReal}」的真实消费水平为参照
- 鼓励混入 1-2 个纯原创的、只可能存在于你的世界观里的特色美食`;
                        } else {
                            // 架空城市 + 无现实参照 → 完全自由创作
                            cityContext = `你身处「${cityOverride}」——这是一个架空/虚构城市。
生成外卖订单时请完全根据你的世界观和人设自由创作：
- 商家名称应该听起来像真实存在于这个世界里的店（符合世界观的语言风格和文化氛围）
- 菜品要符合这个世界的设定（如果是魔法世界可以有"龙息辣翅"，赛博朋克可以有"合成蛋白套餐"）
- 价格体系要自洽（可以用你世界里的货币单位，但也可以用 ¥ 方便展示）
- 整体风格要让人一看就知道"这是那个世界的外卖"`;
                        }
                    } else if (cityOverride) {
                        // 真实城市
                        cityContext = `你身处「${cityOverride}」。
生成外卖订单时请体现这座城市的真实饮食文化特色：
- 优先使用当地真实存在的知名餐饮品牌和连锁店（包括全国连锁在该城市的分店，以及当地独有的老字号/网红店）
- 菜品要符合「${cityOverride}」的地方饮食特色（比如成都多川菜/串串/火锅、广州多粤式茶餐厅/肠粉、长沙多湘菜/臭豆腐/奶茶）
- 商家名格式带上分店名（如 "蜜雪冰城(春熙路店)"、"文和友(海信广场店)"）
- 价格要符合当地真实消费水平`;
                    } else {
                        // 未设城市 → 通用
                        cityContext = `你没有设置具体城市，请根据你的人设和生活环境合理推断你可能在哪类城市，并据此生成合理的外卖订单。
可以使用全国常见的连锁品牌（如华莱士、蜜雪冰城、张亮麻辣烫、瑞幸咖啡、肯德基等），也可以虚构符合你身份的本地小店。`;
                    }

                    promptInstruction = `生成 3 条你最近的外卖订单记录。

【你的地理与饮食文化背景】
${cityContext}

【通用要求】
1. title 是商家名称，要有店名特色和辨识度。
2. 菜品必须符合该商家的菜系特征（如奶茶店只出饮品甜品，烧烤店出烤串烤肉）。
3. 根据你的人设和经济状况，选择符合你身份的商家下单。富人挑精致的，学生挑实惠的。
4. detail 是点的菜品列表，用「;」分隔，包含数量（例如 "招牌奶茶×1;芋泥波波×2"）。
5. value 是订单总价，必须带 ¥ 前缀，价格要合理。
6. shop 是订单状态（例如 "已完成"、"骑手正在配送"、"已取消"、"待评价"）。
格式JSON数组: [{ "title": "商家名", "detail": "菜品1×数量;菜品2×数量;...", "value": "¥总价", "shop": "订单状态" }, ...]`;
                    logPrefix = "外卖APP";

                    // === [LEGACY] 以下为原版高德 POI API 搜索逻辑，因额度耗尽停用 ===
                    // const realShops = queryCity ? await searchNearbyRestaurants(queryCity, 15) : [];
                    // const selectedShops = realShops.length > 0 ? shuffleAndPick(realShops, Math.min(5, Math.max(3, realShops.length))) : [];
                    // if (selectedShops.length > 0) { ... 用真实 POI 构建 prompt ... }
                    // === [/LEGACY] ===
                } else if (type === 'social') {
                    promptInstruction = `生成 2 条该角色的朋友圈/社交媒体动态。
    格式JSON数组: [{ "title": "时间/状态", "detail": "正文内容" }, ...]`;
                    logPrefix = "朋友圈";
                }
            }

            const fullPrompt = type === NETEASE_MUSIC_RECORD_TYPE
                ? `${context}\n\n### [Current Status]\n时间距离上次互动: ${timeGap}\n\n### [Recent Chat Context]\n${recentMsgs}\n\n### [Task]\n${promptInstruction}`
                : `${context}\n\n### [Current Status]\n时间距离上次互动: ${timeGap}\n\n### [Recent Chat Context]\n${recentMsgs}\n\n### [Task]\n${promptInstruction}\n请根据[Current Status]和人设调整生成内容的时间戳和情绪。如果很久没聊天，记录可能是近期的独处状态；如果刚聊过，记录可能与聊天内容相关。`;

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: "user", content: fullPrompt }],
                    temperature: 0.8
                })
            });

            if (!response.ok) throw new Error('API Error');
            const data = await safeResponseJson(response);
            const content = extractContent(data);
            if (!content) throw new Error('API 未返回可用内容');

            const parsed = type === NETEASE_MUSIC_RECORD_TYPE ? parseNeteaseMusicProfileJson(content) : extractJson(content);

            const newRecordsToAdd: PhoneEvidence[] = [];

            if (type === NETEASE_MUSIC_RECORD_TYPE) {
                const payload = normalizeGeneratedNeteaseMusicProfilePayload(parsed);

                if (!payload) {
                    addToast('没有解析到可用网易云主页', 'info');
                    return;
                }

                const flattenedSongs = payload.playlists.flatMap((playlist, playlistIndex) =>
                    playlist.songs.map((trace, songIndex) => ({
                        trace,
                        playlist,
                        playlistIndex,
                        songIndex,
                    }))
                );

                const resolvedTraces = await Promise.all(flattenedSongs.map(async item => {
                    const resolved = await resolveNeteaseMusicTrace(item.trace);
                    return { ...item, matchedSong: resolved.matchedSong, songUrl: resolved.songUrl };
                }));

                for (const result of resolvedTraces) {
                    const { trace, playlist, playlistIndex, songIndex, matchedSong, songUrl } = result;
                    const artistLine = matchedSong ? getNeteaseArtistLine(matchedSong) : trace.artist;
                    const recordTitle = trace.song;
                    const recordDetail = trace.comment
                        ? `${artistLine}\n${trace.comment}`
                        : artistLine;
                    const albumCover = matchedSong?.album.picUrl;

                    const systemDraft = buildPhoneSystemMessageDraft({
                        type,
                        charName: targetChar.name,
                        charAvatar: targetChar.avatar,
                        logPrefix,
                        title: recordTitle,
                        detail: `${artistLine}${trace.tag ? ` | ${trace.tag}` : ''}${trace.comment ? ` | ${trace.comment}` : ''}`,
                        value: trace.tag,
                        artist: artistLine,
                        comment: trace.comment,
                        songId: matchedSong?.id,
                        songUrl,
                        albumCover,
                        profileNickname: payload.profile.nickname,
                        profileLevel: payload.profile.level,
                        profileSignature: payload.profile.signature,
                        profilePlayCount: payload.profile.playCount,
                        playlistName: playlist.name,
                        playlistCount: playlist.count,
                        playlistIndex,
                        songIndex,
                    });

                    const systemMessageId = await DB.saveMessage({
                        charId: targetChar.id,
                        role: 'system',
                        type: 'text',
                        content: systemDraft.content,
                        metadata: systemDraft.metadata
                    });

                    newRecordsToAdd.push({
                        id: `rec-${Date.now()}-${Math.random()}`,
                        type,
                        title: recordTitle,
                        detail: recordDetail,
                        value: trace.tag,
                        artist: artistLine,
                        comment: trace.comment,
                        songId: matchedSong?.id,
                        songUrl,
                        albumCover,
                        profileNickname: payload.profile.nickname,
                        profileLevel: payload.profile.level,
                        profileSignature: payload.profile.signature,
                        profilePlayCount: payload.profile.playCount,
                        playlistName: playlist.name,
                        playlistCount: playlist.count,
                        playlistIndex,
                        songIndex,
                        timestamp: Date.now(),
                        systemMessageId
                    });

                    await new Promise(r => setTimeout(r, 50));
                }
            } else {
                const json = Array.isArray(parsed) ? parsed : [];
                if (json.length === 0) {
                    throw new Error('未解析出有效手机记录');
                }

                for (const item of json) {
                    const normalizedItem = normalizeGeneratedPhoneItem(item);
                    const recordTitle = normalizedItem.title;
                    const recordDetail = normalizedItem.detail;

                    const systemDraft = buildPhoneSystemMessageDraft({
                        type,
                        charName: targetChar.name,
                        charAvatar: targetChar.avatar,
                        logPrefix,
                        title: recordTitle,
                        detail: recordDetail,
                        value: normalizedItem.value,
                        shop: normalizedItem.shop
                    });

                    const systemMessageId = await DB.saveMessage({
                        charId: targetChar.id,
                        role: 'system',
                        type: 'text',
                        content: systemDraft.content,
                        metadata: systemDraft.metadata
                    });

                    newRecordsToAdd.push({
                        id: `rec-${Date.now()}-${Math.random()}`,
                        type: type,
                        title: recordTitle,
                        detail: recordDetail,
                        value: normalizedItem.value,
                        shop: normalizedItem.shop,
                        timestamp: Date.now(),
                        systemMessageId
                    });

                    await new Promise(r => setTimeout(r, 50));
                }
            }

            const baseRecords = shouldReplaceExisting
                ? existingRecords.filter(record => record.type !== type)
                : existingRecords;
            const nextRecords = prunePhoneRecords([...baseRecords, ...newRecordsToAdd]);
            const prunedCount = baseRecords.length + newRecordsToAdd.length - nextRecords.length;
            const nextRecordIds = new Set(nextRecords.map(record => record.id));
            const newContextRecordIds = new Set(
                newRecordsToAdd
                    .filter(record => typeof record.systemMessageId === 'number')
                    .map(record => record.id)
            );
            const nextPendingContextRecordIds = nextRecords
                .filter(record => newContextRecordIds.has(record.id) && typeof record.systemMessageId === 'number')
                .map(record => record.id);

            updateCharacter(targetChar.id, {
                phoneState: { ...targetChar.phoneState, records: nextRecords }
            });
            setPendingPhoneContextRecordIds(prev => {
                const keptPendingIds = prev.filter(id => nextRecordIds.has(id));
                return Array.from(new Set([...keptPendingIds, ...nextPendingContextRecordIds]));
            });

            if (replacedSystemMessageIds.size > 0) {
                await DB.deleteMessages(Array.from(replacedSystemMessageIds));
            }

            addToast(
                shouldReplaceExisting
                    ? `已重Roll ${newRecordsToAdd.length} 条数据`
                    : prunedCount > 0
                    ? `已刷新 ${newRecordsToAdd.length} 条数据，整理了 ${prunedCount} 条旧记录`
                    : `已刷新 ${newRecordsToAdd.length} 条数据`,
                'success'
            );

        } catch (e: any) {
            console.error(e);
            addToast('解析失败，请重试', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    // --- Continue Chat Logic ---

    const handleContinueChat = async () => {
        if (!selectedChatRecord || !targetChar || !apiConfig.apiKey) return;
        setIsLoading(true);

        try {
            const context = ContextBuilder.buildCoreContext(targetChar, userProfile, true); // Enable detailed context
            const prompt = `${context}

### [Task: Continue Conversation]
Roleplay: You are "${targetChar.name}". You are chatting on your phone with "${selectedChatRecord.title}".
Current History:
"""
${selectedChatRecord.detail}
"""

Task: Please continue this conversation for 3-5 more turns. 
Style: Casual, IM style.
Format: 
- Use "我: ..." for yourself (${targetChar.name}).
- Use "对方: ..." for the contact (${selectedChatRecord.title}).
- Only output the new dialogue lines. Do NOT repeat history.
`;

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [{ role: "user", content: prompt }],
                    temperature: 0.85
                })
            });

            if (response.ok) {
                const data = await safeResponseJson(response);
                const content = extractContent(data);
                let newLines = normalizePhoneText(content, '', MAX_PHONE_CHAT_DETAIL_CHARS);
                if (!newLines) throw new Error('API 未返回可用续写内容');

                // Clean up any markdown
                newLines = newLines.replace(/```/g, '');

                // Append to existing record
                const updatedDetail = limitPhoneText(`${selectedChatRecord.detail}\n${newLines}`, MAX_PHONE_CHAT_DETAIL_CHARS);

                // Update Local State
                const updatedRecord = normalizeStoredPhoneRecord({ ...selectedChatRecord, detail: updatedDetail, timestamp: Date.now() });
                setSelectedChatRecord(updatedRecord);

                // Update Character Profile
                const allRecords = targetChar.phoneState?.records || [];
                const updatedRecords = prunePhoneRecords(allRecords.map(r => r.id === updatedRecord.id ? updatedRecord : r));
                updateCharacter(targetChar.id, {
                    phoneState: { ...targetChar.phoneState, records: updatedRecords }
                });

                // Inject a system message so the chat timeline (and AI context) reflects the continuation
                const continuationSummary = newLines.replace(/\n/g, ' ').substring(0, 80);
                await DB.saveMessage({
                    charId: targetChar.id,
                    role: 'system',
                    type: 'text',
                    content: `[系统: ${userProfile.name} 偷看了 ${targetChar.name} 与 "${selectedChatRecord.title}" 的后续对话: ${continuationSummary}...]`,
                    metadata: {
                        source: 'phone',
                        phoneType: 'chat',
                        phoneLabel: '聊天软件',
                        phoneTitle: selectedChatRecord.title,
                        phoneDetail: newLines,
                        charName: targetChar.name
                    }
                });

                // Also update the original system message's metadata if it exists
                if (selectedChatRecord.systemMessageId) {
                    try {
                        await DB.updateMessageMetadata(selectedChatRecord.systemMessageId, {
                            phoneDetail: updatedDetail
                        });
                    } catch (e) { /* Original message may have been deleted, safe to ignore */ }
                }
            }

        } catch (e) {
            console.error(e);
            addToast('续写失败', 'error');
        } finally {
            setIsLoading(false);
        }
    };

    // --- Renderers ---

    const checkPhoneRealSafeTop = 'var(--checkphone-real-safe-top, var(--hardware-safe-top, env(safe-area-inset-top, 0px)))';
    const checkPhoneRootStyle = {
        '--checkphone-real-safe-top': 'var(--hardware-safe-top, env(safe-area-inset-top, 0px))',
    } as React.CSSProperties;
    const checkPhoneSafeHeaderStyle: React.CSSProperties = {
        height: `calc(3.5rem + ${checkPhoneRealSafeTop})`,
        paddingTop: checkPhoneRealSafeTop,
    };

    const getCheckPhoneSafeHeaderStyle = (style?: React.CSSProperties): React.CSSProperties => ({
        ...style,
        ...checkPhoneSafeHeaderStyle,
    });

    const renderHeader = (title: string, backAction: () => void, extraAction?: React.ReactNode) => (
        <div
            className="h-14 flex items-center justify-between px-4 bg-white/80 backdrop-blur-md text-slate-800 shrink-0 z-20 border-b border-slate-200"
            style={checkPhoneSafeHeaderStyle}
        >
            <button onClick={backAction} className="p-2 -ml-2 rounded-full hover:bg-slate-100 transition-colors">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                </svg>
            </button>
            <span className="font-bold text-base tracking-wide truncate max-w-[200px]">{title}</span>
            <div className="w-8 flex justify-end">{extraAction}</div>
        </div>
    );

    const renderChatList = () => {
        const list = getRecentRecordsByType('chat');
        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-slate-50 z-10">
                {renderHeader('Message', () => setActiveAppId('home'))}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 no-scrollbar pb-24 overscroll-contain">
                    {list.length === 0 && <div className="text-center text-slate-400 mt-20 text-xs">暂无聊天记录</div>}
                    {list.map(r => (
                        <div
                            key={r.id}
                            onClick={() => { setSelectedChatRecord(r); setActiveAppId('chat_detail'); }}
                            className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 relative group animate-slide-up active:scale-98 transition-transform cursor-pointer"
                        >
                            <div className="flex items-center gap-3">
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center text-xl shadow-inner shrink-0">
                                    👤
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-baseline mb-1">
                                        <div className="font-bold text-slate-700 text-sm truncate">{r.title}</div>
                                        <div className="text-[10px] text-slate-400">{new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                    </div>
                                    <div className="text-xs text-slate-500 truncate">
                                        {r.detail.split('\n').pop() || '...'}
                                    </div>
                                </div>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); handleDeleteRecord(r); }} className={`absolute top-2 right-2 w-6 h-6 bg-red-100 text-red-500 rounded-full flex items-center justify-center text-xs ${MOBILE_VISIBLE_DELETE_CLASS} transition-opacity z-10`}>×</button>
                        </div>
                    ))}
                </div>
                <div className="absolute bottom-8 w-full flex justify-center pointer-events-none z-30">
                    <button disabled={isLoading} onClick={() => handleGenerate('chat')} className="pointer-events-auto bg-green-500 text-white px-6 py-2.5 rounded-full shadow-xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform">
                        {isLoading ? '连接中...' : '刷新消息列表'}
                    </button>
                </div>
            </div>
        );
    };

    const renderChatDetail = () => {
        if (!selectedChatRecord || !targetChar) return null;

        // Parse logic: look for "Me:" or "我:" vs others
        const lines = selectedChatRecord.detail.split('\n').filter(l => l.trim()).slice(-MAX_CHAT_DETAIL_LINES_RENDERED);
        const parsedLines = lines.map(line => {
            const isMe = line.startsWith('我') || line.startsWith('Me') || line.startsWith('Me:') || line.startsWith('我:');
            const content = line.replace(/^(我|Me|对方|Them|[\w\u4e00-\u9fa5]+)[:：]\s*/, '');
            return { isMe, content };
        });

        return (
            // 关键修复：添加不透明背景色，确保完全覆盖
            <div className="absolute inset-0 w-full h-full flex flex-col bg-[#f2f2f2] z-[100] overflow-hidden">
                {renderHeader(selectedChatRecord.title, () => setActiveAppId('chat'))}

                {/* 聊天内容区域 */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar overscroll-contain min-h-0">
                    {parsedLines.map((msg, idx) => (
                        <div key={idx} className={`flex ${msg.isMe ? 'justify-end' : 'justify-start'}`}>
                            {!msg.isMe && (
                                <div className="w-9 h-9 rounded-md bg-gray-300 flex items-center justify-center text-xs text-gray-500 mr-2 shrink-0">
                                    {selectedChatRecord.title[0]}
                                </div>
                            )}
                            <div className={`px-3 py-2 rounded-lg max-w-[75%] text-sm leading-relaxed shadow-sm break-words relative ${msg.isMe ? 'bg-[#95ec69] text-black' : 'bg-white text-black'}`}>
                                {msg.isMe && <div className="absolute top-2 -right-1.5 w-3 h-3 bg-[#95ec69] rotate-45"></div>}
                                {!msg.isMe && <div className="absolute top-3 -left-1 w-2.5 h-2.5 bg-white rotate-45"></div>}
                                <span className="relative z-10">{msg.content}</span>
                            </div>
                            {msg.isMe && (
                                <img src={targetChar.avatar} className="w-9 h-9 rounded-md object-cover ml-2 shrink-0 shadow-sm" />
                            )}
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex justify-center py-4">
                            <div className="flex gap-1">
                                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"></div>
                                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-100"></div>
                                <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce delay-200"></div>
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>

                {/* 底部按钮 - 关键修复：移除复杂的 env() 计算，使用固定 padding */}
                <div className="shrink-0 w-full p-4 bg-[#f7f7f7] border-t border-gray-200">
                    <button
                        onClick={handleContinueChat}
                        disabled={isLoading}
                        className="w-full py-3 bg-white border border-gray-300 rounded-xl text-sm font-bold text-slate-600 shadow-sm active:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                    >
                        {isLoading ? '对方正在输入...' : '👀 偷看后续 / 拱火'}
                    </button>
                </div>
            </div>
        );
    };


    // ─── Taobao App List (仿淘宝订单列表) ─────────────────────────
    const renderTaobaoList = () => {
        const list = getRecentRecordsByType('order');

        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-[#f5f5f5] z-10">
                {/* ── Header: Taobao style ── */}
                <div className="h-14 flex items-center justify-between px-4 shrink-0 z-20"
                    style={getCheckPhoneSafeHeaderStyle({ background: 'linear-gradient(135deg, #FF5000, #FF2800)' })}>
                    <button onClick={() => setActiveAppId('home')} className="p-2 -ml-2 rounded-full hover:bg-white/10 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="white" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <span className="font-bold text-white text-base tracking-wide">我的订单</span>
                    <div className="w-8"></div>
                </div>

                {/* ── Order list ── */}
                <div className="flex-1 overflow-y-auto no-scrollbar pb-24 overscroll-contain">
                    {list.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
                            <span className="text-4xl opacity-20">📦</span>
                            <span className="text-xs">暂无订单</span>
                        </div>
                    )}
                    <div className="p-3 space-y-2.5">
                        {list.map(r => {
                            // Parse "规格 | 状态"
                            const detailParts = (r.detail || '').split(/[|｜]/).map(s => s.trim()).filter(Boolean);
                            const spec = detailParts.length > 1 ? detailParts[0] : '';
                            const status = detailParts.length > 1 ? detailParts.slice(1).join(' · ') : r.detail;

                            const statusColor = status.includes('已完成') || status.includes('已签收') || status.includes('交易成功')
                                ? 'text-green-600'
                                : status.includes('已发货') || status.includes('运输中')
                                    ? 'text-orange-500'
                                    : status.includes('待付款')
                                        ? 'text-red-500'
                                        : 'text-slate-500';

                            return (
                                <div key={r.id} className="bg-white rounded-lg overflow-hidden relative group animate-slide-up" style={{ border: '1px solid #f0f0f0' }}>
                                    {/* Shop header */}
                                    <div className="px-3 py-2 flex items-center justify-between" style={{ borderBottom: '1px solid #f5f5f5' }}>
                                        <div className="flex items-center gap-1.5">
                                            <div className="w-4 h-4 rounded flex items-center justify-center text-[8px] font-black text-white shrink-0"
                                                style={{ background: 'linear-gradient(135deg, #FF5000, #FF2800)' }}>
                                                淘
                                            </div>
                                            <span className="text-[11px] text-slate-600 font-medium truncate max-w-[150px]">
                                                {r.shop || '淘宝商家'}
                                            </span>
                                        </div>
                                        <span className={`text-[10px] font-medium ${statusColor}`}>{status}</span>
                                    </div>

                                    {/* Product row */}
                                    <div className="px-3 py-2.5 flex gap-3">
                                        {/* Image placeholder */}
                                        <div className="w-20 h-20 rounded-md shrink-0 flex items-center justify-center"
                                            style={{ background: '#f7f7f7' }}>
                                            <span className="text-2xl text-slate-300 select-none">
                                                {(r.title || '?')[0]}
                                            </span>
                                        </div>
                                        {/* Info */}
                                        <div className="flex-1 min-w-0 flex flex-col justify-between">
                                            <div className="text-[13px] text-slate-800 font-medium leading-snug line-clamp-2">
                                                {r.title}
                                            </div>
                                            {spec && (
                                                <div className="text-[11px] text-slate-400 mt-0.5 truncate">{spec}</div>
                                            )}
                                            <div className="flex items-center justify-end mt-1">
                                                {r.value && (
                                                    <span className="text-[14px] font-bold" style={{ color: '#FF5000' }}>
                                                        {(r.value.startsWith('¥') || r.value.startsWith('￥')) ? r.value : `¥${r.value}`}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Delete */}
                                    <button onClick={() => handleDeleteRecord(r)} className={`absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs ${MOBILE_VISIBLE_DELETE_CLASS} transition-opacity shadow-md z-10`}>×</button>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* ── Refresh button ── */}
                <div className="absolute bottom-8 w-full flex justify-center pointer-events-none z-30">
                    <button
                        disabled={isLoading}
                        onClick={() => handleGenerate('order')}
                        className="pointer-events-auto text-white px-6 py-2.5 rounded-full shadow-xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform"
                        style={{ background: 'linear-gradient(135deg, #FF5000, #FF2800)' }}
                    >
                        {isLoading ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>}
                        刷新订单
                    </button>
                </div>
            </div>
        );
    };

    // ─── Meituan Waimai App List (仿美团外卖订单列表) ─────────────────────
    const renderMeituanList = () => {
        const list = getRecentRecordsByType('delivery');

        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-[#f5f5f5] z-10">
                {/* ── Header: Meituan style ── */}
                <div className="h-14 flex items-center justify-between px-4 shrink-0 z-20"
                    style={getCheckPhoneSafeHeaderStyle({ background: 'linear-gradient(135deg, #FFD000, #FFC300)' })}>
                    <button onClick={() => setActiveAppId('home')} className="p-2 -ml-2 rounded-full hover:bg-black/10 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#111" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <span className="font-bold text-[#111] text-base tracking-wide">美团外卖</span>
                    <div className="w-8"></div>
                </div>

                {/* ── Order list ── */}
                <div className="flex-1 overflow-y-auto no-scrollbar pb-24 overscroll-contain">
                    {list.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
                            <span className="text-4xl opacity-20">🍔</span>
                            <span className="text-xs">暂无外卖订单</span>
                        </div>
                    )}
                    <div className="p-3 space-y-2.5">
                        {list.map(r => (
                            <div key={r.id} className="relative group animate-slide-up">
                                <MeituanTakeoutCard
                                    title={r.title}
                                    detail={r.detail}
                                    value={r.value}
                                    shop={r.shop}
                                />
                                <button onClick={() => handleDeleteRecord(r)} className={`absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs ${MOBILE_VISIBLE_DELETE_CLASS} transition-opacity shadow-md z-10`}>×</button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* ── Refresh button ── */}
                <div className="absolute bottom-8 w-full flex justify-center pointer-events-none z-30">
                    <button
                        disabled={isLoading}
                        onClick={() => handleGenerate('delivery')}
                        className="pointer-events-auto text-[#111] px-6 py-2.5 rounded-full shadow-xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform"
                        style={{ background: 'linear-gradient(135deg, #FFD000, #FFC300)' }}
                    >
                        {isLoading ? <div className="w-3 h-3 border-2 border-[#111]/30 border-t-[#111] rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>}
                        刷新订单
                    </button>
                </div>
            </div>
        );
    };

    const renderNeteaseMusicList = () => {
        const list = getRecentRecordsByType(NETEASE_MUSIC_RECORD_TYPE);
        const { profile, playlists } = buildNeteaseMusicProfileViewModel(list, targetChar?.name || '听歌的人');
        const profileNo = formatNeteaseProfileIndex(Math.max(0, (profile.level || 1) - 1));
        const confirmArtist = neteaseConfirmRecord?.artist || neteaseConfirmRecord?.detail.split('\n')[0] || '';

        return (
            <div className="netease-profile-page absolute inset-0 z-10">
                <div className="netease-profile-scroll no-scrollbar">
                    <div className="netease-profile-micro">
                        <button type="button" className="netease-profile-back" onClick={() => setActiveAppId('home')} aria-label="返回查手机桌面">
                            ‹
                        </button>
                        <span className="netease-profile-mirror"><span></span>Mirroring</span>
                    </div>

                    <div className="netease-profile-kicker">听歌档案 · No.{profileNo}</div>
                    <div className="netease-profile-portrait">
                        <div className={`netease-profile-portrait-img ${targetChar?.avatar ? 'has-avatar' : ''}`}>
                            {targetChar?.avatar ? (
                                <img src={targetChar.avatar} alt="" className="netease-profile-portrait-avatar" />
                            ) : null}
                        </div>
                        <span>Profile</span>
                    </div>

                    <div className="netease-profile-name">
                        <div className="netease-profile-cn">{profile.nickname}</div>
                        <div className="netease-profile-meta">
                            Lv.<b>{profile.level}</b> · 黑胶VIP · 累计听歌 {formatNeteaseProfileNumber(profile.playCount)}
                        </div>
                    </div>

                    <div className="netease-profile-epigraph">
                        <span>——</span>{profile.signature}
                    </div>

                    <div className="netease-profile-sec">
                        <span className="zh">歌单</span>
                        <span className="en">Playlists</span>
                        <span className="rule"></span>
                    </div>

                    {list.length === 0 ? (
                        <div className="netease-profile-empty">
                            <MusicNote weight="fill" />
                            <p>暂无听歌档案</p>
                            <span>重新翻找后会生成个人主页、歌单和歌曲批注</span>
                        </div>
                    ) : (
                        <div className="netease-profile-plists">
                            {playlists.map(playlist => {
                                const isOpen = openNeteasePlaylistKeys[playlist.key] ?? playlist.index === 0;
                                return (
                                    <section className={`netease-profile-plist ${isOpen ? 'open' : ''}`} key={playlist.key}>
                                        <button
                                            type="button"
                                            className="netease-profile-plist-head"
                                            onClick={() => toggleNeteasePlaylist(playlist.key)}
                                        >
                                            <span className="netease-profile-idx">{formatNeteaseProfileIndex(playlist.index)}</span>
                                            <span className="netease-profile-pcover">
                                                <span className="netease-profile-art" style={{ background: getNeteaseProfileArtGradient(playlist.index) }}></span>
                                            </span>
                                            <span className="netease-profile-pinfo">
                                                <span className="netease-profile-pname">{playlist.name}</span>
                                                <span className="netease-profile-pmeta">{playlist.count} tracks · private</span>
                                            </span>
                                            <span className="netease-profile-chev">+</span>
                                        </button>

                                        <div className="netease-profile-songs">
                                            {playlist.records.map((record, recordIndex) => {
                                                const clickable = Boolean(record.songId && record.songId > 0);
                                                const isSongOpen = openNeteaseSongId === record.id;
                                                const artist = record.artist || record.detail.split('\n')[0] || '未知歌手';
                                                const comment = record.comment || record.detail.split('\n').slice(1).join('\n').trim();
                                                const artIndex = playlist.index + recordIndex + 1;

                                                return (
                                                    <button
                                                        type="button"
                                                        key={record.id}
                                                        className={`netease-profile-song ${isSongOpen ? 'open' : ''} ${clickable ? '' : 'dead'}`}
                                                        onClick={() => handleNeteaseSongPress(record)}
                                                    >
                                                        <span className="netease-profile-song-row">
                                                            <span className="netease-profile-thumb">
                                                                {record.albumCover ? (
                                                                    <img src={record.albumCover} alt="" />
                                                                ) : (
                                                                    <span className="netease-profile-art" style={{ background: getNeteaseProfileArtGradient(artIndex) }}></span>
                                                                )}
                                                            </span>
                                                            <span className="netease-profile-smeta">
                                                                <span className="netease-profile-sname">{record.title}</span>
                                                                <span className="netease-profile-sartist">{artist}</span>
                                                            </span>
                                                            <span className="netease-profile-mark">
                                                                {record.value ? limitPhoneText(record.value, 18) : clickable ? 'Play' : 'Lost'}
                                                            </span>
                                                        </span>
                                                        <span className="netease-profile-note">
                                                            {record.value ? (
                                                                <span className="netease-profile-tagline">{record.value}</span>
                                                            ) : null}
                                                            {comment ? (
                                                                <span className="netease-profile-quote"><span>“</span>{comment}</span>
                                                            ) : (
                                                                <span className="netease-profile-nocomment">这首没留下话，只是反复听。</span>
                                                            )}
                                                            <span className="netease-profile-jump">
                                                                {clickable ? '再点一下 · 去 Emo Cloud 听' : '无法跳转 · 未匹配'}
                                                                <span></span>
                                                                {clickable ? '→' : ''}
                                                            </span>
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </section>
                                );
                            })}
                        </div>
                    )}

                    <button
                        type="button"
                        disabled={isLoading}
                        onClick={() => handleGenerate(NETEASE_MUSIC_RECORD_TYPE, undefined, { replaceExisting: true })}
                        className="netease-profile-refresh"
                    >
                        {isLoading ? '翻找中 · Loading' : '重新翻找 · Refresh'}
                    </button>
                </div>

                <div className="netease-profile-home"></div>

                {neteaseConfirmRecord ? (
                    <div className="netease-profile-mask show">
                        <div className="netease-profile-dialog">
                            <div className="netease-profile-dialog-lbl">Open in Emo Cloud</div>
                            <h3>去 Emo Cloud 听</h3>
                            <div className="netease-profile-dialog-song">《{neteaseConfirmRecord.title}》{confirmArtist ? ` · ${confirmArtist}` : ''}</div>
                            <div className="netease-profile-dialog-btns">
                                <button type="button" className="cancel" onClick={() => setNeteaseConfirmRecord(null)}>取消</button>
                                <button type="button" className="go" onClick={() => handleOpenNeteaseMusicRecord(neteaseConfirmRecord)}>去听</button>
                            </div>
                        </div>
                    </div>
                ) : null}
            </div>
        );
    };

    const renderGenericList = (appId: string, appName: string, customPrompt?: string) => {
        const list = getRecentRecordsByType(appId);

        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-slate-50 z-10">
                {renderHeader(appName, () => setActiveAppId('home'))}

                <div className="flex-1 overflow-y-auto p-4 space-y-3 no-scrollbar pb-24 overscroll-contain">
                    {list.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-64 text-slate-400 gap-2">
                            <span className="text-4xl opacity-20">📭</span>
                            <span className="text-xs">暂无数据</span>
                        </div>
                    )}
                    {list.map(r => (
                        <div key={r.id} className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm relative group animate-slide-up">
                            <div className="flex justify-between items-start mb-1">
                                <span className="font-bold text-slate-700 text-sm line-clamp-1">{r.title}</span>
                                {r.value && <span className="text-xs font-bold text-green-600 bg-green-50 px-2 py-0.5 rounded">{r.value}</span>}
                            </div>
                            <div className="text-xs text-slate-500 leading-relaxed">{r.detail}</div>
                            <div className="text-[10px] text-slate-300 mt-2 text-right">{new Date(r.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>

                            <button onClick={() => handleDeleteRecord(r)} className={`absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center text-xs ${MOBILE_VISIBLE_DELETE_CLASS} transition-opacity shadow-md`}>×</button>
                        </div>
                    ))}
                </div>

                <div className="absolute bottom-8 w-full flex justify-center pointer-events-none z-30">
                    <button
                        disabled={isLoading}
                        onClick={() => handleGenerate(appId, customPrompt)}
                        className="pointer-events-auto bg-slate-800 text-white px-6 py-2.5 rounded-full shadow-xl font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform hover:bg-slate-700"
                    >
                        {isLoading ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>}
                        刷新数据
                    </button>
                </div>
            </div>
        );
    };

    const renderMomentsList = () => {
        const list = getRecentRecordsByType('social');

        return (
            <div className="absolute inset-0 w-full h-full flex flex-col bg-white z-10">
                {/* WeChat Header */}
                <div
                    className="h-14 flex items-center justify-between px-4 bg-white/90 backdrop-blur-md text-[#111111] shrink-0 z-20 border-b border-gray-100"
                    style={checkPhoneSafeHeaderStyle}
                >
                    <button onClick={() => setActiveAppId('home')} className="p-2 -ml-2 rounded-full active:bg-gray-100 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                        </svg>
                    </button>
                    <span className="font-medium text-base tracking-wide">朋友圈</span>
                    <button className="p-2 -mr-2 rounded-full active:bg-gray-100 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
                        </svg>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto no-scrollbar pb-24 overscroll-contain bg-white">
                    {/* Moments Cover Image Area */}
                    <div className="h-64 bg-gray-100 relative mb-12">
                        <img src={targetChar?.dateBackground || momentsCoverBg} className="w-full h-full object-cover" />
                        <div className="absolute -bottom-8 right-4 flex items-end gap-4">
                            <span className="text-white text-lg font-bold drop-shadow-md mb-2">{targetChar?.name}</span>
                            <div className="w-16 h-16 rounded-lg bg-gray-200 p-[2px] bg-white shadow-sm shrink-0">
                                {targetChar?.avatar ? (
                                    <img src={targetChar.avatar} className="w-full h-full object-cover rounded-md" />
                                ) : (
                                    <div className="w-full h-full bg-slate-300 rounded-md"></div>
                                )}
                            </div>
                        </div>
                    </div>

                    {list.length === 0 && (
                        <div className="flex flex-col items-center justify-center h-40 text-slate-400 gap-2">
                            <span className="text-sm">暂无动态</span>
                        </div>
                    )}

                    {/* Moments List */}
                    <div className="divide-y divide-gray-100">
                        {list.map(r => (
                            <div key={r.id} className="p-4 flex gap-3 relative group animate-slide-up bg-white">
                                {/* Avatar */}
                                <div className="w-10 h-10 rounded-md shrink-0 bg-gray-200">
                                    {targetChar?.avatar ? (
                                        <img src={targetChar.avatar} className="w-full h-full rounded-md object-cover" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-gray-500 font-medium">{(targetChar?.name || '?')[0]}</div>
                                    )}
                                </div>

                                {/* Content */}
                                <div className="flex-1 min-w-0">
                                    <div className="text-[#576b95] font-medium text-[15px] mb-1 leading-tight">{targetChar?.name}</div>
                                    <div className="text-[#111111] text-[15px] leading-relaxed whitespace-pre-wrap break-words">{r.detail}</div>

                                    <div className="flex items-center justify-between mt-2.5">
                                        <div className="text-[#b2b2b2] text-[13px] flex items-center gap-2">
                                            <span>{r.title}</span>
                                            <button
                                                onClick={() => handleDeleteRecord(r)}
                                                className="text-[#576b95] px-1.5 py-0.5 rounded active:bg-[#f5f5f5] transition-colors"
                                            >
                                                删除
                                            </button>
                                        </div>
                                        <div className="w-8 h-5 bg-[#f5f5f5] rounded flex items-center justify-center cursor-pointer active:bg-gray-200 transition-colors">
                                            <div className="flex gap-1">
                                                <span className="w-1 h-1 rounded-full bg-[#576b95]"></span>
                                                <span className="w-1 h-1 rounded-full bg-[#576b95]"></span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-2 px-4 pointer-events-none z-30">
                    <button
                        disabled={isLoading}
                        onClick={() => handleGenerate('social')}
                        className="pointer-events-auto bg-green-500 text-white px-4 py-2.5 rounded-full shadow-lg font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform disabled:opacity-60"
                    >
                        {isLoading ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>}
                        刷新朋友圈
                    </button>
                    <button
                        disabled={isLoading}
                        onClick={() => handleGenerate('social', undefined, { replaceExisting: true })}
                        className="pointer-events-auto bg-[#576b95] text-white px-4 py-2.5 rounded-full shadow-lg font-bold text-xs flex items-center gap-2 active:scale-95 transition-transform disabled:opacity-60"
                    >
                        {isLoading ? <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5M16.5 3 21 7.5m0 0L16.5 12M21 7.5H7.5" /></svg>}
                        重Roll
                    </button>
                </div>
            </div>
        );
    };

    const DesktopAppIcon = ({ app }: { app: DesktopAppEntry }) => {
        const IconComponent = app.icon;
        return (
            <div className={`checkphone-desktop-app ${isDesktopEditing ? 'is-editing' : ''}`}>
                <button
                    type="button"
                    className={`checkphone-desktop-chip ${app.danger ? 'is-danger' : ''} ${app.isUtility ? 'is-utility' : ''}`}
                    onClick={() => handleDesktopAppClick(app.onClick)}
                    onPointerDown={startDesktopEditPress}
                    onPointerUp={cancelDesktopEditPress}
                    onPointerCancel={cancelDesktopEditPress}
                    onPointerMove={cancelDesktopEditPress}
                    onContextMenu={(event) => {
                        event.preventDefault();
                        setIsDesktopEditing(true);
                    }}
                    aria-label={app.label}
                >
                    {app.badge === 'dot' ? <span className="checkphone-desktop-badge is-dot"></span> : null}
                    {typeof app.badge === 'number' && app.badge > 0 ? (
                        <span className="checkphone-desktop-badge">{app.badge > 99 ? '99+' : app.badge}</span>
                    ) : null}
                    {app.customIcon ? (
                        <img className="checkphone-desktop-custom-icon" src={app.customIcon} alt="" />
                    ) : IconComponent ? (
                        <IconComponent className="checkphone-desktop-icon" weight="regular" />
                    ) : (
                        <span className="checkphone-desktop-emoji">{app.emoji || '•'}</span>
                    )}
                </button>
                <span className="checkphone-desktop-label">{app.label}</span>
                {isDesktopEditing && app.onDelete ? (
                    <button
                        type="button"
                        className="checkphone-desktop-delete"
                        onClick={(event) => {
                            event.stopPropagation();
                            app.onDelete?.();
                        }}
                        aria-label={`删除 ${app.label}`}
                    >
                        ×
                    </button>
                ) : null}
            </div>
        );
    };

    const DesktopDockButton = ({ icon: IconComponent, onClick, label }: { icon: Icon; onClick: () => void; label: string }) => (
        <button type="button" className="checkphone-desktop-dock-button" onClick={onClick} aria-label={label}>
            <IconComponent className="checkphone-desktop-dock-icon" weight="regular" />
        </button>
    );

    const renderDesktop = () => {
        const clockLabel = formatDesktopClock(desktopNow);
        const activeTimeLabel = formatDesktopActiveTime(desktopNow);
        const activePhotoId = activeDesktopPhotoId || desktopPhotoCards[0]?.id || null;
        const openCoreApp = (appId: string) => {
            if (appId === 'settings') {
                setIsDesktopEditing(false);
                setShowDesktopSettings(true);
                return;
            }
            const appMap: Record<string, string> = {
                chat: 'chat',
                [NETEASE_MUSIC_RECORD_TYPE]: NETEASE_MUSIC_RECORD_TYPE,
                taobao: 'taobao',
                delivery: 'waimai',
                social: 'social',
                call: 'call',
            };
            setActiveAppId(appMap[appId] || appId);
        };
        const desktopApps: DesktopAppEntry[] = [
            ...CHECKPHONE_DESKTOP_PAGE_APPS.map(app => {
                const recordCount = app.recordType ? getRecentRecordsByType(app.recordType).length : 0;
                return {
                    id: app.id,
                    label: app.label,
                    icon: app.icon,
                    customIcon: desktopIconOverrides[app.id],
                    badge: app.id === 'social' && recordCount > 0 ? 'dot' as const : recordCount || undefined,
                    onClick: () => openCoreApp(app.id),
                };
            }),
            ...customApps.map(app => ({
                id: app.id,
                label: app.name,
                emoji: app.icon,
                customIcon: desktopIconOverrides[app.id],
                badge: getRecentRecordsByType(app.id).length || undefined,
                customAppId: app.id,
                onClick: () => setActiveAppId(app.id),
                onDelete: () => handleDeleteApp(app.id),
            })),
        ];
        const appPages = chunkDesktopApps(desktopApps, CHECKPHONE_DESKTOP_APP_PAGE_SIZE);
        const desktopStyle = desktopAppearance.wallpaper
            ? { '--cpd-wallpaper': `url(${desktopAppearance.wallpaper})` } as React.CSSProperties
            : undefined;

        return (
            <div
                className={`checkphone-desktop-ui absolute inset-0 z-0 ${desktopAppearance.wallpaper ? 'has-wallpaper' : ''}`}
                style={desktopStyle}
            >
                <div className="checkphone-desktop-content">
                    <div className="checkphone-desktop-statusbar">
                        <span>{clockLabel}</span>
                        <div className="checkphone-desktop-status-right">
                            <span className="checkphone-desktop-bars"><i></i><i></i><i></i><i></i></span>
                            <WifiHigh className="checkphone-desktop-wifi" weight="fill" />
                            <span className="checkphone-desktop-batt"><i></i></span>
                        </div>
                    </div>

                    <header className="checkphone-desktop-head">
                        <div className="checkphone-desktop-who">
                            <div className="checkphone-desktop-avatar">
                                {targetChar?.avatar ? (
                                    <img src={targetChar.avatar} alt={`${targetChar.name} 头像`} />
                                ) : (
                                    <span>{targetChar?.name?.trim()[0] || '?'}</span>
                                )}
                            </div>
                            <div className="checkphone-desktop-meta">
                                <span className="checkphone-desktop-online"><i></i>在线 · 刚刚活跃 {activeTimeLabel}</span>
                                <button type="button" className="checkphone-desktop-disconnect-pill" onClick={handleExitPhone}>
                                    断开链路 ↗
                                </button>
                            </div>
                        </div>
                        <div className="checkphone-desktop-clock">
                            <div className="checkphone-desktop-clock-time">{clockLabel}</div>
                            <div className="checkphone-desktop-clock-date">{formatDesktopDateLine(desktopNow)}</div>
                        </div>
                    </header>

                    <section className="checkphone-desktop-fan" aria-label="最近相册照片">
                        {desktopPhotoCards.map((photo, index) => {
                            const isActive = photo.id === activePhotoId;
                            const rotation = getDesktopFanRotation(desktopPhotoCards.length, index);
                            return (
                                <button
                                    type="button"
                                    key={photo.id}
                                    className={`checkphone-desktop-photo-card ${isActive ? 'is-active' : ''} ${photo.isFallback ? 'is-fallback' : ''}`}
                                    style={{
                                        '--rot': `${rotation}deg`,
                                        '--deal-delay': `${index * 80}ms`,
                                        zIndex: isActive ? 20 : index + 1,
                                    } as React.CSSProperties}
                                    onClick={() => setActiveDesktopPhotoId(photo.id)}
                                >
                                    {photo.src ? (
                                        <img src={photo.src} alt="" />
                                    ) : (
                                        <span className="checkphone-desktop-photo-empty">{targetChar?.name?.trim()[0] || '?'}</span>
                                    )}
                                    <span className="checkphone-desktop-photo-noise"></span>
                                    <span className="checkphone-desktop-photo-scrim"></span>
                                    <span className="checkphone-desktop-photo-caption">{photo.caption}</span>
                                </button>
                            );
                        })}
                    </section>

                    <div className="checkphone-desktop-page-dots" role="tablist" aria-label="桌面分页">
                        {appPages.map((_, index) => (
                            <button
                                type="button"
                                key={index}
                                className={index === desktopPage ? 'is-on' : ''}
                                onClick={() => scrollDesktopPage(index)}
                                aria-label={`第 ${index + 1} 页`}
                            ></button>
                        ))}
                    </div>

                    <div
                        ref={desktopPagerRef}
                        className="checkphone-desktop-pages no-scrollbar"
                        onScroll={handleDesktopPageScroll}
                    >
                        {appPages.map((page, pageIndex) => (
                            <div className="checkphone-desktop-grid" key={pageIndex}>
                                {page.map(app => <DesktopAppIcon key={app.id} app={app} />)}
                            </div>
                        ))}
                    </div>

                    <div className="checkphone-desktop-spacer"></div>

                    <nav className="checkphone-desktop-dock" aria-label="常用 App">
                        {CHECKPHONE_DESKTOP_DOCK_APPS.map(app => (
                            <DesktopDockButton
                                key={app.id}
                                icon={app.icon}
                                label={app.label}
                                onClick={() => openCoreApp(app.id)}
                            />
                        ))}
                    </nav>

                    <div className="checkphone-desktop-home-ind"><i></i></div>
                </div>
            </div>
        );
    };

    if (view === 'select') {
        return (
            <div className="checkphone-select-ui absolute inset-0 overflow-hidden">
                <div className="checkphone-select-sweep" aria-hidden="true"></div>
                <div className="checkphone-select-grain" aria-hidden="true"></div>
                <div className="checkphone-select-vignette" aria-hidden="true"></div>

                <div className="relative z-10 flex h-full flex-col">
                    <div className="checkphone-terminal-bar">
                        <span className="checkphone-terminal-mid"><span></span>INTERCEPT</span>
                    </div>

                    <button
                        type="button"
                        onClick={() => requestCheckPhoneExit('close_app')}
                        className="checkphone-select-back"
                        aria-label="返回桌面"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.5 19 8.5 12l7-7" />
                        </svg>
                    </button>

                    <div className="checkphone-rec-indicator"><span></span>REC · LIVE</div>

                    <div className="checkphone-select-scroll no-scrollbar">
                        <header className="checkphone-select-header">
                            <div className="checkphone-secure-link">
                                <span className="checkphone-pulse-dot"></span>
                                SECURE LINK ESTABLISHED
                                <span className="checkphone-cursor"></span>
                            </div>
                            <h1>监听目标</h1>
                            <div className="checkphone-select-subtitle">/// INTERCEPTED DEVICES</div>
                            <div className="checkphone-select-meta">
                                检测到 <b>{selectTargets.length}</b> 台设备 · 实时镜像
                                <span className="checkphone-scanning"><i></i><i></i><i></i></span>
                            </div>
                        </header>

                        <div className="checkphone-select-divider">
                            <span></span>SELECT TARGET<span></span>
                        </div>

                        {selectTargets.length > 0 ? (
                            <div className="checkphone-target-grid">
                                {selectTargets.map((target, index) => (
                                    <button
                                        key={target.character.id}
                                        type="button"
                                        onClick={() => handleConnectTarget(target.character)}
                                        className={`checkphone-target-card checkphone-target-card--${target.mode}`}
                                        style={{
                                            '--card-delay': `${index * 55}ms`,
                                            '--avatar-gradient': target.avatarGradient,
                                        } as React.CSSProperties}
                                    >
                                        {target.mode === 'live' && (
                                            <div className="checkphone-live-badge"><span></span>LIVE</div>
                                        )}

                                        <div className="checkphone-avatar-frame">
                                            <div className="checkphone-avatar-image">
                                                {target.character.avatar ? (
                                                    <img src={target.character.avatar} alt={`${target.character.name} 头像`} />
                                                ) : (
                                                    <span>{target.character.name.trim()[0] || '?'}</span>
                                                )}
                                            </div>
                                            <div className="checkphone-reticle" aria-hidden="true">
                                                <i></i><i></i><i></i><i></i>
                                            </div>
                                        </div>

                                        <div className="checkphone-card-name">{formatTargetDisplayName(target.character.name)}</div>
                                        <div className="checkphone-card-id">#{target.fingerprint}</div>

                                        <div className="checkphone-card-row">
                                            <span className="checkphone-target-status">
                                                <i></i>{target.statusLabel}
                                            </span>
                                            <span className="checkphone-minibars" aria-label={`信号强度 ${target.signalStrength}`}>
                                                {Array.from({ length: 4 }, (_, barIndex) => (
                                                    <i key={barIndex} className={barIndex < target.signalStrength ? '' : 'is-dim'}></i>
                                                ))}
                                            </span>
                                        </div>

                                        <div className="checkphone-card-peek">
                                            <span></span>{target.peekLabel}
                                        </div>

                                        <div className="checkphone-card-foot">
                                            <span>{target.recordsCount} records</span>
                                            <span>{target.appCount} apps</span>
                                        </div>

                                        <div className="checkphone-acquire">▶ {target.actionLabel}</div>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="checkphone-empty-state">
                                <div className="checkphone-empty-reticle" aria-hidden="true"></div>
                                <p>未检测到可接入设备</p>
                                <span>请先在角色档案中添加角色</span>
                            </div>
                        )}

                        <footer className="checkphone-select-footer">
                            <div className="checkphone-select-hint"><span>⟢</span> 轻点目标 · 接入角色手机镜像</div>
                            <button type="button" onClick={() => requestCheckPhoneExit('close_app')} className="checkphone-disconnect">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v8M6.4 7.4a8 8 0 1 0 11.2 0" />
                                </svg>
                                断开所有链路
                            </button>
                        </footer>
                    </div>
                </div>

                {accessOverlay && (
                    <div className={`checkphone-access-overlay ${accessOverlay.status === 'granted' ? 'is-granted' : ''}`}>
                        <div className="checkphone-access-ring">
                            {accessOverlay.status === 'granted' && (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 12l5 5L20 6" />
                                </svg>
                            )}
                        </div>
                        <div className="checkphone-access-name">{accessOverlay.name}</div>
                        <div className="checkphone-access-line">
                            {accessOverlay.status === 'granted' ? 'ACCESS GRANTED · 正在进入设备' : '建立连接中...'}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // Phone View Container
    // FIXED: Use absolute inset-0 to force fill parent container properly
    return (
        <div className="absolute inset-0 bg-slate-900 overflow-hidden font-sans overscroll-none" style={checkPhoneRootStyle}>
            {activeAppId === 'home' ? renderDesktop() : (
                <>
                    {activeAppId === 'chat' && renderChatList()}
                    {activeAppId === 'chat_detail' && renderChatDetail()}
                    {activeAppId === 'taobao' && renderTaobaoList()}
                    {activeAppId === 'waimai' && renderMeituanList()}
                    {activeAppId === NETEASE_MUSIC_RECORD_TYPE && renderNeteaseMusicList()}
                    {activeAppId === 'social' && renderMomentsList()}
                    {activeAppId === 'call' && renderGenericList('call', '通话记录')}

                    {/* Render Custom Apps */}
                    {customApps.find(a => a.id === activeAppId) && (
                        (() => {
                            const app = customApps.find(a => a.id === activeAppId)!;
                            return renderGenericList(app.id, app.name, app.prompt);
                        })()
                    )}
                </>
            )}

            <input
                ref={desktopWallpaperInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void handleDesktopWallpaperUpload(file);
                    event.currentTarget.value = '';
                }}
            />
            <input
                ref={desktopIconInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) {
                        void handleDesktopIconUpload(file);
                    } else {
                        setDesktopIconUploadTargetId(null);
                    }
                    event.currentTarget.value = '';
                }}
            />
            <input
                ref={desktopPhotoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) {
                        void handleDesktopPhotoUpload(file);
                    } else {
                        setDesktopPhotoUploadSlot(null);
                    }
                    event.currentTarget.value = '';
                }}
            />

            <Modal
                isOpen={Boolean(contextExitAction)}
                title="要让他知道吗？"
                onClose={cancelContextExitPrompt}
                footer={(
                    <div className="w-full space-y-2">
                        <button
                            type="button"
                            onClick={() => void handleHidePhoneContext()}
                            disabled={isResolvingContextExit}
                            className="w-full rounded-2xl bg-slate-900 py-3 text-sm font-bold text-white transition-transform active:scale-95 disabled:opacity-60"
                        >
                            {isResolvingContextExit ? '正在藏起来...' : '不让他知道'}
                        </button>
                        <button
                            type="button"
                            onClick={handleKeepPhoneContext}
                            disabled={isResolvingContextExit}
                            className="w-full rounded-2xl bg-rose-500 py-3 text-sm font-bold text-white transition-transform active:scale-95 disabled:opacity-60"
                        >
                            让他知道
                        </button>
                        <button
                            type="button"
                            onClick={cancelContextExitPrompt}
                            disabled={isResolvingContextExit}
                            className="w-full rounded-2xl bg-slate-100 py-2.5 text-xs font-bold text-slate-500 transition-transform active:scale-95 disabled:opacity-60"
                        >
                            继续看手机
                        </button>
                    </div>
                )}
            >
                <div className="space-y-4 text-center">
                    <p className="text-sm leading-6 text-slate-600">
                        这次翻到的 {pendingPhoneContextRecords.length} 条痕迹，要不要让
                        <span className="font-semibold text-slate-900"> {targetChar?.name || '他'} </span>
                        在之后察觉？
                    </p>
                    <div className="space-y-2 rounded-3xl bg-slate-50 p-3 text-left">
                        {pendingPhoneContextRecords.slice(0, 3).map(record => (
                            <div key={record.id} className="rounded-2xl bg-white px-3 py-2 shadow-sm">
                                <div className="truncate text-xs font-bold text-slate-800">{record.title}</div>
                                <div className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500">
                                    {record.value ? `${record.value} · ` : ''}{record.detail}
                                </div>
                            </div>
                        ))}
                        {pendingPhoneContextRecords.length > 3 ? (
                            <div className="px-2 pb-1 text-center text-[11px] font-semibold text-slate-400">
                                还有 {pendingPhoneContextRecords.length - 3} 条
                            </div>
                        ) : null}
                    </div>
                    <p className="text-xs leading-5 text-slate-400">
                        不让他知道的话，手机里还会留着这些记录，只是之后聊天里不会提起。
                    </p>
                </div>
            </Modal>

            <Modal isOpen={showDesktopSettings} title="查手机设置" onClose={() => setShowDesktopSettings(false)}>
                <div className="checkphone-settings-panel">
                    <section className="checkphone-settings-section">
                        <div className="checkphone-settings-section-head">
                            <div>
                                <h4>桌面外观</h4>
                                <span>{desktopAppearance.wallpaper ? '已使用自定义桌面' : '默认桌面'}</span>
                            </div>
                        </div>
                        <div className={`checkphone-settings-wallpaper ${desktopAppearance.wallpaper ? 'has-image' : ''}`}>
                            {desktopAppearance.wallpaper ? (
                                <img src={desktopAppearance.wallpaper} alt="" />
                            ) : (
                                <span>Desktop</span>
                            )}
                        </div>
                        <div className="checkphone-settings-actions">
                            <button type="button" onClick={() => desktopWallpaperInputRef.current?.click()}>
                                换桌面
                            </button>
                            <button
                                type="button"
                                onClick={handleResetDesktopWallpaper}
                                disabled={!desktopAppearance.wallpaper}
                            >
                                恢复默认
                            </button>
                        </div>
                    </section>

                    <section className="checkphone-settings-section">
                        <div className="checkphone-settings-section-head">
                            <div>
                                <h4>桌面三张照片</h4>
                                <span>{desktopCustomPhotoCount > 0 ? `已自定义 ${desktopCustomPhotoCount}/3 张原图` : '默认读取相册最新照片'}</span>
                            </div>
                        </div>
                        <div className="checkphone-settings-photo-grid">
                            {desktopPhotoCards.map((photo, index) => {
                                const customPhoto = desktopAppearance.galleryPhotos?.[index]?.trim();
                                return (
                                    <div className="checkphone-settings-photo-slot" key={`photo-slot-${index}`}>
                                        <div className={`checkphone-settings-photo-preview ${photo.src ? 'has-image' : ''}`}>
                                            {photo.src ? (
                                                <img src={photo.src} alt="" />
                                            ) : (
                                                <span>{index + 1}</span>
                                            )}
                                            <b>{String(index + 1).padStart(2, '0')}</b>
                                        </div>
                                        <div className="checkphone-settings-photo-caption">
                                            {customPhoto ? '自定义原图' : photo.caption}
                                        </div>
                                        <div className="checkphone-settings-photo-actions">
                                            <button type="button" onClick={() => openDesktopPhotoUpload(index)}>
                                                换原图
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleResetDesktopPhoto(index)}
                                                disabled={!customPhoto}
                                            >
                                                恢复
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    <button
                        type="button"
                        className="checkphone-settings-install"
                        onClick={() => {
                            setShowDesktopSettings(false);
                            setShowCreateModal(true);
                        }}
                    >
                        <Plus weight="bold" />
                        安装新 App
                    </button>

                    <section className="checkphone-settings-section">
                        <div className="checkphone-settings-section-head">
                            <div>
                                <h4>App 图标</h4>
                                <span>{desktopSettingsApps.length} 个桌面图标</span>
                            </div>
                        </div>
                        <div className="checkphone-settings-icon-list">
                            {desktopSettingsApps.map(app => {
                                const IconComponent = 'icon' in app ? app.icon : undefined;
                                const iconOverride = desktopIconOverrides[app.id];
                                const canDelete = 'isCustom' in app && app.isCustom;
                                return (
                                    <div className="checkphone-settings-icon-row" key={app.id}>
                                        <div className="checkphone-settings-icon-sample">
                                            {iconOverride ? (
                                                <img src={iconOverride} alt="" />
                                            ) : IconComponent ? (
                                                <IconComponent weight="regular" />
                                            ) : (
                                                <span>{'emoji' in app ? app.emoji : '•'}</span>
                                            )}
                                        </div>
                                        <div className="checkphone-settings-icon-name">{app.label}</div>
                                        <div className="checkphone-settings-icon-actions">
                                            <button type="button" onClick={() => openDesktopIconUpload(app.id)}>
                                                换图标
                                            </button>
                                            {iconOverride ? (
                                                <button type="button" onClick={() => handleResetDesktopIcon(app.id)}>
                                                    恢复
                                                </button>
                                            ) : null}
                                            {canDelete ? (
                                                <button
                                                    type="button"
                                                    className="is-danger"
                                                    onClick={() => handleDeleteApp(app.id)}
                                                >
                                                    卸载
                                                </button>
                                            ) : null}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                </div>
            </Modal>

            {/* Create App Modal */}
            <Modal isOpen={showCreateModal} title="安装自定义 App" onClose={() => setShowCreateModal(false)} footer={<button onClick={handleCreateCustomApp} className="w-full py-3 bg-blue-500 text-white font-bold rounded-2xl">安装到桌面</button>}>
                <div className="space-y-4">
                    <div className="flex gap-4">
                        <div className="w-16 h-16 rounded-xl flex items-center justify-center text-3xl shadow-md border-2 border-slate-100 shrink-0" style={{ background: newAppColor }}>
                            {newAppIcon}
                        </div>
                        <div className="flex-1 space-y-2">
                            <input value={newAppName} onChange={e => setNewAppName(e.target.value)} placeholder="App 名称 (如: 银行)" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm" />
                            <div className="flex gap-2">
                                <input value={newAppIcon} onChange={e => setNewAppIcon(e.target.value)} placeholder="Emoji" className="w-16 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-center" />
                                <input type="color" value={newAppColor} onChange={e => setNewAppColor(e.target.value)} className="h-9 flex-1 cursor-pointer rounded-lg bg-transparent" />
                            </div>
                        </div>
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">功能指令 (AI Prompt)</label>
                        <textarea
                            value={newAppPrompt}
                            onChange={e => setNewAppPrompt(e.target.value)}
                            placeholder="例如: 显示该用户的存款余额、近期的转账记录以及理财收益。"
                            className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs resize-none"
                        />
                        <p className="text-[9px] text-slate-400 mt-1">AI 将根据此指令生成该 App 内部的数据。</p>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default CheckPhone;
