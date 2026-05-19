/**
 * Love Show Store — localStorage persistence for 恋综 (Love Show) seasons.
 *
 * Key schema:
 *   loveshow_season_${seasonId}              → SeasonState
 *   loveshow_charstate_${seasonId}_${charId}  → CharacterState
 *   loveshow_impression_${seasonId}_${charId} → LoveShowUserImpression
 *   loveshow_npcs_${seasonId}                → NpcProfile[]
 *   loveshow_active_season                   → string (seasonId)
 *   loveshow_social_${seasonId}_day${day}     → LoveShowSocialPost[]
 *   loveshow_missions_${seasonId}            → DirectorMission[]
 *   loveshow_memories_${seasonId}            → MemoryCard[]
 */

import type {
    SeasonState,
    CharacterState,
    LoveShowUserImpression,
    NpcProfile,
    LoveShowSocialPost,
    DirectorMission,
    MemoryCard,
} from '../../types/loveshow';

// ── Key helpers ──

const KEY_SEASON         = 'loveshow_season_';
const KEY_CHARSTATE      = 'loveshow_charstate_';
const KEY_IMPRESSION     = 'loveshow_impression_';
const KEY_NPCS           = 'loveshow_npcs_';
const KEY_ACTIVE_SEASON  = 'loveshow_active_season';
const KEY_SOCIAL         = 'loveshow_social_';
const KEY_MISSIONS       = 'loveshow_missions_';
const KEY_MEMORIES       = 'loveshow_memories_';
const KEY_SEASON_INDEX   = 'loveshow_season_index';

// ═══════════════════════════════════
//  赛季 CRUD
// ═══════════════════════════════════

/** Save or update a season */
export function saveSeason(season: SeasonState): void {
    try {
        localStorage.setItem(KEY_SEASON + season.seasonId, JSON.stringify(season));
        // Maintain an index of all season IDs for enumeration
        const index = _getSeasonIndex();
        if (!index.includes(season.seasonId)) {
            index.push(season.seasonId);
            localStorage.setItem(KEY_SEASON_INDEX, JSON.stringify(index));
        }
    } catch (e) {
        console.error('[LoveShowStore] Failed to save season:', e);
    }
}

/** Get a season by ID */
export function getSeason(seasonId: string): SeasonState | null {
    try {
        const raw = localStorage.getItem(KEY_SEASON + seasonId);
        if (!raw) return null;
        return JSON.parse(raw) as SeasonState;
    } catch {
        return null;
    }
}

/** Get the currently active season */
export function getActiveSeason(): SeasonState | null {
    try {
        const id = localStorage.getItem(KEY_ACTIVE_SEASON);
        if (!id) return null;
        return getSeason(id);
    } catch {
        return null;
    }
}

/** Set the active season ID */
export function setActiveSeasonId(seasonId: string): void {
    try {
        localStorage.setItem(KEY_ACTIVE_SEASON, seasonId);
    } catch { /* ignore */ }
}

/** Delete a season and all its associated data */
export function deleteSeason(seasonId: string): void {
    try {
        const season = getSeason(seasonId);
        localStorage.removeItem(KEY_SEASON + seasonId);
        localStorage.removeItem(KEY_NPCS + seasonId);
        localStorage.removeItem(KEY_MISSIONS + seasonId);
        localStorage.removeItem(KEY_MEMORIES + seasonId);

        // Clean up per-character keys
        _cleanCharacterKeys(seasonId, season?.charIds || []);

        // Clean up social posts (days 1-5)
        for (let d = 1; d <= 5; d++) {
            localStorage.removeItem(KEY_SOCIAL + seasonId + '_day' + d);
        }

        // Remove from index
        const index = _getSeasonIndex().filter(id => id !== seasonId);
        localStorage.setItem(KEY_SEASON_INDEX, JSON.stringify(index));

        // Clear active if it was this season
        if (localStorage.getItem(KEY_ACTIVE_SEASON) === seasonId) {
            localStorage.removeItem(KEY_ACTIVE_SEASON);
        }
    } catch { /* ignore */ }
}

