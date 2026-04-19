/**
 * DashboardTab — Today's overview with calorie ring, macros, and summary cards
 */
import React from 'react';
import { useHalfSugar } from '../HalfSugarContext';
import { CalorieRing } from '../components/CalorieRing';
import { MacroBar } from '../components/MacroBar';
import { formatDurationMinutes } from '../types';

const DashboardTab: React.FC = () => {
    const {
        activeCalorieTarget, caloriesConsumed, proteinConsumed, carbsConsumed, fatConsumed, fiberConsumed,
        nutrientTargets, recommendations, isMealsLoading, isTrackingLoading,
        latestWeight, latestBmi, todaySleep,
        todayExercises, setActiveTab,
    } = useHalfSugar();

    // Show total exercise duration instead of negative kcal
    const totalExerciseMinutes = todayExercises.reduce((sum, e) => sum + e.durationMinutes, 0);

    return (
        <div className="hs-tab-content no-scrollbar">
            <CalorieRing consumed={caloriesConsumed} target={activeCalorieTarget} />

            <div className="hs-macro-grid">
                <MacroBar label="蛋白" value={proteinConsumed} target={nutrientTargets.protein} color="var(--hs-sage)" />
                <MacroBar label="碳水" value={carbsConsumed} target={nutrientTargets.carbs} color="var(--hs-clay)" />
                <MacroBar label="脂肪" value={fatConsumed} target={nutrientTargets.fat} color="var(--hs-rose)" />
                <MacroBar label="膳食纤维" value={fiberConsumed} target={nutrientTargets.fiber} color="var(--hs-ocean)" />
            </div>

            {/* Quick-access summary cards — 2x2 grid */}
            <div className="hs-dash-grid">
                <div className="hs-track-card hs-animate-fade-in" onClick={() => setActiveTab('nutrition')} role="button" tabIndex={0}>
                    <div className="hs-track-header">
                        <span className="hs-track-title"><span className="hs-emoji">🍽️</span> 饮食</span>
                    </div>
                    <span className="hs-track-value" style={{ fontSize: 16 }}>
                        {isMealsLoading ? '…' : `${caloriesConsumed} kcal`}
                    </span>
                </div>

                <div className="hs-track-card hs-animate-fade-in" onClick={() => setActiveTab('trends')} role="button" tabIndex={0}>
                    <div className="hs-track-header">
                        <span className="hs-track-title"><span className="hs-emoji">⚖️</span> 体重</span>
                    </div>
                    <span className="hs-track-value" style={{ fontSize: 16 }}>
                        {latestWeight ? `${latestWeight.weight} kg` : '—'}
                    </span>
                    {latestBmi && (
                        <div className="hs-track-subtitle" style={{ marginBottom: 0 }}>BMI {latestBmi}</div>
                    )}
                </div>

                <div className="hs-track-card hs-animate-fade-in" onClick={() => setActiveTab('activity')} role="button" tabIndex={0}>
                    <div className="hs-track-header">
                        <span className="hs-track-title"><span className="hs-emoji">🔥</span> 运动</span>
                    </div>
                    <span className="hs-track-value" style={{ fontSize: 16 }}>
                        {totalExerciseMinutes > 0 ? `${totalExerciseMinutes} min` : '—'}
                    </span>
                    {todayExercises.length > 0 && (
                        <div className="hs-track-subtitle" style={{ marginBottom: 0 }}>
                            {todayExercises.map((e) => e.exerciseLabel).join('、')}
                        </div>
                    )}
                </div>

                <div className="hs-track-card hs-animate-fade-in" onClick={() => setActiveTab('sleep')} role="button" tabIndex={0}>
                    <div className="hs-track-header">
                        <span className="hs-track-title"><span className="hs-emoji">🌙</span> 睡眠</span>
                    </div>
                    <span className="hs-track-value" style={{ fontSize: 16 }}>
                        {todaySleep ? formatDurationMinutes(todaySleep.durationMinutes) : '—'}
                    </span>
                    {todaySleep && (
                        <div className="hs-track-subtitle" style={{ marginBottom: 0 }}>
                            {todaySleep.sleepTime} → {todaySleep.wakeTime}
                        </div>
                    )}
                </div>
            </div>

            {recommendations.length > 0 && (
                <div className="hs-recommendation-section hs-animate-fade-in">
                    <div className="hs-section-title">今日参考</div>
                    {recommendations.map((rec) => (
                        <div key={rec.nutrient} className="hs-recommendation-card">
                            <div className="hs-rec-header">{rec.label} 还差 {Math.round(rec.gap)}g</div>
                            <div className="hs-rec-foods">
                                {rec.foods.slice(0, 3).map((food) => (
                                    <span key={food.name} className="hs-rec-food-chip">{food.name}</span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {(isMealsLoading || isTrackingLoading) && (
                <div className="hs-loading-card">正在同步今日记录…</div>
            )}
        </div>
    );
};

export default DashboardTab;
