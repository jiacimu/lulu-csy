import { useEffect, useState } from 'react';
import type {
    MusicPlayable,
    NeteaseAlbumSummary,
    NeteaseArtist,
    NeteaseDjCreator,
    NeteaseDjProgram,
    NeteaseDjRadio,
    NeteaseSong,
} from '../types/music';
import { isSongPlayable } from '../types/music';
import { resolvePlayableUrl } from '../utils/musicService';

export interface PlaybackState {
    isPlaying: boolean;
    currentSong: MusicPlayable | null;
    currentTime: number;
    duration: number;
    progress: number;
    volume: number;
    playlist: MusicPlayable[];
    currentIndex: number;
}

const initialState: PlaybackState = {
    isPlaying: false,
    currentSong: null,
    currentTime: 0,
    duration: 0,
    progress: 0,
    volume: 0.8,
    playlist: [],
    currentIndex: -1,
};

type Listener = (state: PlaybackState) => void;

let globalAudio: HTMLAudioElement | null = null;
let audioEventsBound = false;
let audioPlaybackPrimed = false;
let currentRequestId = 0;
let currentState: PlaybackState = { ...initialState };
const listeners = new Set<Listener>();
const SILENT_AUDIO_DATA_URI = 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA/+M4wAAAAAAAAAAAAEluZm8AAAAPAAAAAwAAAbAAqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV////////////////////////////////////////////AAAAAExhdmM1OC4xMwAAAAAAAAAAAAAAACQAAAAAAAAAAaC9GQMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+MYxAANCAKeeUAQBAA0oyq1HwfB8Hw+BAMfwfB8EAfD4EAgGP4Pg+D4Ph8CAfB8HwfB8CAIB8Hw+BAMfwfB8Hw+D4EAx/B8HwfB8Hw+D4EAx/+MYxA0AAADSAAAAALhj4fg+D4Pg+H4IB8PwfB8CAY/g+D4Pg+HwIB8HwfB8HwIBj+D4Pg+D4Ph8CAfB8HwfB8CAQD4fB8HwfB8';

function buildOuterSongUrl(songId: number): string {
    return `https://music.163.com/song/media/outer/url?id=${songId}.mp3`;
}

function cloneArtist(artist: NeteaseArtist): NeteaseArtist {
    return { ...artist };
}

function cloneAlbum(album: NeteaseAlbumSummary): NeteaseAlbumSummary {
    return {
        ...album,
        ...(album.songs ? { songs: album.songs.map(cloneSong) } : {}),
    };
}

function cloneDjCreator(creator: NeteaseDjCreator): NeteaseDjCreator {
    return { ...creator };
}

function cloneRadio(radio: NeteaseDjRadio): NeteaseDjRadio {
    return {
        ...radio,
        ...(radio.dj ? { dj: cloneDjCreator(radio.dj) } : {}),
        ...(radio.programs ? { programs: radio.programs.map(cloneProgram) } : {}),
    };
}

function cloneSong(song: NeteaseSong): NeteaseSong {
    return {
        ...song,
        artists: song.artists.map(cloneArtist),
        album: cloneAlbum(song.album),
        ...(song.alias ? { alias: [...song.alias] } : {}),
    };
}

function cloneProgram(program: NeteaseDjProgram): NeteaseDjProgram {
    return {
        ...program,
        ...(program.radio ? { radio: cloneRadio(program.radio) } : {}),
        ...(program.dj ? { dj: cloneDjCreator(program.dj) } : {}),
        ...(program.mainSong ? { mainSong: cloneSong(program.mainSong) } : {}),
    };
}

function clonePlayable(playable: MusicPlayable): MusicPlayable {
    return isSongPlayable(playable) ? cloneSong(playable) : cloneProgram(playable);
}

function buildFallbackPlaybackUrl(playable: MusicPlayable): string | null {
    return isSongPlayable(playable) ? buildOuterSongUrl(playable.id) : null;
}

function getPlayableDuration(playable: MusicPlayable): number {
    return playable.duration > 0 ? playable.duration / 1000 : 0;
}