/** Get all saved seasons, sorted by lastActiveAt desc */
export function getAllSeasons(): SeasonState[] {
    const index = _getSeasonIndex();
    const seasons: SeasonState[] = [];
    for (const id of index) {
        const s = getSeason(id);
        if (s) seasons.push(s);
    }
    return seasons.sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

// ═══════════════════════════════════
//  角色状态
// ═══════════════════════════════════

/** Save or update a character's state for a given season */
export function saveCharacterState(seasonId: string, state: CharacterState): void {
    try {
        localStorage.setItem(
            KEY_CHARSTATE + seasonId + '_' + state.characterId,
            JSON.stringify(state),
        );
    } catch (e) {
        console.error('[LoveShowStore] Failed to save character state:', e);
    }
}

/** Get a character's state */
export function getCharacterState(seasonId: string, charId: string): CharacterState | null {
    try {
        const raw = localStorage.getItem(KEY_CHARSTATE + seasonId + '_' + charId);
        if (!raw) return null;
        return JSON.parse(raw) as CharacterState;
    } catch {
        return null;
    }
}

/** Get all character states for a season (requires season's charIds) */
export function getAllCharacterStates(seasonId: string): CharacterState[] {
    const season = getSeason(seasonId);
    if (!season) return [];
    const states: CharacterState[] = [];
    for (const charId of season.charIds) {
        const s = getCharacterState(seasonId, charId);
        if (s) states.push(s);
    }
    return states;
}

// ═══════════════════════════════════
//  印象卡
// ═══════════════════════════════════

/** Save or update a user impression for a character */
export function saveImpression(seasonId: string, impression: LoveShowUserImpression): void {
    try {
        localStorage.setItem(
            KEY_IMPRESSION + seasonId + '_' + impression.characterId,
            JSON.stringify(impression),
        );
    } catch (e) {
        console.error('[LoveShowStore] Failed to save impression:', e);
    }
}

/** Get impression for a specific character */
export function getImpression(seasonId: string, charId: string): LoveShowUserImpression | null {
    try {
        const raw = localStorage.getItem(KEY_IMPRESSION + seasonId + '_' + charId);
        if (!raw) return null;
        return JSON.parse(raw) as LoveShowUserImpression;
    } catch {
        return null;
    }
}

/** Get all impressions for a season (requires season's charIds) */
export function getAllImpressions(seasonId: string): LoveShowUserImpression[] {
    const season = getSeason(seasonId);
    if (!season) return [];
    const impressions: LoveShowUserImpression[] = [];
    for (const charId of season.charIds) {
        const imp = getImpression(seasonId, charId);
        if (imp) impressions.push(imp);
    }
    return impressions;
}

// ═══════════════════════════════════
//  NPC
// ═══════════════════════════════════

/** Save the NPC list for a season */
export function saveNpcs(seasonId: string, npcs: NpcProfile[]): void {
    try {
        localStorage.setItem(KEY_NPCS + seasonId, JSON.stringify(npcs));
    } catch (e) {
        console.error('[LoveShowStore] Failed to save NPCs:', e);
    }
}

/** Get the NPC list for a season */
export function getNpcs(seasonId: string): NpcProfile[] {
    try {
        const raw = localStorage.getItem(KEY_NPCS + seasonId);
        if (!raw) return [];
        return JSON.parse(raw) as NpcProfile[];
    } catch {
        return [];
    }
}

// ═══════════════════════════════════
//  社交媒体
// ═══════════════════════════════════

/** Save social posts for a specific day */
export function saveSocialPosts(seasonId: string, day: number, posts: LoveShowSocialPost[]): void {
    try {
        localStorage.setItem(KEY_SOCIAL + seasonId + '_day' + day, JSON.stringify(posts));
    } catch (e) {
        console.error('[LoveShowStore] Failed to save social posts:', e);
    }
}

/** Get social posts for a specific day */
export function getSocialPosts(seasonId: string, day: number): LoveShowSocialPost[] {
    try {
        const raw = localStorage.getItem(KEY_SOCIAL + seasonId + '_day' + day);
        if (!raw) return [];
        return JSON.parse(raw) as LoveShowSocialPost[];
    } catch {
        return [];
    }
}

// ═══════════════════════════════════
//  密令
// ═══════════════════════════════════

/** Save director missions for a season */
export function saveMissions(seasonId: string, missions: DirectorMission[]): void {
    try {
        localStorage.setItem(KEY_MISSIONS + seasonId, JSON.stringify(missions));
    } catch (e) {
        console.error('[LoveShowStore] Failed to save missions:', e);
    }
}

/** Get director missions for a season */
export function getMissions(seasonId: string): DirectorMission[] {
    try {
        const raw = localStorage.getItem(KEY_MISSIONS + seasonId);
        if (!raw) return [];
        return JSON.parse(raw) as DirectorMission[];
    } catch {
        return [];
    }
}

// ═══════════════════════════════════
//  回忆
// ═══════════════════════════════════

/** Append a memory card to the season's collection */
export function saveMemoryCard(seasonId: string, card: MemoryCard): void {
    try {
        const existing = getMemoryCards(seasonId);
        existing.push(card);
        localStorage.setItem(KEY_MEMORIES + seasonId, JSON.stringify(existing));
    } catch (e) {
        console.error('[LoveShowStore] Failed to save memory card:', e);
    }
}

/** Get all memory cards for a season */
export function getMemoryCards(seasonId: string): MemoryCard[] {
    try {
        const raw = localStorage.getItem(KEY_MEMORIES + seasonId);
        if (!raw) return [];
        return JSON.parse(raw) as MemoryCard[];
    } catch {
        return [];
    }
}

// ═══════════════════════════════════
//  工具函数
// ═══════════════════════════════════

/** Generate a unique season ID (timestamp + random suffix) */
export function generateSeasonId(): string {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return `ls_${ts}_${rand}`;
}

/** Create initial CharacterState with sensible defaults */
export function createInitialCharacterState(charId: string): CharacterState {
    return {
        characterId: charId,
        affection: 0,
        mood: '期待',
        confidence: 50,
        strategy: '观望',
        jealousyTarget: null,
        innerThought: '',
        lastUpdatedScene: '',
    };
}

/** Create initial LoveShowUserImpression with empty arrays */
export function createInitialImpression(charId: string): LoveShowUserImpression {
    return {
        characterId: charId,
        perceivedTraits: [],
        knownFacts: [],
        misconceptions: [],
        impression: '',
        history: [],
    };
}

// ── Internal helpers ──

function _getSeasonIndex(): string[] {
    try {
        const raw = localStorage.getItem(KEY_SEASON_INDEX);
        if (!raw) return [];
        return JSON.parse(raw) as string[];
    } catch {
        return [];
    }
}

/** Remove character-state and impression keys for a deleted season */
function _cleanCharacterKeys(seasonId: string, charIds: string[]): void {
    for (const charId of charIds) {
        localStorage.removeItem(KEY_CHARSTATE + seasonId + '_' + charId);
        localStorage.removeItem(KEY_IMPRESSION + seasonId + '_' + charId);
    }
}
