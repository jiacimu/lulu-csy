import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import StoryPhoneScreen, { PHONE_APPS } from './StoryPhoneScreen';

describe('StoryPhoneScreen home UI', () => {
    it('uses dynamic home copy and keeps the active app dot visible', () => {
        const musicApp = PHONE_APPS.find(app => app.id === 'music') || PHONE_APPS[0];
        const { container } = render(
            <StoryPhoneScreen
                charName="陈步青"
                activeAppId="home"
                spotlightApp={musicApp}
                currentTime="11:50"
                homeSurface={{
                    headline: '刚才的对话还没暗下去。',
                    stickyNote: '「她把伞留在玄关」',
                    spotlightDetail: '音乐会贴着刚才那一幕生成。',
                    spotlightFooter: '最近对话 · 11:50',
                }}
                onGenerateApp={() => undefined}
                onOpenApp={() => undefined}
            />,
        );

        expect(screen.getByText('刚才的对话还没暗下去。')).toBeInTheDocument();
        const stickyNote = screen.getByText('「她把伞留在玄关」');
        expect(stickyNote).toBeInTheDocument();
        expect(stickyNote.className).toContain('line-clamp-3');
        expect(stickyNote.className).toContain('break-words');
        expect(screen.getByText('音乐会贴着刚才那一幕生成。')).toBeInTheDocument();
        expect(screen.getByText('最近对话 · 11:50')).toBeInTheDocument();
        expect(screen.queryByText('记得按时吃饭。')).not.toBeInTheDocument();
        expect(container.innerHTML).not.toContain('d8d2c6');
        expect(container.innerHTML).not.toContain('ded8cb');
        const unreadDots = container.querySelectorAll('.story-phone-unread-dot');
        expect(unreadDots.length).toBeGreaterThan(0);
        unreadDots.forEach(dot => {
            expect(dot.parentElement?.className).not.toContain('overflow-hidden');
        });
    });

    it('opens a WeChat secondary chat screen from the generated clue list', () => {
        const wechatApp = PHONE_APPS.find(app => app.id === 'wechat') || PHONE_APPS[0];
        render(
            <StoryPhoneScreen
                charName="陈步青"
                activeAppId="wechat"
                spotlightApp={wechatApp}
                apps={[wechatApp]}
                currentTime="11:52"
                clue={{
                    appId: 'wechat',
                    appName: '微信',
                    title: '微信停在聊天页',
                    subtitle: '置顶会话有未读',
                    timestamp: '11:52',
                    items: [
                        {
                            label: '置顶好友',
                            value: '对方: 你刚刚是不是看见了？\n我: 没有，屏幕自己亮的。',
                            detail: '撤回过一条消息',
                        },
                    ],
                    evidenceText: '微信里有一段没来得及藏好的聊天。',
                    insertSummary: '用户看见了微信置顶好友的异常聊天。',
                }}
            />,
        );

        fireEvent.click(screen.getByText('置顶好友').closest('button') as HTMLButtonElement);

        expect(screen.getByText('置顶好友')).toBeInTheDocument();
        expect(screen.getByText('只读模式，不能发送消息')).toBeInTheDocument();
        expect(screen.getByText('你刚刚是不是看见了？')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('返回上一层'));

        expect(screen.getAllByText('微信').length).toBeGreaterThan(0);
        expect(screen.getByText('通讯录')).toBeInTheDocument();
        expect(screen.getByText('发现')).toBeInTheDocument();
    });

    it('keeps WeChat contact buckets, sparse chats, me page, and moments populated from data', () => {
        const wechatApp = PHONE_APPS.find(app => app.id === 'wechat') || PHONE_APPS[0];
        render(
            <StoryPhoneScreen
                charName="祁寒川"
                activeAppId="wechat"
                spotlightApp={wechatApp}
                apps={[wechatApp]}
                currentTime="20:38"
                clue={{
                    appId: 'wechat',
                    appName: '微信',
                    title: '微信',
                    subtitle: '屏幕亮起中',
                    timestamp: '20:38',
                    items: [
                        {
                            label: '京海政务一号工作群(24)',
                            value: '今晚材料先发我。',
                            detail: '20:38',
                        },
                    ],
                    evidenceText: '微信里有工作群和朋友圈。',
                    insertSummary: '用户看见了微信里的工作群和朋友圈。',
                    wechatData: {
                        profile: {
                            id: 'owner',
                            nickname: '祁寒川',
                            wechatId: 'Qi_HC_1224',
                            statusText: '屏幕亮起中',
                        },
                        chats: [
                            {
                                id: 'group-1',
                                type: 'group',
                                title: '京海政务一号工作群(24)',
                                subtitle: '今晚材料先发我。',
                                time: '20:38',
                            },
                            {
                                id: 'private-shen',
                                type: 'private',
                                title: '沈度',
                                subtitle: '刚开完会，楼下的灯还亮着。',
                                time: '00:17',
                            },
                        ],
                        chatMessages: {
                            'group-1': {
                                id: 'group-1',
                                title: '京海政务一号工作群(24)',
                                messages: [
                                    {
                                        id: 'group-1-msg-1',
                                        sender: 'other',
                                        senderName: '沈度',
                                        type: 'text',
                                        text: '今晚材料先发我。明早会前我再核一下。',
                                        time: '20:38',
                                    },
                                ],
                            },
                            'private-shen': {
                                id: 'private-shen',
                                title: '沈度',
                                messages: [
                                    {
                                        id: 'private-shen-msg-1',
                                        sender: 'other',
                                        senderName: '沈度',
                                        type: 'text',
                                        text: '刚开完会，楼下的灯还亮着。',
                                        time: '00:17',
                                    },
                                ],
                            },
                        },
                        contacts: [
                            {
                                id: 'shen-du',
                                name: '沈度',
                                remark: '沈度',
                                groupKey: 'S',
                                tags: ['工作'],
                                source: '群聊',
                                bio: '政策研究',
                                relationshipHint: '转发文章：关于东南沿海自贸区产...',
                            },
                            {
                                id: 'mother',
                                name: '母亲',
                                remark: '母亲',
                                groupKey: 'M',
                                tags: ['家人'],
                                bio: '利益与家族纽带',
                                relationshipHint: '母亲，利益与家族纽带',
                            },
                        ],
                        moments: {
                            posts: [
                                {
                                    id: 'owner-post',
                                    authorId: 'owner',
                                    authorName: '祁寒川',
                                    text: '转发文章：关于东南沿海自贸区产...',
                                    time: '20:16',
                                },
                                {
                                    id: 'bad-profile-post',
                                    authorId: 'mother',
                                    authorName: '母亲',
                                    text: '母亲，利益与家族纽带',
                                    time: '昨天',
                                },
                            ],
                        },
                        enabledFeatures: ['moments'],
                    },
                }}
            />,
        );

        fireEvent.click(screen.getByText('京海政务一号工作群(24)').closest('button') as HTMLButtonElement);
        expect(screen.getByText('今晚材料先发我。')).toBeInTheDocument();
        expect(screen.getByText('明早会前我再核一下。')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('返回上一层'));
        fireEvent.click(screen.getByText('通讯录'));
        fireEvent.click(screen.getByText('群聊').closest('button') as HTMLButtonElement);
        expect(screen.getByText('京海政务一号工作群(24)')).toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('返回上一层'));
        fireEvent.click(screen.getByText('发现'));
        fireEvent.click(screen.getByText('朋友圈').closest('button') as HTMLButtonElement);
        expect(screen.getAllByText('沈度').length).toBeGreaterThan(0);
        expect(screen.getAllByText('刚开完会，楼下的灯还亮着。').length).toBeGreaterThan(0);
        expect(screen.getAllByText('转发文章：关于东南沿海自贸区产...').length).toBeGreaterThan(0);
        expect(screen.queryByText('母亲，利益与家族纽带')).not.toBeInTheDocument();

        fireEvent.click(screen.getByLabelText('返回上一层'));
        fireEvent.click(screen.getByText('我'));
        expect(screen.getAllByText('微信号：Qi_HC_1224').length).toBeGreaterThan(0);
        expect(screen.getByText('设置')).toBeInTheDocument();
    });
});
