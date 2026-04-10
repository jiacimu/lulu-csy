/**
 * MusicApp — Emo Cloud 真实 API 版
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { useAudioPlayer } from '../../hooks/useAudioPlayer';
import {
  isSongPlayable,
  type MusicPlayable,
  type MusicSearchBundle,
  type MusicSearchItem,
  type MusicSearchSection,
  type MusicSearchTab,
  type NeteaseAlbumSummary,
  type NeteaseArtistSummary,
  type NeteaseDjProgram,
  type NeteaseDjRadio,
  type NeteasePlaylist,
  type NeteaseSong,
  type NeteaseUserAccount,
} from '../../types/music';
import {
  checkQrStatus,
  clearMusicCookie,
  getAlbumDetail,
  getArtistAlbums,
  getArtistDesc,
  getArtistDetail,
  getArtistTopSongs,
  getDjProgramDetail,
  getDjPrograms,
  getDjRadioDetail,
  getPlaylistDetail,
  getQrKey,
  getQrUrl,
  getTopPlaylists,
  getUserAccount,
  isMusicLoggedIn,
  MUSIC_SEARCH_TAB_LABELS,
  MUSIC_SEARCH_TABS,
  searchMusicAll,
  searchMusicByType,
  setMusicCookie,
} from '../../utils/musicService';
import './music.css';

const SEARCH_HISTORY_KEY = 'music_recent_keywords';
const MUSIC_APP_NAME = 'Emo Cloud';
const MUSIC_VIP_NAME = 'Cloud VIP';
const MUSIC_SCAN_APP_NAME = '手机音乐 App';
const MUSIC_WEB_LOGIN_NAME = '网页登录页';

type RootPage = 'discover' | 'search' | 'profile';
type PrimaryPage = Exclude<RootPage, 'search'>;
type SearchableMusicTab = Exclude<MusicSearchTab, 'all'>;

type DetailView =
  | { type: 'playlistDetail'; id: number; seed?: NeteasePlaylist }
  | { type: 'albumDetail'; id: number; seed?: NeteaseAlbumSummary }
  | { type: 'artistDetail'; id: number; seed?: NeteaseArtistSummary }
  | { type: 'radioDetail'; id: number; seed?: NeteaseDjRadio }
  | { type: 'programDetail'; id: number; seed?: NeteaseDjProgram };

type Loadable<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

type PlaylistPreviewState = {
  playlist: NeteasePlaylist | null;
  tracks: NeteaseSong[];
  loading: boolean;
  error: string | null;
};

type ArtistDetailData = {
  artist: NeteaseArtistSummary | null;
  topSongs: NeteaseSong[];
  albums: NeteaseAlbumSummary[];
  description: string;
};

type RadioDetailData = {
  radio: NeteaseDjRadio | null;
  programs: NeteaseDjProgram[];
};

type ProgramDetailData = {
  program: NeteaseDjProgram | null;
};

type QrModalStatus = 'idle' | 'loading' | 'waiting' | 'scanned' | 'success' | 'expired' | 'error';

const IconBack = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>;
const IconSearch = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>;
const IconHome = ({ active }: { active?: boolean }) => <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />{!active && <polyline points="9 22 9 12 15 12 15 22" />}</svg>;
const IconSearchTab = ({ active }: { active?: boolean }) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.5 : 1.8} strokeLinecap="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>;
const IconUser = ({ active }: { active?: boolean }) => <svg width="24" height="24" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
const IconPlay = () => <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
const IconPause = () => <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>;
const IconPrev = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>;
const IconNext = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6z" /></svg>;
const IconHeart = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" /></svg>;
const IconMore = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>;
const IconPlaylist = () => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>;
const IconMiniPlay = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
const IconMiniPause = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" /></svg>;
const IconDown = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 9l6 6 6-6" /></svg>;
const IconClear = () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M15 9l-6 6M9 9l6 6" /></svg>;

function readSearchHistory(): string[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean)
      .slice(0, 8);
  } catch {
    return [];
  }
}

function writeSearchHistory(history: string[]): void {
  try {
    localStorage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(history.slice(0, 8)));
  } catch {
    // Ignore storage failures.
  }
}

function formatSeconds(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatDurationMs(durationMs: number): string {
  return formatSeconds(durationMs / 1000);
}

function formatPlayCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (value >= 100000000) return `${(value / 100000000).toFixed(1).replace(/\.0$/, '')}亿`;
  if (value >= 10000) return `${Math.round(value / 10000)}万`;
  return `${Math.round(value)}`;
}

function formatDateLabel(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`;
}

function getFallbackGradient(seed: number): string {
  const hue = ((seed % 360) + 360) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 72%, 66%), hsl(${(hue + 42) % 360}, 68%, 48%))`;
}

function buildQrImageCandidates(qrUrl: string): string[] {
  const encoded = encodeURIComponent(qrUrl);
  return [
    `https://quickchart.io/qr?text=${encoded}&size=240`,
    `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encoded}`,
  ];
}

function getVipLabel(account: NeteaseUserAccount | null): string {
  if (!account?.isVip) return '普通用户';
  if (account.vipLevel > 0) return `${MUSIC_VIP_NAME} Lv.${account.vipLevel}`;
  return MUSIC_VIP_NAME;
}

function getSongArtists(song: NeteaseSong): string {
  return song.artists.map((artist) => artist.name).join(' / ') || '未知歌手';
}

function getSongSubtitle(song: NeteaseSong): string {
  const albumName = song.album.name.trim();
  return albumName ? `${getSongArtists(song)} · ${albumName}` : getSongArtists(song);
}

function getPlaylistSubtitle(playlist: NeteasePlaylist): string {
  const owner = playlist.creator?.nickname?.trim();
  const count = playlist.trackCount > 0 ? `${playlist.trackCount} 首` : '';
  return [owner, count].filter(Boolean).join(' · ') || '歌单';
}

function getAlbumSubtitle(album: NeteaseAlbumSummary): string {
  const artistName = album.artistName?.trim();
  const publishDate = formatDateLabel(album.publishTime);
  const count = album.songCount ? `${album.songCount} 首` : '';
  return [artistName, publishDate, count].filter(Boolean).join(' · ') || '专辑';
}

function getArtistSubtitle(artist: NeteaseArtistSummary): string {
  const musicSize = artist.musicSize ? `${artist.musicSize} 首歌曲` : '';
  const albumSize = artist.albumSize ? `${artist.albumSize} 张专辑` : '';
  return [musicSize, albumSize].filter(Boolean).join(' · ') || '歌手';
}

function getRadioSubtitle(radio: NeteaseDjRadio): string {
  const owner = radio.dj?.nickname?.trim();
  const category = radio.category?.trim();
  const count = radio.programCount ? `${radio.programCount} 期` : '';
  return [owner || category, count].filter(Boolean).join(' · ') || '播客台';
}

function getProgramSubtitle(program: NeteaseDjProgram): string {
  const radioName = program.radio?.name?.trim() || program.radioName?.trim();
  const duration = program.duration > 0 ? formatDurationMs(program.duration) : '';
  return [radioName, duration].filter(Boolean).join(' · ') || '声音';
}

function getPlayableSubtitle(playable: MusicPlayable): string {
  return isSongPlayable(playable) ? getSongSubtitle(playable) : getProgramSubtitle(playable);
}

function getPlayableCover(playable: MusicPlayable): string | undefined {
  if (isSongPlayable(playable)) {
    return playable.album.picUrl;
  }
  return playable.coverUrl || playable.radio?.picUrl;
}

function getItemCover(item: MusicSearchItem): string | undefined {
  switch (item.kind) {
    case 'song':
      return item.album.picUrl;
    case 'playlist':
      return item.coverImgUrl;
    case 'album':
      return item.picUrl;
    case 'artist':
      return item.picUrl || item.avatarUrl;
    case 'radio':
      return item.picUrl;
    case 'program':
      return item.coverUrl || item.radio?.picUrl;
    default:
      return undefined;
  }
}

function getItemSubtitle(item: MusicSearchItem): string {
  switch (item.kind) {
    case 'song':
      return getSongSubtitle(item);
    case 'playlist':
      return getPlaylistSubtitle(item);
    case 'album':
      return getAlbumSubtitle(item);
    case 'artist':
      return getArtistSubtitle(item);
    case 'radio':
      return getRadioSubtitle(item);
    case 'program':
      return getProgramSubtitle(item);
    default:
      return '';
  }
}

function getItemBadge(item: MusicSearchItem): string {
  switch (item.kind) {
    case 'song':
      return item.duration > 0 ? formatDurationMs(item.duration) : '单曲';
    case 'playlist':
      return '歌单';
    case 'album':
      return '专辑';
    case 'artist':
      return '歌手';
    case 'radio':
      return '播客台';
    case 'program':
      return item.duration > 0 ? formatDurationMs(item.duration) : '声音';
    default:
      return '';
  }
}

function getSectionEmptyText(tab: MusicSearchTab): string {
  switch (tab) {
    case 'song':
      return '没有找到匹配单曲，试试歌手名或别名。';
    case 'playlist':
      return '没有找到匹配歌单，换个主题词再试试。';
    case 'album':
      return '没有找到匹配专辑，试试艺人名加专辑名。';
    case 'artist':
      return '没有找到匹配歌手，试试更完整的名字。';
    case 'radio':
      return '没有找到匹配播客台，试试节目品牌名或主播名。';
    case 'program':
      return '没有找到匹配声音，换个更短的关键词再试试。';
    default:
      return '暂时没有结果。';
  }
}

const CoverArt = ({
  src,
  alt,
  seed,
  className,
  note = '♪',
}: {
  src?: string;
  alt: string;
  seed: number;
  className: string;
  note?: string;
}) => (
  <div className={className} style={src ? undefined : { background: getFallbackGradient(seed) }}>
    {src ? <img src={src} alt={alt} /> : <span className="music-cover-fallback-note">{note}</span>}
  </div>
);

const PlayableRow = ({
  playable,
  currentPlayable,
  onClick,
}: {
  playable: MusicPlayable;
  currentPlayable: MusicPlayable | null;
  onClick: (playable: MusicPlayable) => void;
}) => {
  const isCurrent = currentPlayable?.kind === playable.kind && currentPlayable.id === playable.id;

  return (
    <li className="music-song-item" onClick={() => onClick(playable)}>
      <CoverArt
        src={getPlayableCover(playable)}
        alt={playable.name}
        seed={playable.id}
        className="music-song-cover"
        note={isSongPlayable(playable) ? '♪' : '播'}
      />
      <div className="music-song-info">
        <div className={`music-song-name ${isCurrent ? 'playing' : ''}`}>{playable.name}</div>
        <div className="music-song-artist">
          <span className="music-song-badge">{isSongPlayable(playable) ? '单曲' : '声音'}</span>
          {getPlayableSubtitle(playable)}
        </div>
      </div>
      <div className="music-song-actions">
        <div className="music-song-action"><IconHeart /></div>
        <div className="music-song-action"><IconMore /></div>
      </div>
    </li>
  );
};

const EntityRow = ({
  item,
  onClick,
}: {
  item: Exclude<MusicSearchItem, MusicPlayable>;
  onClick: () => void;
}) => (
  <li className="music-song-item" onClick={onClick}>
    <CoverArt src={getItemCover(item)} alt={item.name} seed={item.id} className="music-song-cover" note="♫" />
    <div className="music-song-info">
      <div className="music-song-name">{item.name}</div>
      <div className="music-song-artist">
        <span className="music-song-badge">{getItemBadge(item)}</span>
        {getItemSubtitle(item)}
      </div>
    </div>
    <div className="music-song-actions">
      <div className="music-song-action"><IconMore /></div>
    </div>
  </li>
);

const SectionBlock = ({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section>
    <div className="music-section-header">
      <div>
        <div className="music-section-title">{title}</div>
        {subtitle ? <div className="music-section-subtitle">{subtitle}</div> : null}
      </div>
      {action}
    </div>
    {children}
  </section>
);

const DetailShell = ({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) => (
  <>
    <div className="music-navbar">
      <div className="music-navbar-back" onClick={onBack}><IconBack /></div>
      <div className="music-navbar-title">{title}</div>
      <div style={{ width: 32 }} />
    </div>
    <div className="music-search-page music-no-scrollbar">{children}</div>
  </>
);

const HeroCard = ({
  cover,
  seed,
  title,
  subtitle,
  description,
  actions,
}: {
  cover?: string;
  seed: number;
  title: string;
  subtitle?: string;
  description?: string;
  actions?: React.ReactNode;
}) => (
  <div className="music-state-card" style={{ margin: '16px 0', padding: 18 }}>
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
      <CoverArt src={cover} alt={title} seed={seed} className="music-song-cover" note="♫" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="music-state-title" style={{ fontSize: 18 }}>{title}</div>
        {subtitle ? <div className="music-state-text" style={{ marginTop: 4 }}>{subtitle}</div> : null}
        {description ? <div className="music-state-text">{description}</div> : null}
        {actions ? <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>{actions}</div> : null}
      </div>
    </div>
  </div>
);

const DiscoverPage = ({
  playlists,
  playlistsLoading,
  playlistsError,
  previewPlaylist,
  previewTracks,
  previewLoading,
  previewError,
  currentPlayable,
  onSearch,
  onPlaylistSelect,
  onSongClick,
}: {
  playlists: NeteasePlaylist[];
  playlistsLoading: boolean;
  playlistsError: string | null;
  previewPlaylist: NeteasePlaylist | null;
  previewTracks: NeteaseSong[];
  previewLoading: boolean;
  previewError: string | null;
  currentPlayable: MusicPlayable | null;
  onSearch: () => void;
  onPlaylistSelect: (playlist: NeteasePlaylist) => void;
  onSongClick: (song: NeteaseSong, queue?: NeteaseSong[]) => void;
}) => (
  <div className="music-discover-page music-no-scrollbar">
    <div className="music-search-bar" onClick={onSearch}>
      <div className="music-search-input-wrapper music-search-entry" style={{ cursor: 'pointer' }}>
        <IconSearch />
        <span style={{ fontSize: 14, color: '#bbb' }}>搜索单曲、歌单、专辑、播客台、声音</span>
      </div>
    </div>

    <SectionBlock title="推荐歌单" subtitle="来自真实热度榜单的歌单推荐">
      {playlistsError ? (
        <div className="music-state-card">
          <div className="music-state-title">歌单加载失败</div>
          <div className="music-state-text">{playlistsError}</div>
        </div>
      ) : null}

      {playlistsLoading ? (
        <div className="music-playlist-grid">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="music-playlist-card">
              <div className="music-playlist-cover music-skeleton" />
              <div className="music-playlist-name music-skeleton" style={{ height: 34, marginTop: 6 }} />
            </div>
          ))}
        </div>
      ) : null}

      {!playlistsLoading && playlists.length > 0 ? (
        <div className="music-playlist-grid">
          {playlists.map((playlist, index) => (
            <div
              key={playlist.id}
              className={`music-playlist-card ${previewPlaylist?.id === playlist.id ? 'active' : ''}`}
              onClick={() => onPlaylistSelect(playlist)}
            >
              <CoverArt src={playlist.coverImgUrl} alt={playlist.name} seed={playlist.id + index} className="music-playlist-cover" note="♫" />
              <div className="music-playlist-play-count">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="#fff"><path d="M8 5v14l11-7z" /></svg>
                {formatPlayCount((playlist.playCount || playlist.trackCount * 16000))}
              </div>
              <div className="music-playlist-name">{playlist.name}</div>
            </div>
          ))}
        </div>
      ) : null}
    </SectionBlock>

    <SectionBlock
      title={previewPlaylist ? `${previewPlaylist.name} 速览` : '歌单速览'}
      subtitle={previewPlaylist ? '点一首直接进入真实播放' : '点上方歌单后，这里会加载真实歌曲'}
    >
      {previewLoading ? (
        <div className="music-state-card">
          <div className="music-inline-spinner" />
          <div className="music-state-text">正在拉取歌单歌曲...</div>
        </div>
      ) : null}

      {!previewLoading && previewError ? (
        <div className="music-state-card">
          <div className="music-state-title">歌单预览失败</div>
          <div className="music-state-text">{previewError}</div>
        </div>
      ) : null}

      {!previewLoading && !previewError && previewTracks.length > 0 ? (
        <div style={{ padding: '0 16px' }}>
          <ul className="music-song-list">
            {previewTracks.map((song) => (
              <PlayableRow
                key={song.id}
                playable={song}
                currentPlayable={currentPlayable}
                onClick={(targetSong) => onSongClick(targetSong as NeteaseSong, previewTracks)}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </SectionBlock>

    <div style={{ height: 108 }} />
  </div>
);

const SearchPage = ({
  keyword,
  activeTab,
  isSearching,
  searchBundle,
  searchSections,
  searchHistory,
  suggestions,
  currentPlayable,
  onKeywordChange,
  onTabChange,
  onBack,
  onSubmit,
  onClearKeyword,
  onClearHistory,
  onHistoryClick,
  onSongClick,
  onOpenPlaylist,
  onOpenAlbum,
  onOpenArtist,
  onOpenRadio,
  onOpenProgram,
}: {
  keyword: string;
  activeTab: MusicSearchTab;
  isSearching: boolean;
  searchBundle: MusicSearchBundle;
  searchSections: Partial<Record<SearchableMusicTab, MusicSearchSection>>;
  searchHistory: string[];
  suggestions: string[];
  currentPlayable: MusicPlayable | null;
  onKeywordChange: (value: string) => void;
  onTabChange: (tab: MusicSearchTab) => void;
  onBack: () => void;
  onSubmit: () => void;
  onClearKeyword: () => void;
  onClearHistory: () => void;
  onHistoryClick: (term: string) => void;
  onSongClick: (song: NeteaseSong, queue?: NeteaseSong[]) => void;
  onOpenPlaylist: (playlist: NeteasePlaylist) => void;
  onOpenAlbum: (album: NeteaseAlbumSummary) => void;
  onOpenArtist: (artist: NeteaseArtistSummary) => void;
  onOpenRadio: (radio: NeteaseDjRadio) => void;
  onOpenProgram: (program: NeteaseDjProgram) => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmedKeyword = keyword.trim();

  useEffect(() => {
    const timeoutId = window.setTimeout(() => inputRef.current?.focus(), 180);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const renderItem = (item: MusicSearchItem, section: MusicSearchSection) => {
    if (item.kind === 'song') {
      const queue = section.items.filter((entry): entry is NeteaseSong => entry.kind === 'song');
      return (
        <PlayableRow
          key={`song-${item.id}`}
          playable={item}
          currentPlayable={currentPlayable}
          onClick={(song) => onSongClick(song as NeteaseSong, queue)}
        />
      );
    }

    if (item.kind === 'program') {
      return (
        <PlayableRow
          key={`program-${item.id}`}
          playable={item}
          currentPlayable={currentPlayable}
          onClick={() => onOpenProgram(item)}
        />
      );
    }

    if (item.kind === 'playlist') {
      return <EntityRow key={`playlist-${item.id}`} item={item} onClick={() => onOpenPlaylist(item)} />;
    }
    if (item.kind === 'album') {
      return <EntityRow key={`album-${item.id}`} item={item} onClick={() => onOpenAlbum(item)} />;
    }
    if (item.kind === 'artist') {
      return <EntityRow key={`artist-${item.id}`} item={item} onClick={() => onOpenArtist(item)} />;
    }
    return <EntityRow key={`radio-${item.id}`} item={item} onClick={() => onOpenRadio(item)} />;
  };

  const renderSection = (section: MusicSearchSection, showAction: boolean) => {
    if (section.error) {
      return (
        <div key={section.tab} className="music-state-card">
          <div className="music-state-title">{section.title}加载失败</div>
          <div className="music-state-text">{section.error}</div>
        </div>
      );
    }

    if (section.items.length === 0) {
      return activeTab === 'all' ? null : (
        <div key={section.tab} className="music-state-card music-empty-state">
          <div className="music-state-title">还没有结果</div>
          <div className="music-state-text">{getSectionEmptyText(section.tab)}</div>
        </div>
      );
    }

    return (
      <SectionBlock
        key={section.tab}
        title={section.title}
        subtitle={section.total > 0 ? `找到 ${section.total} 条结果` : undefined}
        action={showAction ? (
          <button type="button" className="music-text-button" onClick={() => onTabChange(section.tab)}>
            查看全部
          </button>
        ) : undefined}
      >
        <div style={{ padding: '0 16px' }}>
          <ul className="music-song-list">
            {section.items.map((item) => renderItem(item, section))}
          </ul>
        </div>
      </SectionBlock>
    );
  };

  const activeSection = activeTab === 'all' ? null : searchSections[activeTab];
  const hasAllResults = searchBundle.sections.some((section) => section.items.length > 0 || section.error);

  return (
    <>
      <div className="music-search-bar">
        <div className="music-navbar-back" onClick={onBack}><IconBack /></div>
        <div className="music-search-input-wrapper">
          <IconSearch />
          <input
            ref={inputRef}
            className="music-search-input"
            placeholder="搜索单曲、歌单、专辑、歌手、播客台、声音"
            value={keyword}
            onChange={(event) => onKeywordChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') onSubmit(); }}
          />
          {keyword ? <div onClick={onClearKeyword} style={{ cursor: 'pointer' }}><IconClear /></div> : null}
        </div>
        <div className="music-search-cancel" onClick={trimmedKeyword ? onSubmit : onBack}>{trimmedKeyword ? '搜索' : '取消'}</div>
      </div>

      <div className="music-search-page music-no-scrollbar">
        {trimmedKeyword ? (
          <div className="music-search-tabs">
            {MUSIC_SEARCH_TABS.map((tab) => (
              <div
                key={tab}
                className={`music-search-tab ${activeTab === tab ? 'active' : ''}`}
                onClick={() => onTabChange(tab)}
              >
                {MUSIC_SEARCH_TAB_LABELS[tab]}
              </div>
            ))}
          </div>
        ) : null}

        {isSearching ? (
          <div className="music-loading-block">
            <div className="music-inline-spinner" />
            <div className="music-state-text">正在搜索“{trimmedKeyword}”...</div>
          </div>
        ) : null}

        {!isSearching && trimmedKeyword && activeTab === 'all' ? (
          hasAllResults ? (
            <>
              {searchBundle.sections.map((section) => renderSection(section, true))}
            </>
          ) : (
            <div className="music-state-card music-empty-state">
              <div className="music-state-title">没有找到匹配内容</div>
              <div className="music-state-text">试试更短的关键词，或者换歌手名 / 歌单名 / 播客名重新搜一下。</div>
            </div>
          )
        ) : null}

        {!isSearching && trimmedKeyword && activeTab !== 'all' ? (
          activeSection ? (
            renderSection(activeSection, false)
          ) : (
            <div className="music-state-card music-empty-state">
              <div className="music-state-title">正在准备结果</div>
              <div className="music-state-text">这一栏的数据还没回来，稍后会自动刷新。</div>
            </div>
          )
        ) : null}

        {!trimmedKeyword ? (
          <>
            <div className="music-search-history">
              <div className="music-search-history-header">
                <div className="music-search-history-title">最近搜索</div>
                {searchHistory.length > 0 ? <button type="button" className="music-text-button" onClick={onClearHistory}>清空</button> : null}
              </div>
              {searchHistory.length > 0 ? (
                <div className="music-search-history-tags">
                  {searchHistory.map((term) => (
                    <div key={term} className="music-search-history-tag" onClick={() => onHistoryClick(term)}>{term}</div>
                  ))}
                </div>
              ) : (
                <div className="music-state-text">还没有搜索记录，直接搜一首歌、一个歌单或一档播客吧。</div>
              )}
            </div>

            <div className="music-hot-section">
              <div className="music-hot-title">推荐搜索</div>
              <ul className="music-hot-list">
                {suggestions.map((name, index) => (
                  <li key={name} className="music-hot-item" onClick={() => onHistoryClick(name)}>
                    <span className={`music-hot-rank ${index < 3 ? `top-${index + 1}` : ''}`}>{index + 1}</span>
                    <span className="music-hot-name">{name}</span>
                    {index === 0 ? <span className="music-hot-badge">荐</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}

        <div style={{ height: 80 }} />
      </div>
    </>
  );
};

const PlaylistDetailPage = ({
  state,
  seed,
  currentPlayable,
  onBack,
  onSongClick,
}: {
  state?: Loadable<NeteasePlaylist>;
  seed?: NeteasePlaylist;
  currentPlayable: MusicPlayable | null;
  onBack: () => void;
  onSongClick: (song: NeteaseSong, queue?: NeteaseSong[]) => void;
}) => {
  const playlist = state?.data || seed || null;
  const tracks = playlist?.tracks || [];

  return (
    <DetailShell title="歌单" onBack={onBack}>
      {playlist ? (
        <>
          <HeroCard
            cover={playlist.coverImgUrl}
            seed={playlist.id}
            title={playlist.name}
            subtitle={getPlaylistSubtitle(playlist)}
            description={playlist.description}
            actions={tracks.length > 0 ? (
              <button type="button" className="music-primary-button" style={{ marginTop: 0 }} onClick={() => onSongClick(tracks[0], tracks)}>
                播放全部
              </button>
            ) : undefined}
          />
          <SectionBlock title="歌曲列表" subtitle={tracks.length > 0 ? `${tracks.length} 首歌曲` : '暂无歌曲'}>
            <div style={{ padding: '0 16px' }}>
              <ul className="music-song-list">
                {tracks.map((song) => (
                  <PlayableRow
                    key={song.id}
                    playable={song}
                    currentPlayable={currentPlayable}
                    onClick={(targetSong) => onSongClick(targetSong as NeteaseSong, tracks)}
                  />
                ))}
              </ul>
            </div>
          </SectionBlock>
        </>
      ) : null}

      {state?.loading && !playlist ? (
        <div className="music-loading-block">
          <div className="music-inline-spinner" />
          <div className="music-state-text">正在加载歌单详情...</div>
        </div>
      ) : null}

      {!state?.loading && !playlist ? (
        <div className="music-state-card" style={{ margin: '16px 0' }}>
          <div className="music-state-title">歌单加载失败</div>
          <div className="music-state-text">{state?.error || '暂时无法读取这个歌单。'}</div>
        </div>
      ) : null}
    </DetailShell>
  );
};

const AlbumDetailPage = ({
  state,
  seed,
  currentPlayable,
  onBack,
  onSongClick,
}: {
  state?: Loadable<NeteaseAlbumSummary>;
  seed?: NeteaseAlbumSummary;
  currentPlayable: MusicPlayable | null;
  onBack: () => void;
  onSongClick: (song: NeteaseSong, queue?: NeteaseSong[]) => void;
}) => {
  const album = state?.data || seed || null;
  const songs = album?.songs || [];

  return (
    <DetailShell title="专辑" onBack={onBack}>
      {album ? (
        <>
          <HeroCard
            cover={album.picUrl}
            seed={album.id}
            title={album.name}
            subtitle={getAlbumSubtitle(album)}
            description={album.description}
            actions={songs.length > 0 ? (
              <button type="button" className="music-primary-button" style={{ marginTop: 0 }} onClick={() => onSongClick(songs[0], songs)}>
                播放专辑
              </button>
            ) : undefined}
          />
          <SectionBlock title="曲目" subtitle={songs.length > 0 ? `${songs.length} 首` : '暂无曲目'}>
            <div style={{ padding: '0 16px' }}>
              <ul className="music-song-list">
                {songs.map((song) => (
                  <PlayableRow
                    key={song.id}
                    playable={song}
                    currentPlayable={currentPlayable}
                    onClick={(targetSong) => onSongClick(targetSong as NeteaseSong, songs)}
                  />
                ))}
              </ul>
            </div>
          </SectionBlock>
        </>
      ) : null}

      {state?.loading && !album ? (
        <div className="music-loading-block">
          <div className="music-inline-spinner" />
          <div className="music-state-text">正在加载专辑详情...</div>
        </div>
      ) : null}

      {!state?.loading && !album ? (
        <div className="music-state-card" style={{ margin: '16px 0' }}>
          <div className="music-state-title">专辑加载失败</div>
          <div className="music-state-text">{state?.error || '暂时无法读取这张专辑。'}</div>
        </div>
      ) : null}
    </DetailShell>
  );
};

const ArtistDetailPage = ({
  state,
  seed,
  currentPlayable,
  onBack,
  onSongClick,
  onOpenAlbum,
}: {
  state?: Loadable<ArtistDetailData>;
  seed?: NeteaseArtistSummary;
  currentPlayable: MusicPlayable | null;
  onBack: () => void;
  onSongClick: (song: NeteaseSong, queue?: NeteaseSong[]) => void;
  onOpenAlbum: (album: NeteaseAlbumSummary) => void;
}) => {
  const artist = state?.data?.artist || seed || null;
  const topSongs = state?.data?.topSongs || [];
  const albums = state?.data?.albums || [];
  const description = state?.data?.description || artist?.description || artist?.briefDesc || '';

  return (
    <DetailShell title="歌手" onBack={onBack}>
      {artist ? (
        <>
          <HeroCard
            cover={artist.picUrl || artist.avatarUrl}
            seed={artist.id}
            title={artist.name}
            subtitle={getArtistSubtitle(artist)}
            description={description}
          />
          <SectionBlock title="热门歌曲" subtitle={topSongs.length > 0 ? `${topSongs.length} 首` : '暂无'}>
            <div style={{ padding: '0 16px' }}>
              <ul className="music-song-list">
                {topSongs.map((song) => (
                  <PlayableRow
                    key={song.id}
                    playable={song}
                    currentPlayable={currentPlayable}
                    onClick={(targetSong) => onSongClick(targetSong as NeteaseSong, topSongs)}
                  />
                ))}
              </ul>
            </div>
          </SectionBlock>
          <SectionBlock title="专辑" subtitle={albums.length > 0 ? `${albums.length} 张` : '暂无'}>
            <div style={{ padding: '0 16px' }}>
              <ul className="music-song-list">
                {albums.map((album) => (
                  <EntityRow key={album.id} item={album} onClick={() => onOpenAlbum(album)} />
                ))}
              </ul>
            </div>
          </SectionBlock>
        </>
      ) : null}

      {state?.loading && !artist ? (
        <div className="music-loading-block">
          <div className="music-inline-spinner" />
          <div className="music-state-text">正在加载歌手详情...</div>
        </div>
      ) : null}

      {!state?.loading && !artist ? (
        <div className="music-state-card" style={{ margin: '16px 0' }}>
          <div className="music-state-title">歌手加载失败</div>
          <div className="music-state-text">{state?.error || '暂时无法读取这位歌手的信息。'}</div>
        </div>
      ) : null}
    </DetailShell>
  );
};

const RadioDetailPage = ({
  state,
  seed,
  currentPlayable,
  onBack,
  onProgramClick,
}: {
  state?: Loadable<RadioDetailData>;
  seed?: NeteaseDjRadio;
  currentPlayable: MusicPlayable | null;
  onBack: () => void;
  onProgramClick: (program: NeteaseDjProgram, queue?: NeteaseDjProgram[]) => void;
}) => {
  const radio = state?.data?.radio || seed || null;
  const programs = state?.data?.programs || radio?.programs || [];

  return (
    <DetailShell title="播客台" onBack={onBack}>
      {radio ? (
        <>
          <HeroCard
            cover={radio.picUrl}
            seed={radio.id}
            title={radio.name}
            subtitle={getRadioSubtitle(radio)}
            description={radio.description}
            actions={programs.length > 0 ? (
              <button type="button" className="music-primary-button" style={{ marginTop: 0 }} onClick={() => onProgramClick(programs[0], programs)}>
                播放最新一期
              </button>
            ) : undefined}
          />
          <SectionBlock title="节目列表" subtitle={programs.length > 0 ? `${programs.length} 期` : '暂无'}>
            <div style={{ padding: '0 16px' }}>
              <ul className="music-song-list">
                {programs.map((program) => (
                  <PlayableRow
                    key={program.id}
                    playable={program}
                    currentPlayable={currentPlayable}
                    onClick={(targetProgram) => onProgramClick(targetProgram as NeteaseDjProgram, programs)}
                  />
                ))}
              </ul>
            </div>
          </SectionBlock>
        </>
      ) : null}

      {state?.loading && !radio ? (
        <div className="music-loading-block">
          <div className="music-inline-spinner" />
          <div className="music-state-text">正在加载播客台详情...</div>
        </div>
      ) : null}

      {!state?.loading && !radio ? (
        <div className="music-state-card" style={{ margin: '16px 0' }}>
          <div className="music-state-title">播客台加载失败</div>
          <div className="music-state-text">{state?.error || '暂时无法读取这档播客。'}</div>
        </div>
      ) : null}
    </DetailShell>
  );
};

const ProgramDetailPage = ({
  state,
  seed,
  onBack,
  onPlay,
  onOpenRadio,
}: {
  state?: Loadable<ProgramDetailData>;
  seed?: NeteaseDjProgram;
  onBack: () => void;
  onPlay: (program: NeteaseDjProgram, queue?: NeteaseDjProgram[]) => void;
  onOpenRadio: (radio: NeteaseDjRadio) => void;
}) => {
  const program = state?.data?.program || seed || null;
  const radio = program?.radio || (program?.radioId ? {
    kind: 'radio' as const,
    id: program.radioId,
    name: program.radioName || '播客台',
    picUrl: program.coverUrl || '',
  } : null);

  return (
    <DetailShell title="声音" onBack={onBack}>
      {program ? (
        <>
          <HeroCard
            cover={program.coverUrl || program.radio?.picUrl}
            seed={program.id}
            title={program.name}
            subtitle={getProgramSubtitle(program)}
            description={program.description}
            actions={(
              <>
                <button type="button" className="music-primary-button" style={{ marginTop: 0 }} onClick={() => onPlay(program)}>
                  立即播放
                </button>
                {radio ? (
                  <button type="button" className="music-secondary-button" onClick={() => onOpenRadio(radio)}>
                    进入播客台
                  </button>
                ) : null}
              </>
            )}
          />
          <div className="music-state-card" style={{ margin: '16px 0' }}>
            <div className="music-state-title">节目说明</div>
            <div className="music-state-text">
              {program.description || '这期节目没有额外简介，可以直接播放收听。'}
            </div>
          </div>
        </>
      ) : null}

      {state?.loading && !program ? (
        <div className="music-loading-block">
          <div className="music-inline-spinner" />
          <div className="music-state-text">正在加载声音详情...</div>
        </div>
      ) : null}

      {!state?.loading && !program ? (
        <div className="music-state-card" style={{ margin: '16px 0' }}>
          <div className="music-state-title">声音加载失败</div>
          <div className="music-state-text">{state?.error || '暂时无法读取这期节目。'}</div>
        </div>
      ) : null}
    </DetailShell>
  );
};

const ProfilePage = ({
  account,
  isLoading,
  error,
  isLoggedIn,
  onOpenLogin,
  onLogout,
  onSearch,
}: {
  account: NeteaseUserAccount | null;
  isLoading: boolean;
  error: string | null;
  isLoggedIn: boolean;
  onOpenLogin: () => void;
  onLogout: () => void;
  onSearch: () => void;
}) => {
  const backgroundStyle = account?.backgroundUrl ? {
    backgroundImage: `linear-gradient(to bottom, rgba(22,22,24,0.15), rgba(250,250,250,1)), url(${account.backgroundUrl})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  } : undefined;

  return (
    <div className="music-profile-page music-no-scrollbar">
      <div className="music-profile-header">
        <div className="music-profile-bg" style={backgroundStyle} />
        <div className="music-profile-toolbar">
          <button type="button" className="music-icon-button" onClick={onSearch}><IconSearch /></button>
          {isLoggedIn ? <button type="button" className="music-text-button music-text-button-danger" onClick={onLogout}>退出登录</button> : null}
        </div>

        {isLoading ? (
          <div className="music-profile-loading">
            <div className="music-inline-spinner" />
            <div className="music-state-text">正在同步 {MUSIC_APP_NAME} 账号...</div>
          </div>
        ) : isLoggedIn && account ? (
          <>
            <CoverArt src={account.avatarUrl} alt={account.nickname} seed={account.userId} className="music-profile-avatar" />
            <div className="music-profile-name">
              {account.nickname}
              {account.isVip ? <span className="music-vip-badge">{getVipLabel(account)}</span> : null}
            </div>
            <div className="music-profile-stats">
              <div className="music-profile-stat"><span className="music-profile-stat-num">{account.follows}</span>关注</div>
              <div className="music-profile-stat"><span className="music-profile-stat-num">{account.followeds}</span>粉丝</div>
              <div className="music-profile-stat"><span className="music-profile-stat-num">{account.listenSongs}</span>累计听歌</div>
            </div>
            <div className="music-profile-tools">
              <div className="music-profile-tool"><span>账号</span><strong>{account.userId}</strong></div>
              <div className="music-profile-tool"><span>动态</span><strong>{account.eventCount}</strong></div>
              <div className="music-profile-tool"><span>状态</span><strong>{account.isVip ? 'VIP' : '普通'}</strong></div>
            </div>
            <div className="music-profile-summary-card">
              <div className="music-state-title">{MUSIC_APP_NAME} 已连接</div>
              <div className="music-state-text">现在搜索、详情和播放都走真实接口了，单曲和声音会按实体类型走不同的播放链路。</div>
            </div>
          </>
        ) : isLoggedIn ? (
          <div className="music-login-card">
            <div className="music-login-card-title">{error ? '账号已授权，但资料还没同步成功' : '账号已授权，正在准备资料'}</div>
            <div className="music-login-card-text">
              {error
                ? '这通常是登录态不完整或刚授权后的同步失败。重新扫码一次就能刷新完整 cookie。'
                : '昵称、头像和 VIP 状态正在同步，通常几秒内就会刷新出来。'}
            </div>
            <button type="button" className="music-primary-button" onClick={onOpenLogin}>{error ? '重新扫码登录' : '重新打开二维码'}</button>
          </div>
        ) : (
          <div className="music-login-card">
            <div className="music-login-card-title">登录 {MUSIC_APP_NAME}</div>
            <div className="music-login-card-text">扫码后可以读取真实昵称、头像和 VIP 状态，并为需要登录态的歌曲和播客拿到更稳定的播放链接。</div>
            <button type="button" className="music-primary-button" onClick={onOpenLogin}>打开二维码登录</button>
          </div>
        )}
      </div>

      {error ? (
        <div className="music-state-card" style={{ margin: '0 16px 16px' }}>
          <div className="music-state-title">账号同步失败</div>
          <div className="music-state-text">{error}</div>
          <button type="button" className="music-secondary-button" onClick={onOpenLogin}>重新登录</button>
        </div>
      ) : null}

      {!isLoggedIn && !isLoading ? (
        <div className="music-profile-empty-stack">
          <div className="music-state-card">
            <div className="music-state-title">为什么需要登录？</div>
            <div className="music-state-text">部分歌曲和声音的播放链接依赖登录 cookie。登录后，播放器会优先走你的账号权限拿真实音频地址。</div>
          </div>
          <div className="music-state-card">
            <div className="music-state-title">登录后会有什么变化</div>
            <div className="music-state-text">昵称、头像、VIP 状态和累计听歌数都会替换掉当前页面里的占位信息，播放成功率也会更高。</div>
          </div>
        </div>
      ) : null}

      <div style={{ height: 112 }} />
    </div>
  );
};

const QrLoginModal = ({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) => {
  const [status, setStatus] = useState<QrModalStatus>('idle');
  const [statusText, setStatusText] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [retryToken, setRetryToken] = useState(0);
  const [imageIndex, setImageIndex] = useState(0);
  const pollTimerRef = useRef<number | null>(null);

  const qrImageCandidates = useMemo(() => qrUrl ? buildQrImageCandidates(qrUrl) : [], [qrUrl]);
  const qrImageSrc = qrImageCandidates[imageIndex] || '';
  const requiresOfficialVerification = statusText.includes('验证');

  useEffect(() => {
    if (!open) {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setStatus('idle');
      setStatusText('');
      setQrUrl('');
      setImageIndex(0);
      return;
    }

    let active = true;

    const clearPollTimer = () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const pollStatus = async (key: string) => {
      try {
        const result = await checkQrStatus(key);
        if (!active) return;

        if (result.code === 801) {
          setStatus('waiting');
          setStatusText(`请使用${MUSIC_SCAN_APP_NAME}扫码。`);
          return;
        }
        if (result.code === 802) {
          setStatus('scanned');
          setStatusText('已扫码，请在手机上确认登录。');
          return;
        }
        if (result.code === 803) {
          clearPollTimer();
          if (!result.cookie) {
            setStatus('error');
            setStatusText('登录成功，但没有取到 cookie，请重新生成二维码。');
            return;
          }

          setStatus('success');
          setStatusText('登录成功，正在刷新“我的”页面...');
          setMusicCookie(result.cookie);
          onSuccess();
          window.setTimeout(() => {
            if (active) onClose();
          }, 500);
          return;
        }
        if (result.code === 800) {
          clearPollTimer();
          setStatus('expired');
          setStatusText('二维码已过期，请重新生成。');
          return;
        }

        setStatus('waiting');
        setStatusText(
          result.message
            ? `${result.message}${result.code > 0 ? `（状态码 ${result.code}）` : ''}`
            : '等待扫码中...',
        );
      } catch (error) {
        clearPollTimer();
        if (!active) return;
        setStatus('error');
        setStatusText(error instanceof Error ? error.message : '二维码状态检查失败');
      }
    };

    const initQr = async () => {
      setStatus('loading');
      setStatusText('正在生成二维码...');
      setQrUrl('');
      setImageIndex(0);

      try {
        const qrKey = await getQrKey();
        if (!active || !qrKey) throw new Error('没有获取到二维码 key');
        const nextQrUrl = await getQrUrl(qrKey);
        if (!active || !nextQrUrl) throw new Error('二维码内容生成失败');

        setQrUrl(nextQrUrl);
        setStatus('waiting');
        setStatusText(`请使用${MUSIC_SCAN_APP_NAME}扫码。`);
        await pollStatus(qrKey);
        if (!active) return;
        pollTimerRef.current = window.setInterval(() => { void pollStatus(qrKey); }, 2000);
      } catch (error) {
        if (!active) return;
        setStatus('error');
        setStatusText(error instanceof Error ? error.message : '二维码生成失败');
      }
    };

    void initQr();

    return () => {
      active = false;
      clearPollTimer();
    };
  }, [onClose, onSuccess, open, retryToken]);

  if (!open) return null;

  return (
    <div className="music-modal-backdrop" onClick={onClose}>
      <div className="music-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="music-modal-header">
          <div>
            <div className="music-modal-title">扫码登录 {MUSIC_APP_NAME}</div>
            <div className="music-modal-subtitle">使用手机 App 扫码后，这台设备会同步你的登录态</div>
          </div>
          <button type="button" className="music-icon-button" onClick={onClose}>×</button>
        </div>

        <div className="music-qr-stage">
          {status === 'loading' ? (
            <div className="music-qr-placeholder"><div className="music-inline-spinner" /></div>
          ) : qrImageSrc ? (
            <div className="music-qr-box">
              <img
                src={qrImageSrc}
                alt={`${MUSIC_APP_NAME} 二维码登录`}
                className="music-qr-image"
                onError={() => setImageIndex((current) => (current < qrImageCandidates.length - 1 ? current + 1 : current))}
              />
            </div>
          ) : (
            <div className="music-qr-placeholder">二维码暂不可用</div>
          )}
        </div>

        <div className={`music-qr-status music-qr-status-${status}`}>{statusText}</div>

        {requiresOfficialVerification ? (
          <div className="music-state-card" style={{ margin: '0 0 16px', padding: '14px 16px' }}>
            <div className="music-state-title">这一步需要网页验证</div>
            <div className="music-state-text">先在网页登录页完成一次验证，再回来重新扫码，通常就能进入成功回调。</div>
            <button
              type="button"
              className="music-secondary-button"
              onClick={() => window.open('https://music.163.com/#/login', '_blank', 'noopener,noreferrer')}
            >
              打开{MUSIC_WEB_LOGIN_NAME}
            </button>
          </div>
        ) : null}

        <div className="music-qr-actions">
          <button type="button" className="music-secondary-button" onClick={() => setRetryToken((value) => value + 1)}>重新生成</button>
          <button
            type="button"
            className="music-secondary-button"
            onClick={() => {
              if (!qrUrl || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
              void navigator.clipboard.writeText(qrUrl).then(
                () => setStatusText('二维码链接已复制，可用其他设备生成后扫码。'),
                () => setStatusText('复制失败，请稍后再试。'),
              );
            }}
            disabled={!qrUrl}
          >
            复制链接
          </button>
        </div>
      </div>
    </div>
  );
};

const FullPlayer = ({
  playable,
  isPlaying,
  progress,
  currentTime,
  duration,
  onClose,
  onTogglePlay,
  onPrev,
  onNext,
  onSeek,
}: {
  playable: MusicPlayable;
  isPlaying: boolean;
  progress: number;
  currentTime: number;
  duration: number;
  onClose: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (pct: number) => void;
}) => {
  const progressBarRef = useRef<HTMLDivElement>(null);
  const cover = getPlayableCover(playable);
  const backgroundStyle = cover ? { backgroundImage: `url(${cover})` } : { background: getFallbackGradient(playable.id) };
  const displayDuration = duration > 0 ? duration : playable.duration / 1000;

  return (
    <div className="music-player-page">
      <div className="music-player-bg" style={backgroundStyle} />
      <div className="music-player-overlay" />
      <div className="music-player-content">
        <div className="music-player-header">
          <div style={{ cursor: 'pointer', padding: 4 }} onClick={onClose}><IconDown /></div>
          <div className="music-player-tabs">
            <div className={`music-player-tab ${isSongPlayable(playable) ? 'active' : ''}`}>音乐</div>
            <div className={`music-player-tab ${!isSongPlayable(playable) ? 'active' : ''}`}>播客</div>
          </div>
          <div style={{ width: 24, cursor: 'pointer' }}><IconSearch /></div>
        </div>

        <div className="music-player-vinyl-area">
          <div className={`music-player-tonearm ${isPlaying ? 'playing' : 'paused'}`}>
            <div className="music-player-tonearm-pivot" />
            <div className="music-player-tonearm-arm" />
            <div className="music-player-tonearm-head" />
          </div>
          <div className={`music-player-vinyl ${isPlaying ? '' : 'paused'}`}>
            <div className="music-vinyl-groove" />
            <div className="music-vinyl-groove" />
            <div className="music-vinyl-groove" />
            <div className="music-vinyl-groove" />
            <CoverArt src={cover} alt={playable.name} seed={playable.id} className="music-vinyl-center" note={isSongPlayable(playable) ? '♪' : '播'} />
          </div>
        </div>

        <div className="music-player-song-info">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="music-player-song-name">{playable.name}</div>
              <div className="music-player-song-artist">
                {getPlayableSubtitle(playable)}
                <span className="music-player-quality-badge">{isSongPlayable(playable) ? '单曲' : '声音'}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, flexShrink: 0 }}>
              <div style={{ color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}><IconHeart /></div>
              <div style={{ color: 'rgba(255,255,255,0.6)', cursor: 'pointer' }}><IconMore /></div>
            </div>
          </div>
        </div>

        <div className="music-player-progress">
          <div
            ref={progressBarRef}
            className="music-player-progress-bar"
            onClick={(event) => {
              const rect = progressBarRef.current?.getBoundingClientRect();
              if (!rect) return;
              const pct = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
              onSeek(pct);
            }}
          >
            <div className="music-player-progress-fill" style={{ width: `${progress}%` }}>
              <div className="music-player-progress-dot" />
            </div>
          </div>
          <div className="music-player-time">
            <span>{formatSeconds(currentTime)}</span>
            <span>{formatSeconds(displayDuration)}</span>
          </div>
        </div>

        <div className="music-player-controls">
          <div className="music-ctrl-btn" onClick={onPrev}><IconPrev /></div>
          <div className="music-ctrl-play" onClick={onTogglePlay}>{isPlaying ? <IconPause /> : <IconPlay />}</div>
          <div className="music-ctrl-btn" onClick={onNext}><IconNext /></div>
        </div>
      </div>
    </div>
  );
};

const MiniPlayer = ({
  playable,
  isPlaying,
  progress,
  onOpen,
  onTogglePlay,
}: {
  playable: MusicPlayable | null;
  isPlaying: boolean;
  progress: number;
  onOpen: () => void;
  onTogglePlay: (event: React.MouseEvent) => void;
}) => {
  if (!playable) return null;

  return (
    <div className="music-mini-player" onClick={onOpen}>
      <CoverArt
        src={getPlayableCover(playable)}
        alt={playable.name}
        seed={playable.id}
        className={`music-mini-cover ${isPlaying ? '' : 'paused'}`}
        note={isSongPlayable(playable) ? '♪' : '播'}
      />
      <div className="music-mini-info">
        <div className="music-mini-title">{playable.name} · {getPlayableSubtitle(playable)}</div>
        <div className="music-mini-progress-track"><div className="music-mini-progress-fill" style={{ width: `${progress}%` }} /></div>
      </div>
      <div className="music-mini-controls">
        <div className="music-mini-btn" onClick={onTogglePlay}>{isPlaying ? <IconMiniPause /> : <IconMiniPlay />}</div>
        <div className="music-mini-btn"><IconPlaylist /></div>
      </div>
    </div>
  );
};

export default function MusicApp() {
  const { registerBackHandler } = useApp();
  const { currentSong, isPlaying, currentTime, duration, progress, playSong, togglePlay, playNext, playPrev, seek } = useAudioPlayer();

  const [rootPage, setRootPage] = useState<RootPage>('discover');
  const [lastPrimaryPage, setLastPrimaryPage] = useState<PrimaryPage>('discover');
  const [detailStack, setDetailStack] = useState<DetailView[]>([]);
  const [showFullPlayer, setShowFullPlayer] = useState(false);
  const [showQrLogin, setShowQrLogin] = useState(false);

  const [isLoggedIn, setIsLoggedIn] = useState(() => isMusicLoggedIn());
  const [account, setAccount] = useState<NeteaseUserAccount | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountReloadKey, setAccountReloadKey] = useState(0);

  const [playlists, setPlaylists] = useState<NeteasePlaylist[]>([]);
  const [playlistsLoading, setPlaylistsLoading] = useState(true);
  const [playlistsError, setPlaylistsError] = useState<string | null>(null);
  const [playlistPreview, setPlaylistPreview] = useState<PlaylistPreviewState>({
    playlist: null,
    tracks: [],
    loading: false,
    error: null,
  });

  const [keyword, setKeyword] = useState('');
  const [searchHistory, setSearchHistory] = useState<string[]>(() => readSearchHistory());
  const [activeSearchTab, setActiveSearchTab] = useState<MusicSearchTab>('all');
  const [isSearching, setIsSearching] = useState(false);
  const [searchBundle, setSearchBundle] = useState<MusicSearchBundle>({ keyword: '', sections: [] });
  const [searchSections, setSearchSections] = useState<Partial<Record<SearchableMusicTab, MusicSearchSection>>>({});
  const searchRequestIdRef = useRef(0);

  const [playlistDetails, setPlaylistDetails] = useState<Record<number, Loadable<NeteasePlaylist>>>({});
  const [albumDetails, setAlbumDetails] = useState<Record<number, Loadable<NeteaseAlbumSummary>>>({});
  const [artistDetails, setArtistDetails] = useState<Record<number, Loadable<ArtistDetailData>>>({});
  const [radioDetails, setRadioDetails] = useState<Record<number, Loadable<RadioDetailData>>>({});
  const [programDetails, setProgramDetails] = useState<Record<number, Loadable<ProgramDetailData>>>({});

  const activeDetail = detailStack.length > 0 ? detailStack[detailStack.length - 1] : null;

  function commitSearchHistory(term: string): void {
    const trimmed = term.trim();
    if (!trimmed) return;

    setSearchHistory((previous) => {
      const next = [trimmed, ...previous.filter((item) => item !== trimmed)].slice(0, 8);
      writeSearchHistory(next);
      return next;
    });
  }

  function clearSearchHistory(): void {
    setSearchHistory([]);
    writeSearchHistory([]);
  }

  async function executeSearch(term: string, tab: MusicSearchTab, commitHistoryNow = false): Promise<void> {
    const trimmed = term.trim();
    const requestId = ++searchRequestIdRef.current;

    if (!trimmed) {
      setIsSearching(false);
      setSearchBundle({ keyword: '', sections: [] });
      setSearchSections({});
      return;
    }

    if (commitHistoryNow) {
      commitSearchHistory(trimmed);
    }

    setIsSearching(true);

    try {
      if (tab === 'all') {
        const bundle = await searchMusicAll(trimmed);
        if (requestId !== searchRequestIdRef.current) return;

        setSearchBundle(bundle);
        setSearchSections((previous) => {
          const next = { ...previous };
          bundle.sections.forEach((section) => {
            if (section.tab !== 'all') {
              next[section.tab] = section;
            }
          });
          return next;
        });
      } else {
        const section = await searchMusicByType(trimmed, tab, 30, 0);
        if (requestId !== searchRequestIdRef.current) return;

        setSearchSections((previous) => ({
          ...previous,
          [tab]: section,
        }));
      }
    } catch (error) {
      if (requestId !== searchRequestIdRef.current) return;

      const message = error instanceof Error ? error.message : '搜索失败，请稍后重试';
      if (tab === 'all') {
        setSearchBundle({
          keyword: trimmed,
          sections: (['song', 'playlist', 'album', 'artist', 'radio', 'program'] as SearchableMusicTab[]).map((sectionTab) => ({
            tab: sectionTab,
            title: MUSIC_SEARCH_TAB_LABELS[sectionTab],
            items: [],
            total: 0,
            error: message,
          })),
        });
      } else {
        setSearchSections((previous) => ({
          ...previous,
          [tab]: {
            tab,
            title: MUSIC_SEARCH_TAB_LABELS[tab],
            items: [],
            total: 0,
            error: message,
          },
        }));
      }
    } finally {
      if (requestId === searchRequestIdRef.current) {
        setIsSearching(false);
      }
    }
  }

  function pushDetail(detail: DetailView): void {
    setDetailStack((previous) => [...previous, detail]);
  }

  function popDetail(): void {
    setDetailStack((previous) => previous.slice(0, -1));
  }

  function openSearch(): void {
    setLastPrimaryPage(rootPage === 'profile' ? 'profile' : 'discover');
    setRootPage('search');
  }

  function closeSearch(): void {
    setDetailStack([]);
    setRootPage(lastPrimaryPage);
  }

  function selectPrimaryPage(page: PrimaryPage): void {
    setLastPrimaryPage(page);
    setDetailStack([]);
    setRootPage(page);
  }

  function handlePlayableClick(playable: MusicPlayable, queue?: MusicPlayable[]): void {
    void playSong(playable, queue);
    setShowFullPlayer(true);
  }

  function handleSongClick(song: NeteaseSong, queue?: NeteaseSong[]): void {
    handlePlayableClick(song, queue);
  }

  function handleProgramClick(program: NeteaseDjProgram, queue?: NeteaseDjProgram[]): void {
    handlePlayableClick(program, queue);
  }

  async function loadPlaylistPreview(playlist: NeteasePlaylist): Promise<void> {
    setPlaylistPreview({ playlist, tracks: [], loading: true, error: null });

    try {
      const detail = await getPlaylistDetail(playlist.id);
      const tracks = detail?.tracks?.slice(0, 12) || [];
      setPlaylistPreview({
        playlist: detail || playlist,
        tracks,
        loading: false,
        error: tracks.length > 0 ? null : '这个歌单暂时没有可预览的歌曲。',
      });
    } catch (error) {
      setPlaylistPreview({
        playlist,
        tracks: [],
        loading: false,
        error: error instanceof Error ? error.message : '歌单详情获取失败',
      });
    }
  }

  async function loadPlaylistDetail(id: number): Promise<void> {
    setPlaylistDetails((previous) => ({
      ...previous,
      [id]: {
        data: previous[id]?.data ?? null,
        loading: true,
        error: null,
      },
    }));

    try {
      const detail = await getPlaylistDetail(id);
      setPlaylistDetails((previous) => ({
        ...previous,
        [id]: {
          data: detail,
          loading: false,
          error: detail ? null : '暂时无法读取这个歌单。',
        },
      }));
    } catch (error) {
      setPlaylistDetails((previous) => ({
        ...previous,
        [id]: {
          data: previous[id]?.data ?? null,
          loading: false,
          error: error instanceof Error ? error.message : '歌单详情获取失败',
        },
      }));
    }
  }

  async function loadAlbumDetail(id: number): Promise<void> {
    setAlbumDetails((previous) => ({
      ...previous,
      [id]: {
        data: previous[id]?.data ?? null,
        loading: true,
        error: null,
      },
    }));

    try {
      const detail = await getAlbumDetail(id);
      setAlbumDetails((previous) => ({
        ...previous,
        [id]: {
          data: detail,
          loading: false,
          error: detail ? null : '暂时无法读取这张专辑。',
        },
      }));
    } catch (error) {
      setAlbumDetails((previous) => ({
        ...previous,
        [id]: {
          data: previous[id]?.data ?? null,
          loading: false,
          error: error instanceof Error ? error.message : '专辑详情获取失败',
        },
      }));
    }
  }

  async function loadArtistDetail(id: number): Promise<void> {
    setArtistDetails((previous) => ({
      ...previous,
      [id]: {
        data: previous[id]?.data ?? null,
        loading: true,
        error: null,
      },
    }));

    try {
      const [artist, topSongs, albums, desc] = await Promise.all([
        getArtistDetail(id),
        getArtistTopSongs(id),
        getArtistAlbums(id, 30, 0),
        getArtistDesc(id).catch(() => ''),
      ]);

      const data = artist ? {
        artist,
        topSongs,
        albums,
        description: desc || artist.description || artist.briefDesc || '',
      } : null;

      setArtistDetails((previous) => ({
        ...previous,
        [id]: {
          data,
          loading: false,
          error: data ? null : '暂时无法读取这位歌手的信息。',
        },
      }));
    } catch (error) {
      setArtistDetails((previous) => ({
        ...previous,
        [id]: {
          data: previous[id]?.data ?? null,
          loading: false,
          error: error instanceof Error ? error.message : '歌手详情获取失败',
        },
      }));
    }
  }

  async function loadRadioDetail(id: number): Promise<void> {
    setRadioDetails((previous) => ({
      ...previous,
      [id]: {
        data: previous[id]?.data ?? null,
        loading: true,
        error: null,
      },
    }));

    try {
      const [radio, programs] = await Promise.all([
        getDjRadioDetail(id),
        getDjPrograms(id, 30, 0, false),
      ]);

      const data = radio ? { radio, programs } : null;
      setRadioDetails((previous) => ({
        ...previous,
        [id]: {
          data,
          loading: false,
          error: data ? null : '暂时无法读取这档播客。',
        },
      }));
    } catch (error) {
      setRadioDetails((previous) => ({
        ...previous,
        [id]: {
          data: previous[id]?.data ?? null,
          loading: false,
          error: error instanceof Error ? error.message : '播客台详情获取失败',
        },
      }));
    }
  }

  async function loadProgramDetail(id: number): Promise<void> {
    setProgramDetails((previous) => ({
      ...previous,
      [id]: {
        data: previous[id]?.data ?? null,
        loading: true,
        error: null,
      },
    }));

    try {
      const program = await getDjProgramDetail(id);
      setProgramDetails((previous) => ({
        ...previous,
        [id]: {
          data: program ? { program } : null,
          loading: false,
          error: program ? null : '暂时无法读取这期节目。',
        },
      }));
    } catch (error) {
      setProgramDetails((previous) => ({
        ...previous,
        [id]: {
          data: previous[id]?.data ?? null,
          loading: false,
          error: error instanceof Error ? error.message : '声音详情获取失败',
        },
      }));
    }
  }

  function openPlaylistDetail(playlist: NeteasePlaylist): void {
    pushDetail({ type: 'playlistDetail', id: playlist.id, seed: playlist });
    if (!playlistDetails[playlist.id]?.data && !playlistDetails[playlist.id]?.loading) {
      void loadPlaylistDetail(playlist.id);
    }
  }

  function openAlbumDetail(album: NeteaseAlbumSummary): void {
    pushDetail({ type: 'albumDetail', id: album.id, seed: album });
    if (!albumDetails[album.id]?.data && !albumDetails[album.id]?.loading) {
      void loadAlbumDetail(album.id);
    }
  }

  function openArtistDetail(artist: NeteaseArtistSummary): void {
    pushDetail({ type: 'artistDetail', id: artist.id, seed: artist });
    if (!artistDetails[artist.id]?.data && !artistDetails[artist.id]?.loading) {
      void loadArtistDetail(artist.id);
    }
  }

  function openRadioDetail(radio: NeteaseDjRadio): void {
    pushDetail({ type: 'radioDetail', id: radio.id, seed: radio });
    if (!radioDetails[radio.id]?.data && !radioDetails[radio.id]?.loading) {
      void loadRadioDetail(radio.id);
    }
  }

  function openProgramDetail(program: NeteaseDjProgram): void {
    pushDetail({ type: 'programDetail', id: program.id, seed: program });
    if (!programDetails[program.id]?.data && !programDetails[program.id]?.loading) {
      void loadProgramDetail(program.id);
    }
  }

  useEffect(() => {
    let active = true;

    const loadPlaylists = async () => {
      setPlaylistsLoading(true);
      setPlaylistsError(null);

      try {
        const nextPlaylists = await getTopPlaylists('全部', 6);
        if (!active) return;
        setPlaylists(nextPlaylists);
      } catch (error) {
        if (!active) return;
        setPlaylists([]);
        setPlaylistsError(error instanceof Error ? error.message : '推荐歌单加载失败');
      } finally {
        if (active) {
          setPlaylistsLoading(false);
        }
      }
    };

    void loadPlaylists();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (playlists.length === 0 || playlistPreview.playlist) return;
    void loadPlaylistPreview(playlists[0]);
  }, [playlists, playlistPreview.playlist]);

  useEffect(() => {
    if (!isLoggedIn) {
      setAccount(null);
      setAccountLoading(false);
      setAccountError(null);
      return;
    }

    if (rootPage !== 'profile' && accountReloadKey === 0) return;

    let active = true;
    setAccountLoading(true);
    setAccountError(null);

    const loadAccount = async () => {
      try {
        const nextAccount = await getUserAccount();
        if (!active) return;
        if (!nextAccount) throw new Error('没有拿到账号资料，请重新登录一次。');
        setAccount(nextAccount);
      } catch (error) {
        if (!active) return;
        setAccount(null);
        setAccountError(error instanceof Error ? error.message : '账号资料获取失败');
      } finally {
        if (active) {
          setAccountLoading(false);
        }
      }
    };

    void loadAccount();
    return () => { active = false; };
  }, [accountReloadKey, isLoggedIn, rootPage]);

  useEffect(() => {
    if (rootPage !== 'search') return;

    const trimmed = keyword.trim();
    if (!trimmed) {
      setIsSearching(false);
      setSearchBundle({ keyword: '', sections: [] });
      setSearchSections({});
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void executeSearch(trimmed, activeSearchTab);
    }, 320);

    return () => window.clearTimeout(timeoutId);
  }, [activeSearchTab, keyword, rootPage]);

  useEffect(() => registerBackHandler(() => {
    if (showQrLogin) {
      setShowQrLogin(false);
      return true;
    }
    if (showFullPlayer) {
      setShowFullPlayer(false);
      return true;
    }
    if (detailStack.length > 0) {
      setDetailStack((previous) => previous.slice(0, -1));
      return true;
    }
    if (rootPage === 'search') {
      setRootPage(lastPrimaryPage);
      return true;
    }
    return false;
  }), [detailStack.length, lastPrimaryPage, registerBackHandler, rootPage, showFullPlayer, showQrLogin]);

  const suggestionKeywords = useMemo(() => {
    const raw = [
      ...playlists.map((playlist) => playlist.name),
      ...playlistPreview.tracks.slice(0, 4).map((song) => song.name),
    ];
    const merged = Array.from(new Set(raw.filter(Boolean)));
    if (merged.length > 0) {
      return merged.slice(0, 8);
    }
    return ['周杰伦', '五月天', '故事FM', '机核', '陈奕迅', '薛之谦'];
  }, [playlistPreview.tracks, playlists]);

  const shouldHideChrome = showFullPlayer || rootPage === 'search' || Boolean(activeDetail);

  return (
    <div className="music-app">
      {rootPage === 'discover' ? (
        <DiscoverPage
          playlists={playlists}
          playlistsLoading={playlistsLoading}
          playlistsError={playlistsError}
          previewPlaylist={playlistPreview.playlist}
          previewTracks={playlistPreview.tracks}
          previewLoading={playlistPreview.loading}
          previewError={playlistPreview.error}
          currentPlayable={currentSong}
          onSearch={openSearch}
          onPlaylistSelect={(playlist) => { void loadPlaylistPreview(playlist); }}
          onSongClick={handleSongClick}
        />
      ) : null}

      {rootPage === 'search' && !activeDetail ? (
        <SearchPage
          keyword={keyword}
          activeTab={activeSearchTab}
          isSearching={isSearching}
          searchBundle={searchBundle}
          searchSections={searchSections}
          searchHistory={searchHistory}
          suggestions={suggestionKeywords}
          currentPlayable={currentSong}
          onKeywordChange={setKeyword}
          onTabChange={(tab) => setActiveSearchTab(tab)}
          onBack={closeSearch}
          onSubmit={() => { void executeSearch(keyword, activeSearchTab, true); }}
          onClearKeyword={() => setKeyword('')}
          onClearHistory={clearSearchHistory}
          onHistoryClick={(term) => {
            setKeyword(term);
            commitSearchHistory(term);
          }}
          onSongClick={handleSongClick}
          onOpenPlaylist={openPlaylistDetail}
          onOpenAlbum={openAlbumDetail}
          onOpenArtist={openArtistDetail}
          onOpenRadio={openRadioDetail}
          onOpenProgram={openProgramDetail}
        />
      ) : null}

      {rootPage === 'profile' ? (
        <ProfilePage
          account={account}
          isLoading={accountLoading}
          error={accountError}
          isLoggedIn={isLoggedIn}
          onOpenLogin={() => setShowQrLogin(true)}
          onLogout={() => {
            clearMusicCookie();
            setIsLoggedIn(false);
            setAccount(null);
            setAccountError(null);
            setShowQrLogin(false);
          }}
          onSearch={openSearch}
        />
      ) : null}

      {activeDetail?.type === 'playlistDetail' ? (
        <PlaylistDetailPage
          state={playlistDetails[activeDetail.id]}
          seed={activeDetail.seed}
          currentPlayable={currentSong}
          onBack={popDetail}
          onSongClick={handleSongClick}
        />
      ) : null}

      {activeDetail?.type === 'albumDetail' ? (
        <AlbumDetailPage
          state={albumDetails[activeDetail.id]}
          seed={activeDetail.seed}
          currentPlayable={currentSong}
          onBack={popDetail}
          onSongClick={handleSongClick}
        />
      ) : null}

      {activeDetail?.type === 'artistDetail' ? (
        <ArtistDetailPage
          state={artistDetails[activeDetail.id]}
          seed={activeDetail.seed}
          currentPlayable={currentSong}
          onBack={popDetail}
          onSongClick={handleSongClick}
          onOpenAlbum={openAlbumDetail}
        />
      ) : null}

      {activeDetail?.type === 'radioDetail' ? (
        <RadioDetailPage
          state={radioDetails[activeDetail.id]}
          seed={activeDetail.seed}
          currentPlayable={currentSong}
          onBack={popDetail}
          onProgramClick={handleProgramClick}
        />
      ) : null}

      {activeDetail?.type === 'programDetail' ? (
        <ProgramDetailPage
          state={programDetails[activeDetail.id]}
          seed={activeDetail.seed}
          onBack={popDetail}
          onPlay={handleProgramClick}
          onOpenRadio={openRadioDetail}
        />
      ) : null}

      {currentSong && !shouldHideChrome ? (
        <MiniPlayer
          playable={currentSong}
          isPlaying={isPlaying}
          progress={progress}
          onOpen={() => setShowFullPlayer(true)}
          onTogglePlay={(event) => {
            event.stopPropagation();
            togglePlay();
          }}
        />
      ) : null}

      {!shouldHideChrome ? (
        <div className="music-tabbar">
          <div className={`music-tab-item ${rootPage === 'discover' ? 'active' : ''}`} onClick={() => selectPrimaryPage('discover')}>
            <IconHome active={rootPage === 'discover'} />
            <span>首页</span>
          </div>
          <div className={`music-tab-item ${rootPage === 'search' ? 'active' : ''}`} onClick={openSearch}>
            <IconSearchTab active={rootPage === 'search'} />
            <span>搜索</span>
          </div>
          <div className={`music-tab-item ${rootPage === 'profile' ? 'active' : ''}`} onClick={() => selectPrimaryPage('profile')}>
            <IconUser active={rootPage === 'profile'} />
            <span>我的</span>
          </div>
        </div>
      ) : null}

      {showFullPlayer && currentSong ? (
        <FullPlayer
          playable={currentSong}
          isPlaying={isPlaying}
          progress={progress}
          currentTime={currentTime}
          duration={duration}
          onClose={() => setShowFullPlayer(false)}
          onTogglePlay={togglePlay}
          onPrev={() => { void playPrev(); }}
          onNext={() => { void playNext(); }}
          onSeek={seek}
        />
      ) : null}

      <QrLoginModal
        open={showQrLogin}
        onClose={() => setShowQrLogin(false)}
        onSuccess={() => {
          setIsLoggedIn(true);
          setAccount(null);
          setAccountError(null);
          setAccountReloadKey((value) => value + 1);
          setLastPrimaryPage('profile');
          setRootPage('profile');
        }}
      />
    </div>
  );
}
