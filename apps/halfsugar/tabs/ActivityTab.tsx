/**
 * ActivityTab — Exercise recording and today's activity summary
 */
import React, { useMemo, useState } from 'react';
import { useHalfSugar, parsePositiveNumber } from '../HalfSugarContext';
import { BottomSheetModal } from '../HalfSugarTrackingUI';
import { estimateCaloriesBurned, MET_TABLE } from '../types';

const ActivityTab: React.FC = () => {
    const {
        todayExercises, todayExerciseCalories, latestKnownWeightKg,
        handleSaveExercise, handleDeleteExercise, addToast,
    } = useHalfSugar();

    const [showModal, setShowModal] = useState(false);
    const [exerciseType, setExerciseType] = useState(Object.keys(MET_TABLE)[0] || 'walking_slow');
    const [durationMinutes, setDurationMinutes] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const selectedMeta = MET_TABLE[exerciseType] || Object.values(MET_TABLE)[0];
    const previewCalories = useMemo(() => {
        const dur = parsePositiveNumber(durationMinutes);
        return dur && selectedMeta ? estimateCaloriesBurned(selectedMeta.met, latestKnownWeightKg, dur) : 0;
    }, [durationMinutes, latestKnownWeightKg, selectedMeta]);

    const handleSave = async () => {
        const dur = parsePositiveNumber(durationMinutes);
        if (!dur) { addToast('请输入运动时长', 'error'); return; }
        setIsSaving(true);
        const ok = await handleSaveExercise(exerciseType, dur);
        setIsSaving(false);
        if (ok) { setShowModal(false); setDurationMinutes(''); }
    };

    return (
        <div className="hs-tab-content no-scrollbar">
            <div className="hs-section-title">
                <span>今日运动</span>
                <span>{todayExerciseCalories > 0 ? `−${todayExerciseCalories} kcal` : ''}</span>
            </div>

            {todayExercises.length > 0 ? (
                <div className="hs-track-list" style={{ margin: '0 20px 16px' }}>
                    {todayExercises.map((exercise) => (
                        <div key={exercise.id} className="hs-track-list-item">
                            <div>
                                <div className="hs-track-list-title">{exercise.exerciseLabel}</div>
                                <div className="hs-track-subtitle">{exercise.durationMinutes} 分钟 · {Math.round(exercise.caloriesBurned)} kcal</div>
                            </div>
                            <button type="button" className="hs-track-delete-btn" onClick={() => handleDeleteExercise(exercise.id)}>删除</button>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="hs-loading-card" style={{ color: 'var(--hs-text-muted)' }}>还没有运动记录</div>
            )}

            <button type="button" className="hs-meal-add hs-animate-fade-in" onClick={() => setShowModal(true)} style={{ marginBottom: 16 }}>
                <span>＋</span> 记录运动
            </button>

            {/* Exercise type reference grid */}
            <div className="hs-section-title"><span>运动类型</span></div>
            <div className="hs-exercise-grid" style={{ margin: '0 20px 20px' }}>
                {Object.entries(MET_TABLE).map(([key, item]) => (
                    <div key={key} className="hs-exercise-option" style={{ cursor: 'default', opacity: 0.7 }}>
                        <span className="hs-exercise-emoji">{item.emoji}</span>
                        <span>{item.label}</span>
                    </div>
                ))}
            </div>

            {showModal && (
                <BottomSheetModal title="记录运动" onClose={() => setShowModal(false)}>
                    <div className="hs-exercise-grid">
                        {Object.entries(MET_TABLE).map(([key, item]) => (
                            <button key={key} type="button" className={`hs-exercise-option ${exerciseType === key ? 'active' : ''}`} onClick={() => setExerciseType(key)}>
                                <span className="hs-exercise-emoji">{item.emoji}</span>
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>
                    <div className="hs-form-input-with-unit">
                        <input type="number" inputMode="numeric" className="hs-form-input" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} placeholder="30" />
                        <span className="hs-unit">min</span>
                    </div>
                    <div className="hs-track-subtitle">预计消耗 {previewCalories} kcal</div>
                    <button type="button" className="hs-submit-btn hs-modal-submit-btn" onClick={handleSave} disabled={isSaving}>保存运动</button>
                </BottomSheetModal>
            )}
        </div>
    );
};

export default ActivityTab;
