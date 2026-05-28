import React,{ useEffect,useMemo,useState } from 'react';
import { useOS } from '../../context/OSContext';
import type {
    ImageApiPreset,
    ImageGenerationConfig,
    ImageProviderType,
    NaiImageModel,
    OpenAIImageResponseFormat,
    PhotoStylePreset,
} from '../../types';
import {
    NAI_IMAGE_MODELS,
    OPENAI_IMAGE_RESPONSE_FORMATS,
    clearImageGenerationDraftConfig,
    getImageGenerationDraftConfig,
    setImageGenerationDraftConfig,
} from '../../utils/runtimeConfig';
import { getGuardedInputProps } from '../../utils/inputGuards';
import { getImageProviderLabel,testOpenAICompatibleImageConnection } from '../../utils/photoGeneration';

const providerOptions: Array<{ id: ImageProviderType; label: string; hint: string }> = [
    { id: 'novelai', label: 'NovelAI', hint: 'Persistent API Token' },
    { id: 'openai-compatible', label: 'OpenAI 兼容', hint: '/images/generations 接口' },
];

type StylePresetDraft = {
    name: string;
    positivePrompt: string;
    negativePrompt: string;
};

const createEmptyStylePresetDraft = (): StylePresetDraft => ({
    name: '',
    positivePrompt: '',
    negativePrompt: '',
});

const providerScopeLabels: Record<PhotoStylePreset['providerScope'], string> = {
    all: '旧版通用',
    novelai: 'NovelAI',
    'openai-compatible': 'OpenAI 兼容',
};

interface PhotoStylePresetListProps {
    presets: PhotoStylePreset[];
    emptyText: string;
    positiveLabel: string;
    negativeLabel: string;
    onExport: (preset: PhotoStylePreset) => void;
    onRemove: (id: string) => void;
}

