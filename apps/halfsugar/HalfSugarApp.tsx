/**
 * HalfSugarApp — 半糖主义 Multi-Tab Entry Point
 * Slim container: wraps HalfSugarProvider + tab navigation.
 */
import React, { Suspense } from 'react';
import { HalfSugarProvider, useHalfSugar, type TabID } from './HalfSugarContext';
import { OnboardingView } from './HalfSugarTrackingUI';
import './halfsugar.css';

// Lazy-load tabs for code-splitting
const DashboardTab = React.lazy(() => import('./tabs/DashboardTab'));
const NutritionTab = React.lazy(() => import('./tabs/NutritionTab'));
const ActivityTab = React.lazy(() => import('./tabs/ActivityTab'));
const SleepTab = React.lazy(() => import('./tabs/SleepTab'));
const TrendsTab = React.lazy(() => import('./tabs/TrendsTab'));
const ProfileTab = React.lazy(() => import('./tabs/ProfileTab'));

// ── Tab Bar Definition ──

interface TabDef {
    id: TabID;
    label: string;
    icon: React.ReactNode;
}

const TABS: TabDef[] = [
    {
        id: 'dashboard',
        label: '今日',
        icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width="22" height="22"><path strokeLinecap="round" strokeLinejoin="round" d="m2.25 12 8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" /></svg>,
    },
    {
        id: 'nutrition',
        label: '饮食',
        icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width="22" height="22"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8.25v-1.5m0 1.5c-1.355 0-2.697.056-4.024.166C6.845 8.51 6 9.473 6 10.608v2.513m6-4.871c1.355 0 2.697.056 4.024.166C17.155 8.51 18 9.473 18 10.608v2.513M15 8.25v-1.5m-6 1.5v-1.5m12 9.75-1.5.75a3.354 3.354 0 0 1-3 0 3.354 3.354 0 0 0-3 0 3.354 3.354 0 0 1-3 0 3.354 3.354 0 0 0-3 0 3.354 3.354 0 0 1-3 0L3 16.5m15-3.379a48.474 48.474 0 0 0-6-.371c-2.032 0-4.034.126-6 .371m12 0c.39.049.777.102 1.163.16 1.07.16 1.837 1.094 1.837 2.175v5.169c0 .621-.504 1.125-1.125 1.125H4.125A1.125 1.125 0 0 1 3 20.625v-5.17c0-1.08.768-2.014 1.837-2.174A47.78 47.78 0 0 1 6 13.12" /></svg>,
    },
    {
        id: 'activity',
        label: '运动',
        icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width="22" height="22"><path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 0 0 .495-7.468 5.99 5.99 0 0 0-1.925 3.547 5.975 5.975 0 0 1-2.133-1.001A3.75 3.75 0 0 0 12 18Z" /></svg>,
    },
    {
        id: 'sleep',
        label: '睡眠',
        icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width="22" height="22"><path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" /></svg>,
    },
    {
        id: 'trends',
        label: '趋势',
        icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width="22" height="22"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" /></svg>,
    },
    {
        id: 'profile',
        label: '我的',
        icon: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} width="22" height="22"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6.75a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" /></svg>,
    },
];

// ── Inner shell (must be inside Provider) ──

const HalfSugarInner: React.FC = () => {
    const {
        activeTab, setActiveTab, closeApp,
        isHealthSetup, healthProfile, onboardingGoalState,
        isSettingsSaving, handleOnboardingComplete, userProfile, goals,
    } = useHalfSugar();

    // Onboarding gate
    if (!isHealthSetup) {
        return (
            <div className="hs-app hs-screen">
                <div className="hs-header">
                    <button type="button" className="hs-back-btn" onClick={closeApp}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    <span className="hs-header-title">半糖主义</span>
                    <div className="hs-header-spacer" />
                </div>
                <div className="hs-scroll-area no-scrollbar">
                    <OnboardingView
                        initialProfile={healthProfile}
                        initialGoals={onboardingGoalState}
                        initialShareBodyInfo={(userProfile as any).healthShareBodyInfo === true}
                        hasPersistedGoals={goals.length > 0}
                        isSaving={isSettingsSaving}
                        onComplete={handleOnboardingComplete}
                    />
                </div>
            </div>
        );
    }

    const renderTab = () => {
        switch (activeTab) {
            case 'dashboard': return <DashboardTab />;
            case 'nutrition': return <NutritionTab />;
            case 'activity': return <ActivityTab />;
            case 'sleep': return <SleepTab />;
            case 'trends': return <TrendsTab />;
            case 'profile': return <ProfileTab />;
            default: return <DashboardTab />;
        }
    };

    return (
        <div className="hs-app hs-screen">
            <div className="hs-header">
                <button type="button" className="hs-back-btn" onClick={closeApp}>
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" width="20" height="20"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                </button>
                <span className="hs-header-title">半糖主义</span>
                <div className="hs-header-spacer" />
            </div>

            <Suspense fallback={<div className="hs-tab-content"><div className="hs-loading-card">加载中…</div></div>}>
                {renderTab()}
            </Suspense>

            {/* Bottom Tab Bar */}
            <nav className="hs-tab-bar">
                {TABS.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        className={`hs-tab-item ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                        aria-label={tab.label}
                    >
                        <span className="hs-tab-icon">{tab.icon}</span>
                        <span className="hs-tab-label">{tab.label}</span>
                    </button>
                ))}
            </nav>
        </div>
    );
};

// ── Root ──

const HalfSugarApp: React.FC = () => (
    <HalfSugarProvider>
        <HalfSugarInner />
    </HalfSugarProvider>
);

export default HalfSugarApp;