function cloneState(state: PlaybackState): PlaybackState {
    return {
        ...state,
        currentSong: state.currentSong ? clonePlayable(state.currentSong) : null,
        playlist: state.playlist.map(clonePlayable),
    };
}

function notifyListeners(): void {
    const snapshot = cloneState(currentState);
    listeners.forEach((listener) => listener(snapshot));
}

function updateState(updater: (state: PlaybackState) => PlaybackState): void {
    currentState = updater(currentState);
    notifyListeners();
}

function getAudio(): HTMLAudioElement | null {
    if (typeof Audio === 'undefined') return null;

    if (!globalAudio) {
        globalAudio = new Audio();
        globalAudio.preload = 'auto';
        globalAudio.volume = initialState.volume;
    }

    return globalAudio;
}

function primeAudioPlayback(audio: HTMLAudioElement): void {
    if (audioPlaybackPrimed) return;

    audioPlaybackPrimed = true;

    try {
        const previousMuted = audio.muted;
        const previousVolume = audio.volume;
        const hadSrc = audio.hasAttribute('src');
        const primedSrc = SILENT_AUDIO_DATA_URI;

        audio.muted = true;
        audio.volume = 0;

        if (!hadSrc) {
            audio.src = primedSrc;
        }

        const restore = () => {
            audio.muted = previousMuted;
            audio.volume = previousVolume;

            if (!hadSrc) {
                const currentSrc = audio.currentSrc || audio.getAttribute('src') || '';
                if (currentSrc !== primedSrc) {
                    return;
                }

                audio.pause();
                audio.removeAttribute('src');
                audio.load();
            }
        };

        const playPromise = audio.play();
        if (playPromise && typeof playPromise.then === 'function') {
            playPromise
                .then(() => restore())
                .catch(() => {
                    audioPlaybackPrimed = false;
                    restore();
                });
            return;
        }

        restore();
    } catch {
        audioPlaybackPrimed = false;
    }
}

function syncStateFromAudio(overrides: Partial<PlaybackState> = {}): void {
    const audio = getAudio();
    if (!audio) {
        updateState((state) => ({ ...state, ...overrides }));
        return;
    }

    const duration = Number.isFinite(audio.duration) ? audio.duration : (overrides.duration ?? currentState.duration);
    const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : (overrides.currentTime ?? currentState.currentTime);
    const safeDuration = duration > 0 ? duration : 0;
    const progress = safeDuration > 0 ? Math.min(100, (currentTime / safeDuration) * 100) : 0;

    updateState((state) => ({
        ...state,
        ...overrides,
        currentTime,
        duration: safeDuration,
        progress,
        isPlaying: !audio.paused && !audio.ended,
    }));
}

async function playSongInternal(song: MusicPlayable, playlist?: MusicPlayable[]): Promise<void> {
    const audio = getAudio();
    if (!audio) return;

    bindAudioEvents();
    primeAudioPlayback(audio);

    const sourceQueue = playlist && playlist.length > 0 ? playlist : [song];
    const queue = sourceQueue
        .filter((item) => item.kind === song.kind)
        .map(clonePlayable);
    const queueIndex = queue.findIndex((item) => item.id === song.id);
    const currentIndex = queueIndex >= 0 ? queueIndex : 0;
    const requestId = ++currentRequestId;

    audio.volume = currentState.volume;
    updateState((state) => ({
        ...state,
        currentSong: clonePlayable(song),
        playlist: queue,
        currentIndex,
        isPlaying: false,
        currentTime: 0,
        duration: getPlayableDuration(song),
        progress: 0,
    }));

    try {
        const targetUrl = await resolvePlayableUrl(song);
        if (requestId !== currentRequestId) return;
        if (!targetUrl) {
            throw new Error('没有可用的播放链接');
        }

        audio.src = targetUrl;
        audio.currentTime = 0;
        audio.load();
        await audio.play();
        syncStateFromAudio({
            currentSong: clonePlayable(song),
            playlist: queue,
            currentIndex,
            isPlaying: true,
        });
    } catch (error) {
        console.error('[AudioPlayer] Play error:', error);
        if (requestId === currentRequestId) {
            const fallbackUrl = buildFallbackPlaybackUrl(song);

            if (fallbackUrl) {
                try {
                    audio.src = fallbackUrl;
                    audio.currentTime = 0;
                    audio.load();
                    await audio.play();
                    syncStateFromAudio({
                        currentSong: clonePlayable(song),
                        playlist: queue,
                        currentIndex,
                        isPlaying: true,
                    });
                    return;
                } catch (fallbackError) {
                    console.error('[AudioPlayer] Fallback play error:', fallbackError);
                }
            }

            syncStateFromAudio({ isPlaying: false });
        }
    }
}