const PhotoStylePresetList: React.FC<PhotoStylePresetListProps> = ({
    presets,
    emptyText,
    positiveLabel,
    negativeLabel,
    onExport,
    onRemove,
}) => {
    if (presets.length === 0) {
        return (
            <div className="rounded-2xl bg-slate-50/80 border border-dashed border-slate-200 px-4 py-5 text-center text-[11px] text-slate-400">
                {emptyText}
            </div>
        );
    }

    return (
        <div className="max-w-full space-y-3">
            {presets.map(preset => (
                <div key={preset.id} className="max-w-full overflow-hidden rounded-2xl bg-slate-50/80 border border-slate-100 p-3">
                    <div className="flex items-start justify-between gap-3 min-w-0">
                        <div className="min-w-0">
                            <div className="text-sm font-bold text-slate-700 truncate">{preset.name}</div>
                            <div className="text-[10px] text-slate-400 font-mono truncate">{preset.id} · {providerScopeLabels[preset.providerScope]}</div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5 shrink-0">
                            <button type="button" onClick={() => onExport(preset)} className="px-2.5 py-1.5 rounded-lg bg-white text-[10px] font-bold text-slate-500 border border-slate-100">复制</button>
                            <button type="button" onClick={() => onRemove(preset.id)} className="px-2.5 py-1.5 rounded-lg bg-red-50 text-[10px] font-bold text-red-400 border border-red-100">删除</button>
                        </div>
                    </div>
                    <div className="mt-2 space-y-1.5 text-[10px] leading-relaxed text-slate-500">
                        <p className="line-clamp-2 break-words"><span className="font-bold text-slate-400">{positiveLabel}：</span>{preset.positivePrompt}</p>
                        {preset.negativePrompt && (
                            <p className="line-clamp-2 break-words"><span className="font-bold text-slate-400">{negativeLabel}：</span>{preset.negativePrompt}</p>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};

const ImageGenerationSettings: React.FC = () => {
    const {
        imageGenerationConfig,
        updateImageGenerationConfig,
        imageApiPresets,
        saveImageApiPresets,
        photoStylePresets,
        savePhotoStylePresets,
        addToast,
    } = useOS();

    const [localConfig, setLocalConfig] = useState<ImageGenerationConfig>(() => getImageGenerationDraftConfig() || imageGenerationConfig);
    const [apiPresetName, setApiPresetName] = useState('');
    const [naiPresetDraft, setNaiPresetDraft] = useState<StylePresetDraft>(createEmptyStylePresetDraft);
    const [openAIPresetDraft, setOpenAIPresetDraft] = useState<StylePresetDraft>(createEmptyStylePresetDraft);
    const [fetchedModels, setFetchedModels] = useState<string[]>([]);
    const [isFetchingModels, setIsFetchingModels] = useState(false);

    useEffect(() => {
        setLocalConfig(getImageGenerationDraftConfig() || imageGenerationConfig);
    }, [imageGenerationConfig]);

    const updateLocalConfig = (updater: (prev: ImageGenerationConfig) => ImageGenerationConfig) => {
        setLocalConfig(prev => {
            const next = updater(prev);
            setImageGenerationDraftConfig(next);
            return next;
        });
    };

    const updateProvider = (provider: ImageProviderType) => {
        updateLocalConfig(prev => ({ ...prev, activeProvider: provider }));
    };

    const updateNovelAI = <K extends keyof ImageGenerationConfig['novelai']>(key: K, value: ImageGenerationConfig['novelai'][K]) => {
        updateLocalConfig(prev => ({ ...prev, novelai: { ...prev.novelai, [key]: value } }));
    };

    const updateOpenAICompatible = <K extends keyof ImageGenerationConfig['openaiCompatible']>(key: K, value: ImageGenerationConfig['openaiCompatible'][K]) => {
        updateLocalConfig(prev => ({ ...prev, openaiCompatible: { ...prev.openaiCompatible, [key]: value } }));
        if (key === 'baseUrl' || key === 'apiKey') {
            setFetchedModels([]);
        }
    };

    const naiStylePresets = useMemo(
        () => photoStylePresets.filter(preset => preset.providerScope === 'novelai'),
        [photoStylePresets],
    );

    const openAIStylePresets = useMemo(
        () => photoStylePresets.filter(preset => preset.providerScope === 'openai-compatible'),
        [photoStylePresets],
    );

    const sharedStylePresets = useMemo(
        () => photoStylePresets.filter(preset => preset.providerScope === 'all'),
        [photoStylePresets],
    );

    const saveConfig = () => {
        updateImageGenerationConfig(localConfig);
        clearImageGenerationDraftConfig();
        addToast('生图配置已保存', 'success');
    };

    const saveApiPreset = () => {
        const now = Date.now();
        const preset: ImageApiPreset = {
            id: `image-api-${now}`,
            name: apiPresetName.trim() || `${activeLabel} 配置`,
            config: localConfig,
            createdAt: now,
            updatedAt: now,
        };
        saveImageApiPresets([preset, ...imageApiPresets]);
        setApiPresetName('');
        addToast('生图 API 预设已保存', 'success');
    };

    const applyApiPreset = (preset: ImageApiPreset) => {
        setLocalConfig(preset.config);
        updateImageGenerationConfig(preset.config);
        clearImageGenerationDraftConfig();
        addToast(`已切换到「${preset.name}」`, 'success');
    };

    const removeApiPreset = (id: string) => {
        saveImageApiPresets(imageApiPresets.filter(preset => preset.id !== id));
        addToast('生图 API 预设已删除', 'success');
    };

    const saveDraftPreset = (provider: ImageProviderType, draft: StylePresetDraft, resetDraft: () => void) => {
        const positivePrompt = draft.positivePrompt.trim();
        if (!positivePrompt) {
            addToast(provider === 'novelai' ? '请先填写 NAI 正向提示词' : '请先填写 OpenAI 风格描述', 'error');
            return;
        }
        const preset: PhotoStylePreset = {
            id: `style-${provider}-${Date.now()}`,
            name: draft.name.trim() || (provider === 'novelai' ? '新的 NAI 风格' : '新的 OpenAI 风格'),
            providerScope: provider,
            positivePrompt,
            negativePrompt: draft.negativePrompt.trim(),
        };
        savePhotoStylePresets([...photoStylePresets, preset]);
        resetDraft();
        addToast(provider === 'novelai' ? 'NAI 风格预设已保存' : 'OpenAI 风格预设已保存', 'success');
    };

    const removePreset = (id: string) => {
        if (photoStylePresets.length <= 1) {
            addToast('至少保留一个风格预设', 'info');
            return;
        }
        savePhotoStylePresets(photoStylePresets.filter(preset => preset.id !== id));
        addToast('风格预设已删除', 'success');
    };

    const exportPreset = async (preset: PhotoStylePreset) => {
        const text = JSON.stringify(preset, null, 2);
        try {
            await navigator.clipboard.writeText(text);
            addToast('预设 JSON 已复制', 'success');
        } catch {
            addToast(text.slice(0, 180), 'info');
        }
    };

    const fetchOpenAICompatibleModels = async () => {
        setIsFetchingModels(true);
        try {
            const result = await testOpenAICompatibleImageConnection(localConfig.openaiCompatible);
            setFetchedModels(result.models);
            if (result.models.length > 0 && !localConfig.openaiCompatible.model.trim()) {
                updateOpenAICompatible('model', result.models[0]);
            }
            addToast(result.message, result.ok ? 'success' : 'error');
        } catch (error: any) {
            addToast(error?.message || '模型拉取失败', 'error');
        } finally {
            setIsFetchingModels(false);
        }
    };

    const activeLabel = getImageProviderLabel(localConfig.activeProvider);

    return (
        <div className="max-w-full space-y-5 overflow-hidden">
            <section className="w-full max-w-full overflow-hidden bg-white/60 backdrop-blur-sm rounded-3xl p-4 sm:p-5 shadow-sm border border-white/50">
                <div className="mb-4">
                    <h2 className="text-sm font-semibold text-slate-600 tracking-wider">生图服务</h2>
                    <p className="text-[10px] text-slate-400 mt-1">当前使用 {activeLabel}，手动生图和角色主动发照片都会走这里。</p>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-4 min-w-0">
                    {providerOptions.map(option => {
                        const active = localConfig.activeProvider === option.id;
                        return (
                            <button
                                key={option.id}
                                type="button"
                                onClick={() => updateProvider(option.id)}
                                className={`min-w-0 rounded-2xl border px-3 py-2 text-left transition-colors ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white/60 text-slate-500 border-slate-100'}`}
                            >
                                <div className="truncate text-xs font-bold">{option.label}</div>
                                <div className={`mt-0.5 truncate text-[9px] ${active ? 'text-white/65' : 'text-slate-400'}`}>{option.hint}</div>
                            </button>
                        );
                    })}
                </div>

                <div className="mb-4 space-y-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
                    <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <h3 className="truncate text-xs font-bold text-slate-600">API 配置预设</h3>
                            <p className="mt-0.5 truncate text-[10px] text-slate-400">保存 token、base url、模型和参数。</p>
                        </div>
                    </div>
                    {imageApiPresets.length > 0 && (
                        <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
                            {imageApiPresets.map(preset => (
                                <div key={preset.id} className="min-w-[180px] max-w-[220px] rounded-xl border border-white bg-white/90 p-2 shadow-sm">
                                    <button
                                        type="button"
                                        onClick={() => applyApiPreset(preset)}
                                        className="block w-full min-w-0 text-left"
                                    >
                                        <span className="block truncate text-xs font-bold text-slate-700">{preset.name}</span>
                                        <span className="mt-0.5 block truncate text-[9px] font-mono text-slate-400">
                                            {getImageProviderLabel(preset.config.activeProvider)}
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => removeApiPreset(preset.id)}
                                        className="mt-2 rounded-lg bg-red-50 px-2 py-1 text-[10px] font-bold text-red-400"
                                    >
                                        删除
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="flex min-w-0 gap-2">
                        <input
                            value={apiPresetName}
                            onChange={e => setApiPresetName(e.target.value)}
                            placeholder="预设名称（可选）"
                            className="min-w-0 flex-1 rounded-xl border border-slate-200/60 bg-white/70 px-3 py-2 text-xs"
                        />
                        <button
                            type="button"
                            onClick={saveApiPreset}
                            className="shrink-0 rounded-xl bg-primary px-3 py-2 text-[10px] font-bold text-white"
                        >
                            保存预设
                        </button>
                    </div>
                </div>

                {localConfig.activeProvider === 'novelai' ? (
                    <div className="space-y-4">
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">API URL</label>
                            <input
                                type="text"
                                value={localConfig.novelai.apiUrl}
                                onChange={e => updateNovelAI('apiUrl', e.target.value)}
                                className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono"
                                {...getGuardedInputProps({ kind: 'url', field: 'nai-api-url' })}
                            />
                        </div>

                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">Persistent API Token</label>
                            <input
                                type="text"
                                value={localConfig.novelai.apiToken}
                                onChange={e => updateNovelAI('apiToken', e.target.value)}
                                placeholder="NAI token..."
                                className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono"
                                {...getGuardedInputProps({ kind: 'secret', field: 'nai-api-token' })}
                            />
                        </div>

                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">默认模型</label>
                            <select
                                value={localConfig.novelai.model}
                                onChange={e => updateNovelAI('model', e.target.value as NaiImageModel)}
                                className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono"
                            >
                                {NAI_IMAGE_MODELS.map(model => <option key={model} value={model}>{model}</option>)}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-3 min-w-0">
                            <label className="min-w-0 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                宽度
                                <input type="number" min={64} max={1600} step={64} value={localConfig.novelai.width} onChange={e => updateNovelAI('width', Number(e.target.value))} className="mt-1.5 w-full bg-white/50 border border-slate-200/60 rounded-xl px-3 py-2 text-sm font-mono" />
                            </label>
                            <label className="min-w-0 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                高度
                                <input type="number" min={64} max={1600} step={64} value={localConfig.novelai.height} onChange={e => updateNovelAI('height', Number(e.target.value))} className="mt-1.5 w-full bg-white/50 border border-slate-200/60 rounded-xl px-3 py-2 text-sm font-mono" />
                            </label>
                            <label className="min-w-0 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Steps
                                <input type="number" min={1} max={50} value={localConfig.novelai.steps} onChange={e => updateNovelAI('steps', Number(e.target.value))} className="mt-1.5 w-full bg-white/50 border border-slate-200/60 rounded-xl px-3 py-2 text-sm font-mono" />
                            </label>
                            <label className="min-w-0 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Scale
                                <input type="number" min={0} max={10} step={0.1} value={localConfig.novelai.scale} onChange={e => updateNovelAI('scale', Number(e.target.value))} className="mt-1.5 w-full bg-white/50 border border-slate-200/60 rounded-xl px-3 py-2 text-sm font-mono" />
                            </label>
                        </div>

                        <div className="grid grid-cols-2 gap-3 min-w-0">
                            <label className="min-w-0 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Sampler
                                <input value={localConfig.novelai.sampler} onChange={e => updateNovelAI('sampler', e.target.value)} className="mt-1.5 w-full bg-white/50 border border-slate-200/60 rounded-xl px-3 py-2 text-sm font-mono" />
                            </label>
                            <label className="min-w-0 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Schedule
                                <input value={localConfig.novelai.noiseSchedule} onChange={e => updateNovelAI('noiseSchedule', e.target.value)} className="mt-1.5 w-full bg-white/50 border border-slate-200/60 rounded-xl px-3 py-2 text-sm font-mono" />
                            </label>
                        </div>

                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                            全局质量提示词
                            <textarea value={localConfig.novelai.qualityTags} onChange={e => updateNovelAI('qualityTags', e.target.value)} className="mt-1.5 w-full h-20 bg-white/50 border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-mono resize-none" />
                        </label>

                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                            全局负面提示词
                            <textarea value={localConfig.novelai.negativePrompt} onChange={e => updateNovelAI('negativePrompt', e.target.value)} className="mt-1.5 w-full h-24 bg-white/50 border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-mono resize-none" />
                        </label>
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">Base URL</label>
                            <input
                                type="text"
                                value={localConfig.openaiCompatible.baseUrl}
                                onChange={e => updateOpenAICompatible('baseUrl', e.target.value)}
                                placeholder="https://api.example.com/v1"
                                className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono"
                                {...getGuardedInputProps({ kind: 'url', field: 'image-compatible-base-url' })}
                            />
                        </div>

                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">API Key</label>
                            <input
                                type="text"
                                value={localConfig.openaiCompatible.apiKey}
                                onChange={e => updateOpenAICompatible('apiKey', e.target.value)}
                                placeholder="sk-..."
                                className="w-full bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono"
                                {...getGuardedInputProps({ kind: 'secret', field: 'image-compatible-api-key' })}
                            />
                        </div>

                        <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 block pl-1">模型名</label>
                            <div className="flex gap-2">
                                <input
                                    value={localConfig.openaiCompatible.model}
                                    onChange={e => updateOpenAICompatible('model', e.target.value)}
                                    placeholder="gpt-image-1"
                                    className="min-w-0 flex-1 bg-white/50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm font-mono"
                                />
                                <button
                                    type="button"
                                    onClick={fetchOpenAICompatibleModels}
                                    disabled={isFetchingModels}
                                    className="shrink-0 px-3 rounded-xl bg-white border border-slate-200 text-[10px] font-bold text-slate-500 disabled:opacity-50"
                                >
                                    {isFetchingModels ? '拉取中' : '拉取模型'}
                                </button>
                            </div>
                            {fetchedModels.length > 0 && (
                                <select
                                    value={localConfig.openaiCompatible.model}
                                    onChange={e => updateOpenAICompatible('model', e.target.value)}
                                    className="mt-2 w-full bg-slate-50 border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-mono"
                                >
                                    {fetchedModels.map(model => <option key={model} value={model}>{model}</option>)}
                                </select>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-3 min-w-0">
                            <label className="min-w-0 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Size
                                <input value={localConfig.openaiCompatible.size} onChange={e => updateOpenAICompatible('size', e.target.value)} placeholder="1024x1024" className="mt-1.5 w-full bg-white/50 border border-slate-200/60 rounded-xl px-3 py-2 text-sm font-mono" />
                            </label>
                            <label className="min-w-0 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                Response
                                <select value={localConfig.openaiCompatible.responseFormat} onChange={e => updateOpenAICompatible('responseFormat', e.target.value as OpenAIImageResponseFormat)} className="mt-1.5 w-full bg-white/50 border border-slate-200/60 rounded-xl px-3 py-2 text-sm font-mono">
                                    {OPENAI_IMAGE_RESPONSE_FORMATS.map(format => <option key={format} value={format}>{format}</option>)}
                                </select>
                            </label>
                        </div>

                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                            全局自然语言画质
                            <textarea value={localConfig.openaiCompatible.qualityTags} onChange={e => updateOpenAICompatible('qualityTags', e.target.value)} className="mt-1.5 w-full h-20 bg-white/50 border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-mono resize-none" />
                        </label>

                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">
                            全局避免内容
                            <textarea value={localConfig.openaiCompatible.negativePrompt} onChange={e => updateOpenAICompatible('negativePrompt', e.target.value)} className="mt-1.5 w-full h-24 bg-white/50 border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-mono resize-none" />
                        </label>
                    </div>
                )}

                <button onClick={saveConfig} className="mt-4 w-full py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold active:scale-95 transition-transform">
                    保存生图配置
                </button>
            </section>

            <section className="w-full max-w-full overflow-hidden bg-white/60 backdrop-blur-sm rounded-3xl p-4 sm:p-5 shadow-sm border border-white/50">
                <div className="mb-4">
                    <h2 className="text-sm font-semibold text-slate-600 tracking-wider">风格预设库</h2>
                    <p className="text-[10px] text-slate-400 mt-1">NovelAI 使用 tag 正负向；OpenAI 兼容使用自然语言风格描述。</p>
                </div>

                <div className="grid min-w-0 gap-6 lg:grid-cols-2">
                    <div className="min-w-0 space-y-3">
                        <div>
                            <h3 className="text-xs font-bold text-slate-600">NovelAI Tag 预设</h3>
                            <p className="text-[10px] text-slate-400 mt-1">正向和负向分开保存，只用于 NAI。</p>
                        </div>

                        <PhotoStylePresetList
                            presets={naiStylePresets}
                            emptyText="还没有 NAI 风格预设"
                            positiveLabel="正向"
                            negativeLabel="负向"
                            onExport={exportPreset}
                            onRemove={removePreset}
                        />

                        <div className="space-y-3 border-t border-slate-100 pt-4">
                            <input
                                value={naiPresetDraft.name}
                                onChange={e => setNaiPresetDraft(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="NAI 风格名称（可选）"
                                className="w-full bg-slate-50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm"
                            />
                            <textarea
                                value={naiPresetDraft.positivePrompt}
                                onChange={e => setNaiPresetDraft(prev => ({ ...prev, positivePrompt: e.target.value }))}
                                placeholder="正向提示词 / Positive tags..."
                                className="w-full h-28 bg-slate-50 border border-slate-200/60 rounded-2xl p-4 text-xs font-mono resize-none"
                            />
                            <textarea
                                value={naiPresetDraft.negativePrompt}
                                onChange={e => setNaiPresetDraft(prev => ({ ...prev, negativePrompt: e.target.value }))}
                                placeholder="负向提示词 / Negative tags..."
                                className="w-full h-24 bg-slate-50 border border-slate-200/60 rounded-2xl p-4 text-xs font-mono resize-none"
                            />
                            <button
                                type="button"
                                onClick={() => saveDraftPreset('novelai', naiPresetDraft, () => setNaiPresetDraft(createEmptyStylePresetDraft()))}
                                className="w-full py-3 bg-primary text-white rounded-2xl text-sm font-bold active:scale-95 transition-transform"
                            >
                                保存 NAI 风格
                            </button>
                        </div>
                    </div>

                    <div className="min-w-0 space-y-3">
                        <div>
                            <h3 className="text-xs font-bold text-slate-600">OpenAI 兼容自然语言风格</h3>
                            <p className="text-[10px] text-slate-400 mt-1">用摄影、插画、氛围描述来写，只用于 OpenAI 兼容接口。</p>
                        </div>

                        <PhotoStylePresetList
                            presets={openAIStylePresets}
                            emptyText="还没有 OpenAI 兼容风格"
                            positiveLabel="风格"
                            negativeLabel="避免"
                            onExport={exportPreset}
                            onRemove={removePreset}
                        />

                        <div className="space-y-3 border-t border-slate-100 pt-4">
                            <input
                                value={openAIPresetDraft.name}
                                onChange={e => setOpenAIPresetDraft(prev => ({ ...prev, name: e.target.value }))}
                                placeholder="OpenAI 风格名称（可选）"
                                className="w-full bg-slate-50 border border-slate-200/60 rounded-xl px-4 py-2.5 text-sm"
                            />
                            <textarea
                                value={openAIPresetDraft.positivePrompt}
                                onChange={e => setOpenAIPresetDraft(prev => ({ ...prev, positivePrompt: e.target.value }))}
                                placeholder="自然语言风格描述..."
                                className="w-full h-28 bg-slate-50 border border-slate-200/60 rounded-2xl p-4 text-xs resize-none"
                            />
                            <textarea
                                value={openAIPresetDraft.negativePrompt}
                                onChange={e => setOpenAIPresetDraft(prev => ({ ...prev, negativePrompt: e.target.value }))}
                                placeholder="需要避免的画面内容（可选）..."
                                className="w-full h-24 bg-slate-50 border border-slate-200/60 rounded-2xl p-4 text-xs resize-none"
                            />
                            <button
                                type="button"
                                onClick={() => saveDraftPreset('openai-compatible', openAIPresetDraft, () => setOpenAIPresetDraft(createEmptyStylePresetDraft()))}
                                className="w-full py-3 bg-slate-900 text-white rounded-2xl text-sm font-bold active:scale-95 transition-transform"
                            >
                                保存 OpenAI 风格
                            </button>
                        </div>
                    </div>
                </div>

                {sharedStylePresets.length > 0 && (
                    <div className="mt-6 border-t border-slate-100 pt-4">
                        <div className="mb-3">
                            <h3 className="text-xs font-bold text-slate-500">旧版通用预设</h3>
                            <p className="text-[10px] text-slate-400 mt-1">这些是旧数据里的 all 作用域，建议复制内容后分别保存到 NAI 或 OpenAI。</p>
                        </div>
                        <PhotoStylePresetList
                            presets={sharedStylePresets}
                            emptyText=""
                            positiveLabel="内容"
                            negativeLabel="避免"
                            onExport={exportPreset}
                            onRemove={removePreset}
                        />
                    </div>
                )}
            </section>
        </div>
    );
};

export default ImageGenerationSettings;
