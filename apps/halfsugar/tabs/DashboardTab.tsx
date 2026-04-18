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
        latestWeight, latestBmi, weightDelta, todayExerciseCalories, todaySleep,
        todayExercises, setActiveTab,
    } = useHalfSugar();

    return (
        <div className="hs-tab-content no-scrollbar">
            <CalorieRing consumed={caloriesConsumed} target={activeCalorieTarget} />
            <div className="hs-track-goal-chip hs-animate-fade-in">热量目标 {activeCalorieTarget} kcal</div>

            <div className="hs-macros">
                <MacroBar label="蛋白" value={proteinConsumed} target={nutrientTargets.protein} color="var(--hs-sage)" />
                <MacroBar label="碳水" value={carbsConsumed} target={nutrientTargets.carbs} color="var(--hs-clay)" />
                <MacroBar label="脂肪" value={fatConsumed} target={nutrientTargets.fat} color="var(--hs-rose)" />
                <MacroBar label="纤维" value={fiberConsumed} target={nutrientTargets.fiber} color="var(--hs-ocean)" />
            </div>

            {recommendations.length > 0 && (
                <div className="hs-recommendation-section hs-animate-fade-in">
                    <div className="hs-section-title">今日建议</div>
                    {recommendations.map((rec) => (
                        <div key={rec.nutrient} className="hs-recommendation-card">
                            <div className="hs-rec-header">{rec.label}还差 {Math.round(rec.gap)}g</div>
                            <div className="hs-rec-foods">
                                {rec.foods.slice(0, 3).map((food) => (
                                    <span key={food.name} className="hs-rec-food-chip">{food.name}</span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* Quick-access summary cards */}
            <div className="hs-track-cards">
                <div className="hs-track-card hs-animate-fade-in" onClick={() => setActiveTab('nutrition')} role="button" tabIndex={0}>
                    <div className="hs-track-header">
                        <span className="hs-track-title">🍽️ 饮食</span>
                        <span className="hs-track-value">
                            {isMealsLoading ? '同步中…' : `${caloriesConsumed} kcal`}
                        </span>
                    </div>
                    <div className="hs-track-subtitle" style={{ fontSize: 12, color: 'var(--hs-text-muted)' }}>
                        点击查看详情
                    </div>
                </div>

                <div className="hs-track-card hs-animate-fade-in" onClick={() => setActiveTab('trends')} role="button" tabIndex={0}>
                    <div className="hs-track-header">
                        <span className="hs-track-title">⚖️ 体重</span>
                        <span className="hs-track-value">
                            {latestWeight ? `${latestWeight.weight} kg` : '—'}
                        </span>
                    </div>
                    {latestWeight && latestBmi && (
                        <div className="hs-track-subtitle">BMI {latestBmi}</div>
                    )}
                    {weightDelta && (
                        <div className={`hs-weight-delta ${weightDelta.tone}`}>{weightDelta.text}</div>
                    )}
                </div>
            </div>

            <div className="hs-track-cards">
                <div className="hs-track-card hs-animate-fade-in" onClick={() => setActiveTab('activity')} role="button" tabIndex={0}>
                    <div className="hs-track-header">
                        <span className="hs-track-title">🏃 运动</span>
                        <span className="hs-track-value">
                            {todayExerciseCalories > 0 ? `−${todayExerciseCalories} kcal` : '—'}
                        </span>
                    </div>
                    {todayExercises.length > 0 && (
                        <div className="hs-track-subtitle">
                            {todayExercises.map((e) => e.exerciseLabel).join('、')}
                        </div>
                    )}
                </div>

                <div className="hs-track-card hs-animate-fade-in" onClick={() => setActiveTab('sleep')} role="button" tabIndex={0}>
                    <div className="hs-track-header">
                        <span className="hs-track-title">😴 睡眠</span>
                        <span className="hs-track-value">
                            {todaySleep ? formatDurationMinutes(todaySleep.durationMinutes) : '—'}
                        </span>
                    </div>
                    {todaySleep && (
                        <div className="hs-track-subtitle">
                            {todaySleep.sleepTime} → {todaySleep.wakeTime}
                        </div>
                    )}
                </div>
            </div>

            {(isMealsLoading || isTrackingLoading) && (
                <div className="hs-loading-card">正在同步今日记录…</div>
            )}
        </div>
    );
};

export default DashboardTab;
