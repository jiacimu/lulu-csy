import React from 'react';

export const CalorieRing: React.FC<{ consumed: number; target: number }> = React.memo(({ consumed, target }) => {
    const radius = 72;
    const circumference = 2 * Math.PI * radius;
    const progress = Math.min(consumed / Math.max(target, 1), 1);
    const dashOffset = circumference * (1 - progress);
    const remaining = Math.max(0, target - consumed);

    return (
        <div className="hs-ring-container hs-animate-ring">
            <div className="hs-ring-wrapper">
                <div className="hs-ring-inner">
                    <svg className="hs-ring-svg" viewBox="0 0 174 174">
                        <circle className="hs-ring-bg" cx="87" cy="87" r={radius} />
                        <circle
                            className="hs-ring-progress"
                            cx="87"
                            cy="87"
                            r={radius}
                            strokeDasharray={circumference}
                            strokeDashoffset={dashOffset}
                            style={consumed > target ? { stroke: 'var(--hs-rose)' } : undefined}
                        />
                    </svg>
                    <div className="hs-ring-center">
                        <span className="hs-ring-value">{consumed.toLocaleString()}</span>
                        <span className="hs-ring-unit">kcal</span>
                        <span className="hs-ring-label">剩余 {remaining.toLocaleString()}</span>
                    </div>
                </div>
            </div>
        </div>
    );
});
