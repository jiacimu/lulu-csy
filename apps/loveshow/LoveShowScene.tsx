import React, { useMemo } from 'react';
import {
    ArrowCounterClockwise,
    Camera,
    CheckCircle,
    ChatCircleText,
    PaperPlaneTilt,
    Sparkle,
    UserCircle,
} from '@phosphor-icons/react';
import type { CharacterProfile } from '../../types';
import type { LoveShowScene as LoveShowSceneModel } from '../../types/loveshow';
import { parseLoveShowScript, type ScriptNode } from '../../utils/loveshowScriptParser';

export interface LoveShowTurn {
    id: string;
    role: 'assistant' | 'user' | 'system';
    content: string;
    createdAt: number;
}

interface LoveShowSceneProps {
    scene: LoveShowSceneModel;
    characters: CharacterProfile[];
    turns: LoveShowTurn[];
    inputValue: string;
    isSending: boolean;
    isClosingScene: boolean;
    error: string | null;
    canRetry: boolean;
    onInputChange: (value: string) => void;
    onSend: () => void;
    onRetry: () => void;
    onCompleteScene: () => void;
}

function getInitial(name: string): string {
    return name.trim().slice(0, 1).toUpperCase() || 'L';
}

function renderScriptNode(node: ScriptNode, index: number) {
    switch (node.type) {
        case 'narration':
            return (
                <div key={index} className="ls-script-node ls-script-narration">
                    <Sparkle size={15} weight="fill" />
                    <span>{node.content}</span>
                </div>
            );
        case 'dialogue':
            return (
                <div key={index} className="ls-script-node ls-script-dialogue">
                    <div className="ls-dialogue-speaker">{node.character}</div>
                    <div className="ls-dialogue-content">{node.content}</div>
                </div>
            );
        case 'interview':
            return (
                <div key={index} className="ls-script-node ls-script-interview">
                    <Camera size={16} weight="bold" />
                    <div>
                        <div className="ls-interview-name">{node.character}</div>
                        <div>{node.content}</div>
                    </div>
                </div>
            );
        case 'phone':
            return (
                <div key={index} className="ls-script-node ls-script-phone">
                    <ChatCircleText size={16} weight="bold" />
                    <span>{node.content}</span>
                </div>
            );
        case 'text':
        default:
            return (
                <div key={index} className="ls-script-node ls-script-text">
                    {node.content}
                </div>
            );
    }
}

function renderTurn(turn: LoveShowTurn) {
    if (turn.role === 'user') {
        return (
            <article key={turn.id} className="ls-turn ls-turn-user">
                <div className="ls-user-bubble">{turn.content}</div>
            </article>
        );
    }

    const parsed = parseLoveShowScript(turn.content);
    return (
        <article key={turn.id} className="ls-turn ls-turn-assistant">
            {parsed.nodes.map(renderScriptNode)}
        </article>
    );
}

const LoveShowScene: React.FC<LoveShowSceneProps> = ({
    scene,
    characters,
    turns,
    inputValue,
    isSending,
    isClosingScene,
    error,
    canRetry,
    onInputChange,
    onSend,
    onRetry,
    onCompleteScene,
}) => {
    const characterMap = useMemo(() => new Map(characters.map(char => [char.id, char])), [characters]);
    const sceneCharacters = scene.characterIds
        .map(id => characterMap.get(id))
        .filter((char): char is CharacterProfile => Boolean(char));

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault();
        onSend();
    };

    return (
        <section className="ls-scene" aria-label="LoveShow scene">
            <div className="ls-scene-backdrop" />
            <header className="ls-scene-header">
                <div className="ls-live-mark">
                    <span className="ls-live-dot" />
                    LIVE
                </div>
                <div className="ls-scene-title">
                    <span>Day {scene.dayNumber}</span>
                    <h1>{scene.locationName}</h1>
                </div>
                <p>{scene.atmosphere}</p>
            </header>

            <div className="ls-cast-strip" aria-label="在场嘉宾">
                {sceneCharacters.length > 0 ? sceneCharacters.map(char => (
                    <div key={char.id} className="ls-cast-chip">
                        {char.avatar ? (
                            <img src={char.avatar} alt="" />
                        ) : (
                            <span className="ls-cast-fallback"><UserCircle size={18} weight="fill" /></span>
                        )}
                        <span>{char.name}</span>
                    </div>
                )) : (
                    <div className="ls-cast-chip ls-cast-chip-empty">
                        <span className="ls-cast-fallback">{getInitial('LoveShow')}</span>
                        <span>节目现场</span>
                    </div>
                )}
            </div>

            <main className="ls-transcript" aria-live="polite">
                {turns.length > 0 ? turns.map(renderTurn) : (
                    <div className="ls-empty-transcript">
                        <Sparkle size={22} weight="fill" />
                        <span>镜头已经打开，等你入场。</span>
                    </div>
                )}
            </main>

            {error && (
                <div className="ls-error" role="status">
                    <span>{error}</span>
                    {canRetry && (
                        <button type="button" onClick={onRetry} className="ls-icon-text-btn">
                            <ArrowCounterClockwise size={16} weight="bold" />
                            重试
                        </button>
                    )}
                </div>
            )}

            <form className="ls-input-bar" onSubmit={handleSubmit}>
                <textarea
                    value={inputValue}
                    onChange={(event) => onInputChange(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            onSend();
                        }
                    }}
                    placeholder="在镜头前说点什么..."
                    aria-label="LoveShow message"
                    rows={1}
                    disabled={isSending}
                />
                <button
                    type="submit"
                    className="ls-round-btn ls-send-btn"
                    disabled={isSending || !inputValue.trim()}
                    aria-label="发送"
                    title="发送"
                >
                    <PaperPlaneTilt size={20} weight="fill" />
                </button>
                <button
                    type="button"
                    className="ls-round-btn ls-finish-btn"
                    onClick={onCompleteScene}
                    disabled={isClosingScene || turns.length === 0}
                    aria-label="收场"
                    title="收场"
                >
                    <CheckCircle size={20} weight="bold" />
                </button>
            </form>
        </section>
    );
};

export default LoveShowScene;
