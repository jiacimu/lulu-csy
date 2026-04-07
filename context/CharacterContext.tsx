import React,{ createContext,useContext,useEffect,useState } from 'react';
import { CharacterProfile,GroupProfile,Worldbook,NovelBook } from '../types';
import { DB } from '../utils/db';
import { useNotification } from './NotificationContext';

export interface CharacterContextType {
    characters: CharacterProfile[];
    setCharacters: React.Dispatch<React.SetStateAction<CharacterProfile[]>>;
    activeCharacterId: string;
    setActiveCharacterId: (id: string) => void;
    addCharacter: () => void;
    updateCharacter: (id: string, updates: Partial<CharacterProfile>) => void;
    deleteCharacter: (id: string) => void;

    worldbooks: Worldbook[];
    setWorldbooks: React.Dispatch<React.SetStateAction<Worldbook[]>>;
    addWorldbook: (wb: Worldbook) => void;
    updateWorldbook: (id: string, updates: Partial<Worldbook>) => Promise<void>;
    deleteWorldbook: (id: string) => void;

    novels: NovelBook[];
    setNovels: React.Dispatch<React.SetStateAction<NovelBook[]>>;
    addNovel: (novel: NovelBook) => void;
    updateNovel: (id: string, updates: Partial<NovelBook>) => Promise<void>;
    deleteNovel: (id: string) => void;

    groups: GroupProfile[];
    setGroups: React.Dispatch<React.SetStateAction<GroupProfile[]>>;
    createGroup: (name: string, members: string[]) => void;
    deleteGroup: (id: string) => void;

    isCharacterDataLoaded: boolean;
}

interface CharacterProviderProps {
    children: React.ReactNode;
    initialCharacter: CharacterProfile;
    generateAvatar: (seed: string) => string;
}

const CharacterContext = createContext<CharacterContextType | undefined>(undefined);

