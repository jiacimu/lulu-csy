import React, { useEffect, useMemo, useState } from 'react';

import {
    computeBMI,
    computeDailyCalorieGoal,
    getBMICategory,
    type GoalType,
    type HealthAwareUserProfile,
    type HealthGoal,
    type HealthProfile,
} from './types';

export interface GoalFormState {
    weightTarget: string;
    dailyCalories: string;
    dailyProtein: string;
    dailyCarbs: string;
    dailyFat: string;
    dailyFiber: string;
}

interface GoalFieldDefinition {
    key: keyof GoalFormState;
    goalType: GoalType;
    label: string;
    unit: string;
}

const GOAL_FIELD_DEFINITIONS: GoalFieldDefinition[] = [
    { key: 'dailyCalories', goalType: 'daily_calories', label: '热量上限', unit: 'kcal' },
    { key: 'dailyProtein', goalType: 'daily_protein', label: '蛋白质下限', unit: 'g' },
    { key: 'dailyCarbs', goalType: 'daily_carbs', label: '碳水上限', unit: 'g' },
    { key: 'dailyFat', goalType: 'daily_fat', label: '脂肪上限', unit: 'g' },
    { key: 'dailyFiber', goalType: 'daily_fiber', label: '膳食纤维下限', unit: 'g' },
];

function parsePositiveNumber(value: string): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatGoalNumber(value: number | undefined): string {
    return value && Number.isFinite(value) ? String(value) : '';
}

function buildUserProfileShape(profile: HealthProfile): HealthAwareUserProfile {
    return {
        name: '',
        avatar: '',
        bio: '',
        healthGender: profile.gender || undefined,
        healthHeight: parsePositiveNumber(profile.height) || undefined,
        healthWeight: parsePositiveNumber(profile.weight) || undefined,
        healthBirthYear: parsePositiveNumber(profile.birthYear) || undefined,
        healthSetupDone: profile.isSetup,
    };
}

function getGoalValue(goals: HealthGoal[], goalType: GoalType): number | undefined {
    return goals.find((goal) => goal.goalType === goalType)?.targetValue;
}

function getBmiBadgeClassName(bmi: number): string {
    if (bmi >= 28) return 'hs-bmi-badge danger';
    if (bmi >= 24) return 'hs-bmi-badge warning';
    return 'hs-bmi-badge';
}

export function buildGoalFormState(profile: HealthProfile, goals: HealthGoal[]): GoalFormState {
    const currentWeight = parsePositiveNumber(profile.weight) || undefined;
    const weightTarget = getGoalValue(goals, 'weight_target') ?? currentWeight;
    const userShape = buildUserProfileShape(profile);

    return {
        weightTarget: formatGoalNumber(weightTarget),
        dailyCalories: formatGoalNumber(
            getGoalValue(goals, 'daily_calories') ?? computeDailyCalorieGoal(userShape, weightTarget),
        ),
        dailyProtein: formatGoalNumber(getGoalValue(goals, 'daily_protein') ?? 60),
        dailyCarbs: formatGoalNumber(getGoalValue(goals, 'daily_carbs') ?? 250),
        dailyFat: formatGoalNumber(getGoalValue(goals, 'daily_fat') ?? 65),
        dailyFiber: formatGoalNumber(getGoalValue(goals, 'daily_fiber') ?? 25),
    };
}

export const BottomSheetModal: React.FC<{
    title: string;
    onClose: () => void;
    children: React.ReactNode;
}> = ({ title, onClose, children }) => (
    <div className="hs-modal-overlay" onClick={onClose}>
        <div className="hs-modal-sheet" onClick={(event) => event.stopPropagation()}>
            <div className="hs-modal-handle" />
            <div className="hs-modal-title">{title}</div>
            <div className="hs-modal-body">{children}</div>
        </div>
    </div>
);

