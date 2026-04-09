import React, { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { getCityInputTips, type CityTip } from '../../utils/mapService';

const CITY_SUGGESTION_LIMIT = 6;
const CITY_SEARCH_DEBOUNCE_MS = 250;
const FICTIONAL_CITY_SAVE_DEBOUNCE_MS = 180;
const BLUR_CLOSE_DELAY_MS = 120;

type CityFieldKey = 'cityOverride' | 'cityAdcode' | 'isFictionalCity' | 'cityReferenceReal';
type CityFieldValue = string | boolean | undefined;
type CityFieldPatch = Partial<Record<CityFieldKey, CityFieldValue>>;

interface CharacterCitySectionProps {
    characterId: string;
    cityOverride?: string;
    cityAdcode?: string;
    isFictionalCity?: boolean;
    cityReferenceReal?: string;
    onFieldChange: (field: CityFieldKey, value: string | boolean | undefined) => void;
    onImmediatePatchCommit?: (patch: CityFieldPatch) => void;
}

export interface CharacterCitySectionHandle {
    flushPendingDraft: () => void;
}

interface CityAutocompleteState {
    debouncedKeyword: string;
    error: string | null;
    isFocused: boolean;
    isLoading: boolean;
    suggestions: CityTip[];
    handleBlur: () => void;
    handleFocus: () => void;
    reset: () => void;
}

function getCityTipMeta(tip: CityTip): string {
    return [tip.district, tip.adcode].filter(Boolean).join(' · ');
}

function getAutocompleteErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message;
    }
    return '城市搜索失败，请稍后再试';
}