export const CharacterProvider: React.FC<CharacterProviderProps> = ({
    children,
    initialCharacter,
    generateAvatar,
}) => {
    const { addToast } = useNotification();

    const [characters, setCharacters] = useState<CharacterProfile[]>([]);
    const [activeCharacterId, setActiveCharacterIdState] = useState<string>('');
    const [groups, setGroups] = useState<GroupProfile[]>([]);
    const [worldbooks, setWorldbooks] = useState<Worldbook[]>([]);
    const [novels, setNovels] = useState<NovelBook[]>([]);
    const [isCharacterDataLoaded, setIsCharacterDataLoaded] = useState(false);

    useEffect(() => {
        const initCharacters = async () => {
            setIsCharacterDataLoaded(false);
            try {
                const [dbCharsResult, dbGroupsResult, dbWorldbooksResult, dbNovelsResult] = await Promise.allSettled([
                    DB.getAllCharacters(),
                    DB.getGroups(),
                    DB.getAllWorldbooks(),
                    DB.getAllNovels()
                ]);

                if (dbCharsResult.status === 'rejected') {
                    console.error('Failed to load characters:', dbCharsResult.reason);
                }
                if (dbGroupsResult.status === 'rejected') {
                    console.error('Failed to load groups:', dbGroupsResult.reason);
                }
                if (dbWorldbooksResult.status === 'rejected') {
                    console.error('Failed to load worldbooks:', dbWorldbooksResult.reason);
                }
                if (dbNovelsResult.status === 'rejected') {
                    console.error('Failed to load novels:', dbNovelsResult.reason);
                }

                const dbChars = dbCharsResult.status === 'fulfilled' ? dbCharsResult.value : [];
                const dbGroups = dbGroupsResult.status === 'fulfilled' ? dbGroupsResult.value : [];
                const dbWorldbooks = dbWorldbooksResult.status === 'fulfilled' ? dbWorldbooksResult.value : [];
                const dbNovels = dbNovelsResult.status === 'fulfilled' ? dbNovelsResult.value : [];

                let finalChars = dbChars;

                if (!finalChars.some(c => c.id === initialCharacter.id)) {
                    await DB.saveCharacter(initialCharacter);
                    finalChars = [...finalChars, initialCharacter];
                } else {
                    const existingCharacter = finalChars.find(c => c.id === initialCharacter.id);
                    if (existingCharacter) {
                        const currentSprites = existingCharacter.sprites || {};
                        const presetSprites = initialCharacter.sprites || {};
                        const isCorrupted = !currentSprites['normal'] || !currentSprites['chibi'];
                        const needsWallUpdate = existingCharacter.roomConfig?.wallImage !== initialCharacter.roomConfig?.wallImage;
                        const needsSkinSets = !existingCharacter.dateSkinSets || existingCharacter.dateSkinSets.length === 0;

                        if (isCorrupted || !existingCharacter.roomConfig || needsWallUpdate || needsSkinSets) {
                            const restoredSprites = { ...presetSprites, ...currentSprites };

                            if (!restoredSprites['normal']) restoredSprites['normal'] = presetSprites['normal'];
                            if (!restoredSprites['happy']) restoredSprites['happy'] = presetSprites['happy'];
                            if (!restoredSprites['sad']) restoredSprites['sad'] = presetSprites['sad'];
                            if (!restoredSprites['angry']) restoredSprites['angry'] = presetSprites['angry'];
                            if (!restoredSprites['shy']) restoredSprites['shy'] = presetSprites['shy'];
                            if (!restoredSprites['chibi']) restoredSprites['chibi'] = presetSprites['chibi'];

                            const updatedRoomConfig = existingCharacter.roomConfig ? {
                                ...existingCharacter.roomConfig,
                                wallImage: (existingCharacter.roomConfig.wallImage?.includes('radial-gradient') || !existingCharacter.roomConfig.wallImage)
                                    ? initialCharacter.roomConfig?.wallImage
                                    : existingCharacter.roomConfig.wallImage
                            } : initialCharacter.roomConfig;

                            const existingSkins = existingCharacter.dateSkinSets || [];
                            const presetSkins = initialCharacter.dateSkinSets || [];
                            const mergedSkins = [...existingSkins];
                            for (const presetSkin of presetSkins) {
                                if (!mergedSkins.some(skin => skin.id === presetSkin.id)) {
                                    mergedSkins.push(presetSkin);
                                }
                            }

                            const updatedCharacter = {
                                ...existingCharacter,
                                sprites: restoredSprites,
                                roomConfig: updatedRoomConfig,
                                dateSkinSets: mergedSkins
                            };

                            await DB.saveCharacter(updatedCharacter);
                            finalChars = finalChars.map(c => c.id === initialCharacter.id ? updatedCharacter : c);
                        }
                    }
                }

                if (finalChars.length > 0) {
                    setCharacters(finalChars);
                    const lastActiveId = localStorage.getItem('os_last_active_char_id');
                    if (lastActiveId && finalChars.find(c => c.id === lastActiveId)) {
                        setActiveCharacterIdState(lastActiveId);
                    } else if (finalChars.find(c => c.id === initialCharacter.id)) {
                        setActiveCharacterIdState(initialCharacter.id);
                    } else {
                        setActiveCharacterIdState(finalChars[0].id);
                    }
                } else {
                    await DB.saveCharacter(initialCharacter);
                    finalChars = [initialCharacter];
                    setCharacters(finalChars);
                    setActiveCharacterIdState(initialCharacter.id);
                }

                setGroups(dbGroups);
                setWorldbooks(dbWorldbooks);
                setNovels(dbNovels);

                try {
                    const { preloadImages } = await import('../utils/preloadResources');
                    const activeChar =
                        finalChars.find(c => c.id === (localStorage.getItem('os_last_active_char_id') || initialCharacter.id))
                        || finalChars[0];

                    if (activeChar) {
                        const urls: string[] = [
                            activeChar.avatar,
                            ...Object.values(activeChar.sprites || {}),
                            activeChar.roomConfig?.wallImage,
                            ...(activeChar.roomConfig?.items || []).map(item => item.image),
                            ...(activeChar.dateSkinSets || []).flatMap(skinSet => Object.values(skinSet.sprites || {})),
                        ].filter((url): url is string => typeof url === 'string' && url.startsWith('http'));
                        preloadImages(urls);
                    }
                } catch {
                    // Preload failures should not block app boot.
                }
            } catch (err) {
                console.error('Character init failed:', err);
            } finally {
                setIsCharacterDataLoaded(true);
            }
        };

        initCharacters();
    }, [initialCharacter]);

    const addCharacter = async () => {
        const name = 'New Character';
        const newChar: CharacterProfile = {
            id: `char-${Date.now()}`,
            name,
            avatar: generateAvatar(name),
            description: '点击编辑设定...',
            systemPrompt: '',
            memories: [],
            contextLimit: 500
        };
        setCharacters(prev => [...prev, newChar]);
        setActiveCharacterIdState(newChar.id);
        await DB.saveCharacter(newChar);
    };

    const updateCharacter = async (id: string, updates: Partial<CharacterProfile>) => {
        setCharacters(prev => {
            const updated = prev.map(c => c.id === id ? { ...c, ...updates } : c);
            const target = updated.find(c => c.id === id);
            if (target) DB.saveCharacter(target);
            return updated;
        });
    };

    const deleteCharacter = async (id: string) => {
        setCharacters(prev => {
            const remaining = prev.filter(c => c.id !== id);
            if (remaining.length > 0 && activeCharacterId === id) {
                setActiveCharacterIdState(remaining[0].id);
            }
            return remaining;
        });
        await DB.deleteCharacter(id);
    };

    const createGroup = async (name: string, members: string[]) => {
        const newGroup: GroupProfile = {
            id: `group-${Date.now()}`,
            name,
            members,
            avatar: generateAvatar(name),
            createdAt: Date.now()
        };
        await DB.saveGroup(newGroup);
        setGroups(prev => [...prev, newGroup]);
    };

    const deleteGroup = async (id: string) => {
        await DB.deleteGroup(id);
        setGroups(prev => prev.filter(group => group.id !== id));
    };

    const addWorldbook = async (wb: Worldbook) => {
        setWorldbooks(prev => [...prev, wb]);
        await DB.saveWorldbook(wb);
    };

    const updateWorldbook = async (id: string, updates: Partial<Worldbook>) => {
        let fullUpdatedWb: Worldbook | undefined;
        setWorldbooks(prev => {
            const next = prev.map(wb => {
                if (wb.id === id) {
                    fullUpdatedWb = { ...wb, ...updates, updatedAt: Date.now() };
                    return fullUpdatedWb;
                }
                return wb;
            });
            return next;
        });

        if (fullUpdatedWb) {
            await DB.saveWorldbook(fullUpdatedWb);

            const charsToSync = characters.filter(char => char.mountedWorldbooks?.some(mounted => mounted.id === id));

            if (charsToSync.length > 0) {
                const updatedChars = characters.map(char => {
                    if (char.mountedWorldbooks?.some(mounted => mounted.id === id)) {
                        const newMounted = char.mountedWorldbooks.map(mounted =>
                            mounted.id === id
                                ? {
                                    id: fullUpdatedWb!.id,
                                    title: fullUpdatedWb!.title,
                                    content: fullUpdatedWb!.content,
                                    category: fullUpdatedWb!.category,
                                    position: fullUpdatedWb!.position
                                }
                                : mounted
                        );
                        const newChar = { ...char, mountedWorldbooks: newMounted };
                        DB.saveCharacter(newChar);
                        return newChar;
                    }
                    return char;
                });
                setCharacters(updatedChars);
                addToast(`已同步更新 ${charsToSync.length} 个相关角色的缓存`, 'info');
            }
        }
    };

    const deleteWorldbook = async (id: string) => {
        setWorldbooks(prev => prev.filter(wb => wb.id !== id));
        await DB.deleteWorldbook(id);

        const updatedChars = characters.map(char => {
            if (char.mountedWorldbooks?.some(mounted => mounted.id === id)) {
                const newMounted = char.mountedWorldbooks.filter(mounted => mounted.id !== id);
                const newChar = { ...char, mountedWorldbooks: newMounted };
                DB.saveCharacter(newChar);
                return newChar;
            }
            return char;
        });
        setCharacters(updatedChars);
        addToast('世界书已删除 (同步移除角色挂载)', 'success');
    };

    const addNovel = async (novel: NovelBook) => {
        setNovels(prev => [novel, ...prev]);
        await DB.saveNovel(novel);
    };

    const updateNovel = async (id: string, updates: Partial<NovelBook>) => {
        setNovels(prev => {
            const next = prev.map(novel => novel.id === id ? { ...novel, ...updates, lastActiveAt: Date.now() } : novel);
            const target = next.find(novel => novel.id === id);
            if (target) DB.saveNovel(target);
            return next;
        });
    };

    const deleteNovel = async (id: string) => {
        setNovels(prev => prev.filter(novel => novel.id !== id));
        await DB.deleteNovel(id);
    };

    const handleSetActiveCharacter = (id: string) => {
        setActiveCharacterIdState(id);
        localStorage.setItem('os_last_active_char_id', id);
    };

    const value: CharacterContextType = {
        characters,
        setCharacters,
        activeCharacterId,
        setActiveCharacterId: handleSetActiveCharacter,
        addCharacter,
        updateCharacter,
        deleteCharacter,
        worldbooks,
        setWorldbooks,
        addWorldbook,
        updateWorldbook,
        deleteWorldbook,
        novels,
        setNovels,
        addNovel,
        updateNovel,
        deleteNovel,
        groups,
        setGroups,
        createGroup,
        deleteGroup,
        isCharacterDataLoaded,
    };

    return (
        <CharacterContext.Provider value={value}>
            {children}
        </CharacterContext.Provider>
    );
};

export const useCharacter = () => {
    const context = useContext(CharacterContext);
    if (context === undefined) {
        throw new Error('useCharacter must be used within a CharacterProvider');
    }
    return context;
};