export const OnboardingView: React.FC<{
    initialProfile: HealthProfile;
    initialGoals: GoalFormState;
    initialShareBodyInfo?: boolean;
    hasPersistedGoals: boolean;
    isSaving?: boolean;
    onComplete: (payload: { profile: HealthProfile; goals: GoalFormState; shareBodyInfo: boolean }) => void | Promise<void>;
}> = ({ initialProfile, initialGoals, initialShareBodyInfo = false, hasPersistedGoals, isSaving = false, onComplete }) => {
    const [gender, setGender] = useState<'male' | 'female' | ''>(initialProfile.gender);
    const [height, setHeight] = useState(initialProfile.height);
    const [weight, setWeight] = useState(initialProfile.weight);
    const [birthYear, setBirthYear] = useState(initialProfile.birthYear);
    const [goals, setGoals] = useState<GoalFormState>(initialGoals);
    const [shareBodyInfo, setShareBodyInfo] = useState(initialShareBodyInfo);
    const [weightTargetTouched, setWeightTargetTouched] = useState(hasPersistedGoals);
    const [calorieTouched, setCalorieTouched] = useState(hasPersistedGoals);
    const currentYear = new Date().getFullYear();

    useEffect(() => {
        setGender(initialProfile.gender);
        setHeight(initialProfile.height);
        setWeight(initialProfile.weight);
        setBirthYear(initialProfile.birthYear);
        setGoals(initialGoals);
        setShareBodyInfo(initialShareBodyInfo);
        setWeightTargetTouched(hasPersistedGoals);
        setCalorieTouched(hasPersistedGoals);
    }, [
        hasPersistedGoals,
        initialGoals,
        initialProfile.birthYear,
        initialProfile.gender,
        initialProfile.height,
        initialProfile.weight,
        initialShareBodyInfo,
    ]);

    const profileDraft = useMemo<HealthProfile>(() => ({
        gender,
        height,
        weight,
        birthYear,
        isSetup: true,
    }), [birthYear, gender, height, weight]);

    const weightValue = parsePositiveNumber(weight);
    const heightValue = parsePositiveNumber(height);
    const goalWeightValue = parsePositiveNumber(goals.weightTarget);

    useEffect(() => {
        if (weightTargetTouched) {
            return;
        }
        setGoals((prev) => ({
            ...prev,
            weightTarget: weight,
        }));
    }, [weight, weightTargetTouched]);

    const suggestedDailyCalories = useMemo(
        () => computeDailyCalorieGoal(buildUserProfileShape(profileDraft), goalWeightValue || weightValue || undefined),
        [goalWeightValue, profileDraft, weightValue],
    );

    useEffect(() => {
        if (calorieTouched) {
            return;
        }
        setGoals((prev) => ({
            ...prev,
            dailyCalories: String(suggestedDailyCalories),
        }));
    }, [calorieTouched, suggestedDailyCalories]);

    const targetBmi = goalWeightValue && heightValue ? computeBMI(goalWeightValue, heightValue) : null;
    const isValid = Boolean(
        gender
        && heightValue
        && weightValue
        && parsePositiveNumber(birthYear)
        && parsePositiveNumber(goals.weightTarget)
        && parsePositiveNumber(goals.dailyCalories)
        && parsePositiveNumber(goals.dailyProtein)
        && parsePositiveNumber(goals.dailyCarbs)
        && parsePositiveNumber(goals.dailyFat)
        && parsePositiveNumber(goals.dailyFiber),
    );

    const handleGoalChange = (key: keyof GoalFormState, value: string) => {
        if (key === 'weightTarget') {
            setWeightTargetTouched(true);
        }
        if (key === 'dailyCalories') {
            setCalorieTouched(true);
        }
        setGoals((prev) => ({ ...prev, [key]: value }));
    };

    const handleSubmit = () => {
        if (!isValid || isSaving) return;
        void onComplete({
            profile: { gender, height, weight, birthYear, isSetup: true },
            goals,
            shareBodyInfo,
        });
    };

    return (
        <div className="hs-onboarding hs-animate-fade-in">
            <div className="hs-onboarding-illustration"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} width="42" height="42" style={{ color: 'var(--hs-primary-dark)' }}><path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0 0 12 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52 2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 0 1-2.031.352 5.988 5.988 0 0 1-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.97ZM5.25 4.97l-2.62 10.726c-.122.499.106 1.028.589 1.202a5.989 5.989 0 0 0 2.031.352 5.989 5.989 0 0 0 2.031-.352c.483-.174.711-.703.59-1.202L5.25 4.971Z" /></svg></div>
            <h1 className="hs-onboarding-title">让我了解你</h1>
            <p className="hs-onboarding-subtitle">填写基础信息，获得个性化建议</p>
            <div className="hs-form-group">
                <label className="hs-form-label">性别</label>
                <div className="hs-gender-toggle">
                    <button type="button" className={`hs-gender-btn ${gender === 'male' ? 'active' : ''}`} onClick={() => setGender('male')}>男</button>
                    <button type="button" className={`hs-gender-btn ${gender === 'female' ? 'active' : ''}`} onClick={() => setGender('female')}>女</button>
                </div>
            </div>
            <div className="hs-form-group">
                <label className="hs-form-label">身高</label>
                <div className="hs-form-input-with-unit">
                    <input type="number" inputMode="decimal" className="hs-form-input" value={height} onChange={(event) => setHeight(event.target.value)} placeholder="170" min="100" max="250" />
                    <span className="hs-unit">cm</span>
                </div>
            </div>
            <div className="hs-form-group">
                <label className="hs-form-label">体重</label>
                <div className="hs-form-input-with-unit">
                    <input type="number" inputMode="decimal" className="hs-form-input" value={weight} onChange={(event) => setWeight(event.target.value)} placeholder="65" min="20" max="300" />
                    <span className="hs-unit">kg</span>
                </div>
            </div>
            <div className="hs-form-group">
                <label className="hs-form-label">出生年份</label>
                <input type="number" inputMode="numeric" className="hs-form-input" value={birthYear} onChange={(event) => setBirthYear(event.target.value)} placeholder="1998" min="1940" max={currentYear} />
            </div>

            <div className="hs-goal-section">
                <div className="hs-section-title" style={{ padding: 0, marginBottom: 10 }}>
                    <span>目标设置</span>
                    <span>半糖主义</span>
                </div>
                <div className="hs-goal-row">
                    <div className="hs-goal-label" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span>目标体重</span>
                        {targetBmi && (
                            <span className={getBmiBadgeClassName(targetBmi)}>
                                BMI {targetBmi} · {getBMICategory(targetBmi)}
                            </span>
                        )}
                    </div>
                    <input
                        type="number"
                        inputMode="decimal"
                        className="hs-goal-input"
                        value={goals.weightTarget}
                        onChange={(event) => handleGoalChange('weightTarget', event.target.value)}
                        placeholder="65"
                    />
                    <span className="hs-goal-unit">kg</span>
                </div>

                {GOAL_FIELD_DEFINITIONS.map((field) => (
                    <div key={field.goalType} className="hs-goal-row">
                        <div className="hs-goal-label">{field.label}</div>
                        <input
                            type="number"
                            inputMode="decimal"
                            className="hs-goal-input"
                            value={goals[field.key]}
                            onChange={(event) => handleGoalChange(field.key, event.target.value)}
                        />
                        <span className="hs-goal-unit">{field.unit}</span>
                    </div>
                ))}

                <div className="hs-goal-row">
                    <div className="hs-goal-label" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span>允许角色感知我的体型</span>
                        <span style={{ fontSize: 12, color: 'rgba(15, 23, 42, 0.56)', fontWeight: 400 }}>
                            默认关闭，仅在你主动开启时注入体型印象
                        </span>
                    </div>
                    <label className="hs-toggle">
                        <input
                            type="checkbox"
                            aria-label="允许角色感知我的体型"
                            checked={shareBodyInfo}
                            onChange={(event) => setShareBodyInfo(event.target.checked)}
                        />
                        <span className="hs-toggle-slider" />
                    </label>
                </div>
            </div>

            <button type="button" className="hs-submit-btn" onClick={handleSubmit} disabled={!isValid || isSaving}>
                {initialProfile.isSetup ? '保存设置' : '开始使用'}
            </button>
        </div>
    );
};