async function playIndex(index: number): Promise<void> {
    if (index < 0 || index >= currentState.playlist.length) return;
    const song = currentState.playlist[index];
    if (!song) return;
    await playSongInternal(song, currentState.playlist);
}

function pauseInternal(): void {
    const audio = getAudio();
    if (!audio) return;

    audio.pause();
    syncStateFromAudio({ isPlaying: false });
}

async function resumeInternal(): Promise<void> {
    const audio = getAudio();
    if (!audio?.src) return;

    try {
        await audio.play();
        syncStateFromAudio({ isPlaying: true });
    } catch (error) {
        console.error('[AudioPlayer] Resume error:', error);
    }
}

function togglePlayInternal(): void {
    if (currentState.isPlaying) {
        pauseInternal();
        return;
    }

    void resumeInternal();
}

function seekInternal(percent: number): void {
    const audio = getAudio();
    if (!audio) return;

    const safeDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
    if (safeDuration <= 0) return;

    const nextPercent = Math.max(0, Math.min(100, percent));
    audio.currentTime = (nextPercent / 100) * safeDuration;
    syncStateFromAudio();
}

async function playNextInternal(): Promise<void> {
    const playlistLength = currentState.playlist.length;
    if (playlistLength === 0) return;

    const nextIndex = currentState.currentIndex >= 0
        ? (currentState.currentIndex + 1) % playlistLength
        : 0;
    await playIndex(nextIndex);
}

async function playPrevInternal(): Promise<void> {
    const playlistLength = currentState.playlist.length;
    if (playlistLength === 0) return;

    const prevIndex = currentState.currentIndex >= 0
        ? (currentState.currentIndex - 1 + playlistLength) % playlistLength
        : 0;
    await playIndex(prevIndex);
}

function setVolumeInternal(volume: number): void {
    const nextVolume = Math.max(0, Math.min(1, volume));
    const audio = getAudio();
    if (audio) {
        audio.volume = nextVolume;
    }

    updateState((state) => ({
        ...state,
        volume: nextVolume,
    }));
}

function bindAudioEvents(): void {
    const audio = getAudio();
    if (!audio || audioEventsBound) return;

    const sync = () => syncStateFromAudio();
    const handleEnded = () => { void playNextInternal(); };

    audio.addEventListener('timeupdate', sync);
    audio.addEventListener('loadedmetadata', sync);
    audio.addEventListener('durationchange', sync);
    audio.addEventListener('play', sync);
    audio.addEventListener('pause', sync);
    audio.addEventListener('seeking', sync);
    audio.addEventListener('seeked', sync);
    audio.addEventListener('ended', handleEnded);
    audioEventsBound = true;
}

export function useAudioPlayer() {
    const [state, setState] = useState<PlaybackState>(() => cloneState(currentState));

    useEffect(() => {
        bindAudioEvents();

        const listener: Listener = (nextState) => {
            setState(nextState);
        };

        listeners.add(listener);
        listener(cloneState(currentState));

        return () => {
            listeners.delete(listener);
        };
    }, []);

    return {
        ...state,
        playSong: playSongInternal,
        pause: pauseInternal,
        resume: resumeInternal,
        togglePlay: togglePlayInternal,
        seek: seekInternal,
        playNext: playNextInternal,
        playPrev: playPrevInternal,
        setVolume: setVolumeInternal,
    };
}

export function getCurrentPlayback(): PlaybackState {
    return cloneState(currentState);
}
