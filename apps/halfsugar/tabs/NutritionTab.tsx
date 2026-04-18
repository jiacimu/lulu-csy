/**
 * NutritionTab — Meal recording, AI identification, favorites, recommendations
 */
import React, { useState } from 'react';
import { useHalfSugar } from '../HalfSugarContext';
import { MealRecordView } from '../components/MealRecordView';
import { MEAL_TYPES, type MealRecord, type MealTypeDefinition } from '../types';

function formatMealTime(timestamp: number): string {
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

const NutritionTab: React.FC = () => {
    const {
        todayDate, todayLabel, meals, isMealsLoading, mealsByType,
        handleSaveMeal, handleDeleteMeal, handleSaveFavoriteFood, handleUseFavoriteFood,
        topFavoriteFoods, apiConfig, addToast, recommendations,
    } = useHalfSugar();

    const [recordingMealType, setRecordingMealType] = useState<MealTypeDefinition | null>(null);
    const [editingMeal, setEditingMeal] = useState<MealRecord | null>(null);

    const handleOpenMealRecord = (mealType: MealTypeDefinition, meal: MealRecord | null = null) => {
        setRecordingMealType(mealType);
        setEditingMeal(meal);
    };

    if (recordingMealType) {
        return (
            <MealRecordView
                currentDate={todayDate}
                mealType={recordingMealType}
                initialMeal={editingMeal}
                apiConfig={apiConfig}
                addToast={addToast}
                favorites={topFavoriteFoods}
                onBack={() => { setEditingMeal(null); setRecordingMealType(null); }}
                onDelete={handleDeleteMeal}
                onSaveFavorite={handleSaveFavoriteFood}
                onSave={handleSaveMeal}
                onUseFavorite={handleUseFavoriteFood}
            />
        );
    }

    return (
        <div className="hs-tab-content no-scrollbar">
            <div className="hs-section-title">
                <span>{todayLabel}</span>
                <span>{isMealsLoading ? '同步中…' : '今日饮食'}</span>
            </div>

            {isMealsLoading && meals.length === 0 && <div className="hs-loading-card">正在同步今日记录…</div>}

            {MEAL_TYPES.map((mealType, idx) => {
                const records = mealsByType[mealType.key] || [];
                return (
                    <section key={mealType.key} className={`hs-meal-group hs-animate-slide-up hs-delay-${Math.min(idx + 1, 5)}`}>
                        <div className="hs-meal-group-title">
                            <span>{mealType.label}</span>
                            {records.length > 0 && <button type="button" className="hs-inline-add" onClick={() => handleOpenMealRecord(mealType)}>再记一份</button>}
                        </div>
                        {records.length === 0 ? (
                            <button type="button" className="hs-meal-add" onClick={() => handleOpenMealRecord(mealType)}><span>＋</span> 记录{mealType.label}</button>
                        ) : (
                            records.map((meal) => (
                                <button key={meal.id} type="button" className="hs-meal-card hs-meal-record-card" onClick={() => handleOpenMealRecord(mealType, meal)}>
                                    <div className="hs-meal-icon" style={{ background: mealType.bg, color: mealType.color, fontSize: 13, fontWeight: 600 }}>{mealType.label.slice(0, 1)}</div>
                                    <div className="hs-meal-info">
                                        <div className="hs-meal-type">{meal.customLabel || mealType.label}</div>
                                        <div className="hs-meal-desc">{formatMealTime(meal.createdAt) || '刚刚'} · {meal.foods.length > 0 ? meal.foods.map((f) => f.name).join('、') : '未填写食物'}</div>
                                    </div>
                                    <div className="hs-meal-cal">{meal.totalCalories}<span className="hs-meal-cal-unit"> kcal</span></div>
                                </button>
                            ))
                        )}
                    </section>
                );
            })}

            {recommendations.length > 0 && (
                <div className="hs-recommendation-section hs-animate-fade-in" style={{ marginTop: 8 }}>
                    <div className="hs-section-title">营养建议</div>
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
        </div>
    );
};

export default NutritionTab;