function useCityAutocomplete(keyword: string, enabled: boolean, selectedValue?: string): CityAutocompleteState {
    const [debouncedKeyword, setDebouncedKeyword] = useState('');
    const [suggestions, setSuggestions] = useState<CityTip[]>([]);
    const [isFocused, setIsFocused] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const blurTimerRef = useRef<number | null>(null);
    const requestSequenceRef = useRef(0);

    useEffect(() => {
        return () => {
            if (blurTimerRef.current !== null) {
                window.clearTimeout(blurTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        const trimmedKeyword = keyword.trim();

        if (!enabled || !trimmedKeyword) {
            requestSequenceRef.current += 1;
            setDebouncedKeyword('');
            setSuggestions([]);
            setIsLoading(false);
            setError(null);
            return;
        }

        const timer = window.setTimeout(() => {
            setDebouncedKeyword(trimmedKeyword);
        }, CITY_SEARCH_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timer);
        };
    }, [keyword, enabled]);

    useEffect(() => {
        const trimmedSelectedValue = selectedValue?.trim() || '';

        if (!enabled || !debouncedKeyword || debouncedKeyword === trimmedSelectedValue) {
            requestSequenceRef.current += 1;
            setSuggestions([]);
            setIsLoading(false);
            setError(null);
            return;
        }

        const requestId = requestSequenceRef.current + 1;
        requestSequenceRef.current = requestId;
        let active = true;

        setIsLoading(true);
        setError(null);

        getCityInputTips(debouncedKeyword)
            .then((tips) => {
                if (!active || requestSequenceRef.current !== requestId) {
                    return;
                }
                setSuggestions(tips.slice(0, CITY_SUGGESTION_LIMIT));
                setIsLoading(false);
            })
            .catch((searchError) => {
                if (!active || requestSequenceRef.current !== requestId) {
                    return;
                }
                setSuggestions([]);
                setError(getAutocompleteErrorMessage(searchError));
                setIsLoading(false);
            });

        return () => {
            active = false;
        };
    }, [debouncedKeyword, enabled, selectedValue]);

    const reset = () => {
        requestSequenceRef.current += 1;
        setDebouncedKeyword('');
        setSuggestions([]);
        setIsLoading(false);
        setError(null);
        setIsFocused(false);
    };

    const handleFocus = () => {
        if (blurTimerRef.current !== null) {
            window.clearTimeout(blurTimerRef.current);
            blurTimerRef.current = null;
        }
        setIsFocused(true);
    };

    const handleBlur = () => {
        if (blurTimerRef.current !== null) {
            window.clearTimeout(blurTimerRef.current);
        }
        blurTimerRef.current = window.setTimeout(() => {
            setIsFocused(false);
            blurTimerRef.current = null;
        }, BLUR_CLOSE_DELAY_MS);
    };

    return {
        debouncedKeyword,
        error,
        isFocused,
        isLoading,
        suggestions,
        handleBlur,
        handleFocus,
        reset,
    };
}

function SuggestionList({
    suggestions,
    onSelect,
}: {
    suggestions: CityTip[];
    onSelect: (tip: CityTip) => void;
}) {
    return (
        <div className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-xl shadow-slate-200/70">
            {suggestions.map((tip) => (
                <button
                    key={`${tip.name}-${tip.adcode || tip.district}`}
                    type="button"
                    onMouseDown={(event) => {
                        event.preventDefault();
                        onSelect(tip);
                    }}
                    className="w-full border-b border-slate-100 px-4 py-3 text-left last:border-b-0 hover:bg-slate-50 transition-colors"
                >
                    <div className="text-sm font-medium text-slate-700">{tip.name}</div>
                    {getCityTipMeta(tip) && (
                        <div className="mt-0.5 text-[10px] text-slate-400">{getCityTipMeta(tip)}</div>
                    )}
                </button>
            ))}
        </div>
    );
}

const CharacterCitySectionComponent = ({
    characterId,
    cityOverride,
    cityAdcode,
    isFictionalCity,
    cityReferenceReal,
    onFieldChange,
    onImmediatePatchCommit,
}: CharacterCitySectionProps, ref: React.ForwardedRef<CharacterCitySectionHandle>) => {
    const [cityKeyword, setCityKeyword] = useState(cityOverride || '');
    const [referenceCityKeyword, setReferenceCityKeyword] = useState(cityReferenceReal || '');

    const cityAutocomplete = useCityAutocomplete(cityKeyword, !isFictionalCity, cityOverride);
    const referenceAutocomplete = useCityAutocomplete(referenceCityKeyword, Boolean(isFictionalCity), cityReferenceReal);

    const fictionalCityTimerRef = useRef<number | null>(null);
    const pendingFictionalCityPatchRef = useRef<CityFieldPatch | null>(null);

    const clearPendingFictionalCityTimer = () => {
        if (fictionalCityTimerRef.current !== null) {
            window.clearTimeout(fictionalCityTimerRef.current);
            fictionalCityTimerRef.current = null;
        }
    };

    const applyFieldPatch = (patch: CityFieldPatch, immediate: boolean) => {
        if (immediate && onImmediatePatchCommit) {
            onImmediatePatchCommit(patch);
            return;
        }

        (Object.entries(patch) as Array<[CityFieldKey, CityFieldValue]>).forEach(([field, value]) => {
            onFieldChange(field, value);
        });
    };

    const flushPendingFictionalCityPatch = (immediate: boolean) => {
        const pendingPatch = pendingFictionalCityPatchRef.current;
        if (!pendingPatch) {
            return;
        }

        clearPendingFictionalCityTimer();
        pendingFictionalCityPatchRef.current = null;
        applyFieldPatch(pendingPatch, immediate);
    };

    useImperativeHandle(ref, () => ({
        flushPendingDraft: () => {
            flushPendingFictionalCityPatch(true);
        },
    }));

    useEffect(() => {
        setCityKeyword(cityOverride || '');
    }, [characterId, cityOverride]);

    useEffect(() => {
        setReferenceCityKeyword(cityReferenceReal || '');
    }, [characterId, cityReferenceReal]);

    useEffect(() => {
        if (!isFictionalCity) {
            clearPendingFictionalCityTimer();
            pendingFictionalCityPatchRef.current = null;
            return;
        }

        const nextCityValue = cityKeyword.trim() || undefined;
        const currentCityValue = cityOverride?.trim() || undefined;
        if (nextCityValue === currentCityValue) {
            clearPendingFictionalCityTimer();
            pendingFictionalCityPatchRef.current = null;
            return;
        }

        const nextPatch: CityFieldPatch = {
            cityOverride: nextCityValue,
        };
        if (!nextCityValue) {
            nextPatch.cityAdcode = undefined;
        }

        pendingFictionalCityPatchRef.current = nextPatch;
        clearPendingFictionalCityTimer();
        fictionalCityTimerRef.current = window.setTimeout(() => {
            flushPendingFictionalCityPatch(false);
        }, FICTIONAL_CITY_SAVE_DEBOUNCE_MS);

        return () => {
            clearPendingFictionalCityTimer();
        };
    }, [cityKeyword, cityOverride, isFictionalCity, onFieldChange, onImmediatePatchCommit]);

    // Flush any pending fictional city value on unmount
    useEffect(() => {
        return () => {
            flushPendingFictionalCityPatch(true);
        };
    }, [onFieldChange, onImmediatePatchCommit]);

    const cityHasKeyword = cityAutocomplete.debouncedKeyword.length > 0;
    const showCitySuggestions = cityAutocomplete.isFocused && !isFictionalCity && cityHasKeyword && cityAutocomplete.suggestions.length > 0;
    const showCityEmptyState = cityAutocomplete.isFocused && !isFictionalCity && cityHasKeyword && !cityAutocomplete.isLoading && !cityAutocomplete.error && cityAutocomplete.suggestions.length === 0;
    const showCityError = cityAutocomplete.isFocused && !isFictionalCity && cityHasKeyword && Boolean(cityAutocomplete.error);

    const referenceHasKeyword = referenceAutocomplete.debouncedKeyword.length > 0;
    const showReferenceSuggestions = referenceAutocomplete.isFocused && Boolean(isFictionalCity) && referenceHasKeyword && referenceAutocomplete.suggestions.length > 0;
    const showReferenceEmptyState = referenceAutocomplete.isFocused && Boolean(isFictionalCity) && referenceHasKeyword && !referenceAutocomplete.isLoading && !referenceAutocomplete.error && referenceAutocomplete.suggestions.length === 0;
    const showReferenceError = referenceAutocomplete.isFocused && Boolean(isFictionalCity) && referenceHasKeyword && Boolean(referenceAutocomplete.error);

    const handleSelectCityTip = (tip: CityTip) => {
        setCityKeyword(tip.name);
        onFieldChange('cityOverride', tip.name);
        onFieldChange('cityAdcode', tip.adcode || undefined);
        cityAutocomplete.reset();
    };

    const handleSelectReferenceCityTip = (tip: CityTip) => {
        setReferenceCityKeyword(tip.name);
        onFieldChange('cityReferenceReal', tip.name);
        referenceAutocomplete.reset();
    };

    const handleClearCity = () => {
        setCityKeyword('');
        onFieldChange('cityOverride', undefined);
        onFieldChange('cityAdcode', undefined);
        cityAutocomplete.reset();
    };

    const handleClearReferenceCity = () => {
        setReferenceCityKeyword('');
        onFieldChange('cityReferenceReal', undefined);
        referenceAutocomplete.reset();
    };

    return (
        <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">📍 角色所在城市</label>
            <div className="bg-white rounded-3xl p-5 shadow-sm space-y-4">
                <div className="relative">
                    {isFictionalCity && (
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">城市名称</label>
                    )}
                    <div className="relative">
                        <input
                            value={cityKeyword}
                            onChange={(event) => {
                                const nextValue = event.target.value;
                                setCityKeyword(nextValue);

                                if (!isFictionalCity && !nextValue.trim()) {
                                    onFieldChange('cityOverride', undefined);
                                    onFieldChange('cityAdcode', undefined);
                                    cityAutocomplete.reset();
                                }
                            }}
                            onFocus={cityAutocomplete.handleFocus}
                            onBlur={cityAutocomplete.handleBlur}
                            className="w-full bg-slate-50 rounded-2xl border border-slate-100 px-4 py-3 pr-10 text-sm text-slate-700 outline-none focus:ring-1 focus:ring-primary/20 transition-all"
                            placeholder={isFictionalCity ? '输入架空城市名...' : '输入城市名搜索...'}
                        />
                        {cityKeyword && (
                            <button
                                type="button"
                                onClick={handleClearCity}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors"
                                aria-label="清空城市"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                </svg>
                            </button>
                        )}
                    </div>
                    {showCitySuggestions && (
                        <SuggestionList suggestions={cityAutocomplete.suggestions} onSelect={handleSelectCityTip} />
                    )}
                    {!isFictionalCity && cityAutocomplete.isLoading && cityHasKeyword && (
                        <div className="mt-2 text-[10px] text-slate-400">正在搜索城市...</div>
                    )}
                    {showCityError && (
                        <div className="mt-2 text-[10px] text-red-400">{cityAutocomplete.error}</div>
                    )}
                    {showCityEmptyState && (
                        <div className="mt-2 text-[10px] text-slate-400">未找到匹配城市，请换个关键词试试。</div>
                    )}
                    {!isFictionalCity && cityOverride && cityAdcode && (
                        <div className="mt-2 text-[10px] text-slate-400">已绑定地区编码：{cityAdcode}</div>
                    )}
                </div>

                <label className="flex items-center gap-2 text-xs text-slate-500">
                    <input
                        type="checkbox"
                        checked={Boolean(isFictionalCity)}
                        onChange={(event) => {
                            const checked = event.target.checked;
                            onFieldChange('isFictionalCity', checked ? true : undefined);
                            if (checked) {
                                onFieldChange('cityAdcode', undefined);
                                cityAutocomplete.reset();
                            } else {
                                referenceAutocomplete.reset();
                            }
                        }}
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/20"
                    />
                    <span>这是一个架空 / 虚构城市</span>
                </label>

                {isFictionalCity && (
                    <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/80 p-4">
                        <div className="relative">
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block">现实参照城市</label>
                            <div className="relative">
                                <input
                                    value={referenceCityKeyword}
                                    onChange={(event) => {
                                        const nextValue = event.target.value;
                                        setReferenceCityKeyword(nextValue);
                                        if (!nextValue.trim()) {
                                            handleClearReferenceCity();
                                        }
                                    }}
                                    onFocus={referenceAutocomplete.handleFocus}
                                    onBlur={referenceAutocomplete.handleBlur}
                                    className="w-full bg-white rounded-2xl border border-slate-100 px-4 py-3 pr-10 text-sm text-slate-700 outline-none focus:ring-1 focus:ring-primary/20 transition-all"
                                    placeholder="搜索现实参照城市..."
                                />
                                {referenceCityKeyword && (
                                    <button
                                        type="button"
                                        onClick={handleClearReferenceCity}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors"
                                        aria-label="清空参照城市"
                                    >
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                            {showReferenceSuggestions && (
                                <SuggestionList suggestions={referenceAutocomplete.suggestions} onSelect={handleSelectReferenceCityTip} />
                            )}
                            {referenceAutocomplete.isLoading && referenceHasKeyword && (
                                <div className="mt-2 text-[10px] text-slate-400">正在搜索参照城市...</div>
                            )}
                            {showReferenceError && (
                                <div className="mt-2 text-[10px] text-red-400">{referenceAutocomplete.error}</div>
                            )}
                            {showReferenceEmptyState && (
                                <div className="mt-2 text-[10px] text-slate-400">未找到匹配城市，请换个关键词试试。</div>
                            )}
                        </div>

                        <p className="text-[11px] leading-relaxed text-slate-400">
                            💡 系统会基于参照城市的真实地理数据，由 AI 转化为符合世界观的内容。
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

const propsAreEqual = (prev: CharacterCitySectionProps, next: CharacterCitySectionProps) => (
    prev.characterId === next.characterId
    && prev.cityOverride === next.cityOverride
    && prev.cityAdcode === next.cityAdcode
    && prev.isFictionalCity === next.isFictionalCity
    && prev.cityReferenceReal === next.cityReferenceReal
);

const ForwardedCharacterCitySection = forwardRef(CharacterCitySectionComponent);
ForwardedCharacterCitySection.displayName = 'CharacterCitySection';

const CharacterCitySection = memo(ForwardedCharacterCitySection, propsAreEqual);

export default CharacterCitySection;
