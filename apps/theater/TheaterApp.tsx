/**
 * TheaterApp — 520 约会剧场 主入口
 * 模式流转: select → map → session
 * 导演引擎 (副API) + 角色扮演 (主API) 双API架构
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useOS } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { ContextBuilder } from '../../utils/context';
import { safeResponseJson } from '../../utils/safeApi';
import { extractThinking } from '../../utils/thinkingExtractor';
import { getSecondaryApiConfig } from '../../utils/runtimeConfig';
import { buildDatePreamble, buildTheaterScene, buildDateTail } from '../../utils/datePrompts';
import type { CharacterProfile, Message, TheaterLocation, DirectorEvent, TheaterSessionState } from '../../types';

import {
    computeWeights, rollEventType, shouldTriggerEvent, updatePity,
    createPityCounter, advanceTimeSlot, getInitialTimeSlot,
    is520EventActive, generateSessionId,
} from '../../utils/theaterDirector';
import {
    buildDirectorPrompt, buildTheaterSceneInjection, buildInitialScenePrompt,
    build520ConfessionHint, parseDirectorResponse,
} from '../../utils/theaterPrompts';
import { getPresetLocations } from '../../utils/theaterLocations';
import {
    saveTheaterSession, getTheaterSession, deleteTheaterSession,
    getCustomLocations, addCustomLocation as dbAddCustomLocation,
    deleteCustomLocation as dbDeleteCustomLocation,
} from '../../utils/db/theaterStore';

import TheaterMap from './TheaterMap';
import TheaterSession from './TheaterSession';
import Modal from '../../components/os/Modal';
import './theater.css';

type Mode = 'select' | 'map' | 'session';

const isTheaterMessage = (m: Message) =>
    m.metadata?.source === 'theater' && !m.metadata?.hiddenFromUser;

const TheaterApp: React.FC = () => {
    const { closeApp, characters, setActiveCharacterId, apiConfig, addToast, userProfile } = useOS();

    // ── Core State ──
    const [mode, setMode] = useState<Mode>('select');
    const [char, setChar] = useState<CharacterProfile | null>(null);

    // ── Session State ──
    const [session, setSession] = useState<TheaterSessionState | null>(null);
    const [locations, setLocations] = useState<TheaterLocation[]>([]);
    const [currentLocation, setCurrentLocation] = useState<TheaterLocation | null>(null);
    const [theaterMessages, setTheaterMessages] = useState<Message[]>([]);
    const [currentEvent, setCurrentEvent] = useState<DirectorEvent | null>(null);

    // ── Loading State ──
    const [isDirectorLoading, setIsDirectorLoading] = useState(false);
    const [isAiLoading, setIsAiLoading] = useState(false);

    // ── Exit Review ──
    const [showExitReview, setShowExitReview] = useState(false);

    // ── Pity ref for non-stale access in callbacks ──
    const sessionRef = useRef(session);
    useEffect(() => { sessionRef.current = session; }, [session]);

    // ── Init locations ──
    useEffect(() => {
        const presets = getPresetLocations();
        const custom = getCustomLocations();
        setLocations([...presets, ...custom]);
    }, []);

    // ── Character Selection ──
    const handleSelectChar = useCallback(async (c: CharacterProfile) => {
        setChar(c);
        setActiveCharacterId(c.id);

        // Check for saved session
        const saved = getTheaterSession(c.id);
        if (saved) {
            setSession(saved);
            const loc = locations.find(l => l.id === saved.currentLocationId);
            if (loc) setCurrentLocation(loc);

            // Load messages
            const allMsgs = await DB.getMessagesByCharId(c.id);
            setTheaterMessages(allMsgs.filter(isTheaterMessage).sort((a, b) => a.timestamp - b.timestamp));
        } else {
            // New session
            const newSession: TheaterSessionState = {
                sessionId: generateSessionId(),
                charId: c.id,
                currentLocationId: '',
                timeSlot: getInitialTimeSlot(),
                locationChangeCount: 0,
                pity: createPityCounter(),
                eventHistory: [],
                visitedLocationIds: [],
                is520Event: is520EventActive(),
                startedAt: Date.now(),
                lastActiveAt: Date.now(),
            };
            setSession(newSession);
        }
        setMode('map');
    }, [locations, setActiveCharacterId]);

    // ── Location Selection ──
    const handleSelectLocation = useCallback(async (loc: TheaterLocation) => {
        if (!char || !session) return;

        const isNewLocation = loc.id !== session.currentLocationId;
        let updatedSession = { ...session, currentLocationId: loc.id, lastActiveAt: Date.now() };

        if (isNewLocation) {
            updatedSession.locationChangeCount += 1;
            if (!updatedSession.visitedLocationIds.includes(loc.id)) {
                updatedSession.visitedLocationIds.push(loc.id);
            }
            // Advance time
            updatedSession.timeSlot = advanceTimeSlot(
                session.timeSlot,
                updatedSession.locationChangeCount,
            );
            // Update visit count on location
            loc = { ...loc, visitCount: loc.visitCount + 1, lastVisitTime: Date.now() };
            setLocations(prev => prev.map(l => l.id === loc.id ? loc : l));
        }

        setSession(updatedSession);
        setCurrentLocation(loc);
        setCurrentEvent(null);
        saveTheaterSession(updatedSession);
        setMode('session');

        // Generate initial ambient scene
        if (isNewLocation) {
            await generateInitialScene(loc, updatedSession);
        }
    }, [char, session]);

    // ── Generate Initial Scene (entering a new location) ──
    const generateInitialScene = async (loc: TheaterLocation, sess: TheaterSessionState) => {
        if (!char || !apiConfig?.baseUrl) return;

        setIsAiLoading(true);
        try {
            const scenePrompt = buildInitialScenePrompt(loc, sess.timeSlot, char.name, userProfile.name);

            // Build system prompt (reuse date mode prompts)
            let systemPrompt = buildDatePreamble(char.name, userProfile.name);
            systemPrompt += ContextBuilder.buildCoreContext(char, userProfile);
            systemPrompt += `\n\n${scenePrompt}`;

            const REQUIRED_EMOTIONS = ['normal', 'happy', 'angry', 'sad', 'shy'];
            const dateEmotions = [...REQUIRED_EMOTIONS, ...(char.customDateSprites || [])];
            const userPov = char.datePerspective || 'second';
            const charPov = char.dateCharPerspective || 'third';
            systemPrompt += buildTheaterScene(char.name, userProfile.name, dateEmotions, userPov, charPov);

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: `（你们刚到 ${loc.name}。请写一段到场描写。）` },
                    ],
                    temperature: 0.85,
                }),
            });

            if (!response.ok) throw new Error('API Error');
            const data = await safeResponseJson(response);
            const raw = data.choices[0].message.content;
            const extracted = extractThinking(raw);

            await DB.saveMessage({
                charId: char.id, role: 'assistant', type: 'text',
                content: extracted.content,
                metadata: { source: 'theater', isOpening: true, locationId: loc.id, thinking: extracted.thinking },
            });

            const freshMsgs = await DB.getMessagesByCharId(char.id);
            setTheaterMessages(freshMsgs.filter(isTheaterMessage).sort((a, b) => a.timestamp - b.timestamp));
        } catch (e) {
            console.error('[Theater] Initial scene error:', e);
            addToast('场景加载失败', 'error');
        } finally {
            setIsAiLoading(false);
        }
    };

    // ── Send Message (with director engine integration) ──
    const handleSendMessage = useCallback(async (text: string) => {
        if (!char || !currentLocation || !session || !apiConfig?.baseUrl) return;

        // 1. Save user message
        await DB.saveMessage({
            charId: char.id, role: 'user', type: 'text', content: text,
            metadata: { source: 'theater', locationId: currentLocation.id },
        });

        // Refresh messages
        let allMsgs = await DB.getMessagesByCharId(char.id);
        setTheaterMessages(allMsgs.filter(isTheaterMessage).sort((a, b) => a.timestamp - b.timestamp));

        // 2. Check pity system — should we trigger a director event?
        const triggered = shouldTriggerEvent(session.pity);
        let directorEvent: DirectorEvent | null = null;

        if (triggered) {
            // 2a. Roll event type
            const weights = computeWeights(currentLocation, session.timeSlot, session.eventHistory, session.is520Event);
            const eventType = rollEventType(weights);

            // 2b. Call director (secondary API)
            const secondaryConfig = getSecondaryApiConfig();
            if (secondaryConfig?.baseUrl && secondaryConfig?.apiKey) {
                setIsDirectorLoading(true);
                try {
                    const directorPrompt = buildDirectorPrompt(
                        char.name, userProfile.name, currentLocation,
                        session.timeSlot, eventType, session.eventHistory,
                    );

                    const dirResponse = await fetch(`${secondaryConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${secondaryConfig.apiKey}` },
                        body: JSON.stringify({
                            model: secondaryConfig.model || apiConfig.model,
                            messages: [{ role: 'user', content: directorPrompt }],
                            temperature: 0.7,
                            max_tokens: 400,
                        }),
                    });

                    if (dirResponse.ok) {
                        const dirData = await safeResponseJson(dirResponse);
                        const rawDir = dirData.choices[0].message.content;
                        directorEvent = parseDirectorResponse(rawDir);
                    }
                } catch (e) {
                    console.warn('[Theater] Director call failed, proceeding without event:', e);
                } finally {
                    setIsDirectorLoading(false);
                }
            }
        }

        // 3. Update pity
        const updatedPity = updatePity(session.pity, !!directorEvent);
        const updatedSession = {
            ...session,
            pity: updatedPity,
            eventHistory: directorEvent ? [...session.eventHistory, directorEvent] : session.eventHistory,
            lastActiveAt: Date.now(),
        };
        setSession(updatedSession);
        saveTheaterSession(updatedSession);

        if (directorEvent) {
            setCurrentEvent(directorEvent);
        }

        // 4. Call main API (character roleplay)
        setIsAiLoading(true);
        try {
            let systemPrompt = buildDatePreamble(char.name, userProfile.name);
            systemPrompt += ContextBuilder.buildCoreContext(char, userProfile);

            // Inject director event if triggered
            if (directorEvent) {
                systemPrompt += buildTheaterSceneInjection(directorEvent, currentLocation, session.timeSlot);
            }

            // 520 confession hint (night + romantic + 520 event)
            if (session.is520Event && session.timeSlot === 'night' && directorEvent?.sceneType === 'romantic') {
                systemPrompt += build520ConfessionHint(char.name);
            }

            const REQUIRED_EMOTIONS = ['normal', 'happy', 'angry', 'sad', 'shy'];
            const dateEmotions = [...REQUIRED_EMOTIONS, ...(char.customDateSprites || [])];
            const userPov = char.datePerspective || 'second';
            const charPov = char.dateCharPerspective || 'third';
            systemPrompt += buildTheaterScene(char.name, userProfile.name, dateEmotions, userPov, charPov);
            systemPrompt += buildDateTail(char.name, userProfile.name, userPov, charPov);

            // Build history
            allMsgs = await DB.getMessagesByCharId(char.id);
            const theaterMsgs = allMsgs.filter(isTheaterMessage).sort((a, b) => a.timestamp - b.timestamp);
            const limit = char.contextLimit || 500;
            const historyMsgs = theaterMsgs.slice(-limit, -1).map(m => ({
                role: m.role,
                content: m.type === 'image' ? '[User sent an image]' : m.content,
            }));

            const eventNote = directorEvent
                ? `\n\n(System: 导演事件已触发 [${directorEvent.sceneType}]。你必须在回复中自然地对这个事件做出反应。严格遵守沉浸剧场格式。)`
                : `\n\n(System: 严格遵守沉浸剧场格式。每一行都要以 [emotion] 开头。)`;

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...historyMsgs,
                        { role: 'user', content: text + eventNote },
                    ],
                    temperature: 0.85,
                }),
            });

            if (!response.ok) throw new Error('API Error');
            const data = await safeResponseJson(response);
            const raw = data.choices[0].message.content;
            const extracted = extractThinking(raw);

            await DB.saveMessage({
                charId: char.id, role: 'assistant', type: 'text',
                content: extracted.content,
                metadata: {
                    source: 'theater',
                    locationId: currentLocation.id,
                    directorEvent: directorEvent?.sceneType || null,
                    thinking: extracted.thinking,
                },
            });

            const freshMsgs = await DB.getMessagesByCharId(char.id);
            setTheaterMessages(freshMsgs.filter(isTheaterMessage).sort((a, b) => a.timestamp - b.timestamp));
        } catch (e) {
            console.error('[Theater] AI response error:', e);
            addToast('回复生成失败', 'error');
        } finally {
            setIsAiLoading(false);
        }
    }, [char, currentLocation, session, apiConfig, userProfile, addToast]);

    // ── Add Custom Location ──
    const handleAddLocation = useCallback((loc: TheaterLocation) => {
        dbAddCustomLocation(loc);
        setLocations(prev => [...prev, loc]);
        addToast(`已添加「${loc.name}」`, 'success');
    }, [addToast]);

    // ── Delete Custom Location ──
    const handleDeleteCustomLocation = useCallback((id: string) => {
        dbDeleteCustomLocation(id);
        setLocations(prev => prev.filter(l => l.id !== id));
        addToast('已删除自定义地点', 'info');
    }, [addToast]);

    // ── Exit ──
    const handleExit = useCallback(() => {
        if (session && session.eventHistory.length > 0) {
            setShowExitReview(true);
        } else {
            if (session) deleteTheaterSession(session.charId);
            setMode('select');
            setSession(null);
            setChar(null);
            setCurrentLocation(null);
            setTheaterMessages([]);
            setCurrentEvent(null);
        }
    }, [session]);

    const confirmExit = useCallback(() => {
        if (session) deleteTheaterSession(session.charId);
        setShowExitReview(false);
        setMode('select');
        setSession(null);
        setChar(null);
        setCurrentLocation(null);
        setTheaterMessages([]);
        setCurrentEvent(null);
    }, [session]);

    // ── Render ──

    if (mode === 'select' || !char) {
        return (
            <div className="theater-app">
                <div className="theater-map" style={{ background: 'linear-gradient(180deg, #0d0015, #1a0a1e)' }}>
                    {/* Header */}
                    <div className="theater-map-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <button className="theater-back-btn" onClick={closeApp}>
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width={18} height={18}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
                                </svg>
                            </button>
                            <div>
                                <div className="theater-map-title">{is520EventActive() ? '520 约会剧场' : '约会剧场'}</div>
                                <div className="theater-map-subtitle">选择角色开始</div>
                            </div>
                        </div>
                    </div>

                    {/* Character List */}
                    <div className="theater-card-scroll">
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                            {characters.map(c => (
                                <button
                                    key={c.id}
                                    onClick={() => handleSelectChar(c)}
                                    className="w-full flex items-center gap-4 p-4 rounded-2xl transition-all active:scale-[0.98]"
                                    style={{
                                        background: 'rgba(255,255,255,0.04)',
                                        border: '1px solid rgba(255,255,255,0.08)',
                                    }}
                                >
                                    <img
                                        src={c.avatar}
                                        alt={c.name}
                                        className="w-14 h-14 rounded-2xl object-cover"
                                        style={{ border: '2px solid rgba(255,107,157,0.3)' }}
                                    />
                                    <div className="text-left flex-1">
                                        <div className="text-white font-bold text-[15px]">{c.name}</div>
                                        <div className="text-white/30 text-xs mt-1 line-clamp-1">{c.description || '无描述'}</div>
                                    </div>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="rgba(255,255,255,0.3)" width={20} height={20}>
                                        <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
                                    </svg>
                                </button>
                            ))}
                            {characters.length === 0 && (
                                <div className="text-center text-white/20 py-20 text-sm">还没有角色，先去创建一个吧</div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (mode === 'map') {
        return (
            <div className="theater-app">
                <TheaterMap
                    locations={locations}
                    timeSlot={session?.timeSlot || 'afternoon'}
                    is520={session?.is520Event || false}
                    visitedLocationIds={session?.visitedLocationIds || []}
                    onSelectLocation={handleSelectLocation}
                    onAddLocation={handleAddLocation}
                    onDeleteCustomLocation={handleDeleteCustomLocation}
                    onBack={() => { setMode('select'); setChar(null); }}
                />
            </div>
        );
    }

    if (mode === 'session' && currentLocation) {
        return (
            <div className="theater-app">
                <TheaterSession
                    char={char}
                    userProfile={userProfile}
                    location={currentLocation}
                    timeSlot={session?.timeSlot || 'afternoon'}
                    is520={session?.is520Event || false}
                    currentEvent={currentEvent}
                    isDirectorLoading={isDirectorLoading}
                    isAiLoading={isAiLoading}
                    messages={theaterMessages}
                    onSendMessage={handleSendMessage}
                    onChangeLocation={() => setMode('map')}
                    onExit={handleExit}
                />

                {/* Exit Review Modal */}
                <Modal isOpen={showExitReview} title="今日回顾" onClose={() => setShowExitReview(false)} footer={
                    <button
                        onClick={confirmExit}
                        className="w-full py-3.5 rounded-2xl font-bold text-white text-sm"
                        style={{ background: 'linear-gradient(135deg, #FF6B9D, #C44569)' }}
                    >
                        结束剧场
                    </button>
                }>
                    <div className="theater-timeline">
                        {session?.eventHistory.map((evt, i) => (
                            <div key={i} className="theater-timeline-item">
                                <div>
                                    <div className="theater-timeline-location">
                                        {evt.sceneType.toUpperCase()}
                                    </div>
                                    <div className="theater-timeline-event">{evt.event}</div>
                                </div>
                            </div>
                        ))}
                        {(!session?.eventHistory || session.eventHistory.length === 0) && (
                            <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.3)', fontSize: 13, padding: '20px 0' }}>
                                这次散步很平静，没有特别的事件发生
                            </div>
                        )}
                    </div>
                </Modal>
            </div>
        );
    }

    return null;
};

export default TheaterApp;
