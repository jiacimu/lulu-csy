import React from 'react';
import type { AppID } from '../../types';
import PhoneSplashPoem, { type PhoneSplashDecorationConfig } from './PhoneSplashPoem';

interface AppSplashScreenProps {
    appId: AppID | null;
}

const SPLASH_POEM_DECORATION: PhoneSplashDecorationConfig = {
    decorationImage: '/assets/deco/blue-rose-watercolor.jpg',
    position: {
        right: '-22%',
        bottom: '-18%',
    },
    size: '78%',
    opacity: 0.07,
    blur: 0.2,
    blendMode: 'screen',
};

const AppSplashScreen: React.FC<AppSplashScreenProps> = ({ appId: _appId }) => (
    <div className="phone-splash-poem-shell">
        <PhoneSplashPoem decoration={SPLASH_POEM_DECORATION} />
    </div>
);

export default AppSplashScreen;
