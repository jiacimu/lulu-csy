import { fireEvent,render,screen,waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import WeChatInputBar from '../components/chat/plugins/WeChatInputBar';
import { CloudStt } from '../utils/cloudStt';

const mocks = vi.hoisted(() => ({
    addToast: vi.fn(),
    transcribe: vi.fn(),
}));

vi.mock('../context/OSContext', () => ({
    useOS: () => ({
        sttConfig: { provider: 'mock' },
        addToast: mocks.addToast,
    }),
}));

vi.mock('../utils/cloudStt', () => ({
    CloudStt: {
        transcribe: mocks.transcribe,
    },
}));

vi.mock('../utils/iosStandalone', () => ({
    isIOSStandaloneWebApp: () => false,
}));

vi.mock('../components/chat/WaveformCanvas', () => ({
    default: () => <div data-testid="waveform-canvas" />,
}));

function touchPoint(clientX: number, clientY: number) {
    return { clientX, clientY } as Touch;
}

function dispatchTouch(target: EventTarget, type: string, points: Touch[]) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', {
        value: type === 'touchend' || type === 'touchcancel' ? [] : points,
    });
    Object.defineProperty(event, 'changedTouches', { value: points });
    target.dispatchEvent(event);
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function renderInputBar(overrides: Partial<ComponentProps<typeof WeChatInputBar>> = {}) {
    const props: ComponentProps<typeof WeChatInputBar> = {
        input: '',
        setInput: vi.fn(),
        showPanel: 'none',
        setShowPanel: vi.fn(),
        onSend: vi.fn(),
        onVoiceMessage: vi.fn(),
        voiceRecorderState: 'idle',
        onStartRecording: vi.fn().mockResolvedValue(true),
        onStopRecording: vi.fn().mockResolvedValue({ blob: new Blob(['voice']), duration: 3 }),
        onCancelRecording: vi.fn(),
        ...overrides,
    };

    const view = render(<WeChatInputBar {...props} />);
    fireEvent.click(screen.getByLabelText('切换到语音输入'));
    return { ...view, props };
}

afterEach(() => {
    vi.clearAllMocks();
});

describe('WeChatInputBar voice gestures', () => {
    it('queues release until recording startup resolves', async () => {
        const started = deferred<boolean>();
        const { props } = renderInputBar({
            onStartRecording: vi.fn(() => started.promise),
        });
        const holdButton = screen.getByLabelText('按住说话');

        dispatchTouch(holdButton, 'touchstart', [touchPoint(600, 620)]);
        dispatchTouch(document, 'touchend', [touchPoint(600, 620)]);

        expect(props.onStopRecording).not.toHaveBeenCalled();
        started.resolve(true);

        await waitFor(() => expect(props.onStopRecording).toHaveBeenCalledTimes(1));
        expect(props.onVoiceMessage).toHaveBeenCalledTimes(1);
    });

    it('cancels when the gesture ends in the left cancel zone', async () => {
        const { props } = renderInputBar();
        const holdButton = screen.getByLabelText('按住说话');

        dispatchTouch(holdButton, 'touchstart', [touchPoint(600, 620)]);
        dispatchTouch(document, 'touchmove', [touchPoint(80, 540)]);
        dispatchTouch(document, 'touchend', [touchPoint(80, 540)]);

        await waitFor(() => expect(props.onCancelRecording).toHaveBeenCalledTimes(1));
        expect(props.onStopRecording).not.toHaveBeenCalled();
        expect(props.onVoiceMessage).not.toHaveBeenCalled();
    });

    it('converts speech to text when the gesture ends in the right convert zone', async () => {
        vi.mocked(CloudStt.transcribe).mockResolvedValue({ text: '识别后的文字' } as any);
        const { props } = renderInputBar();
        const holdButton = screen.getByLabelText('按住说话');

        dispatchTouch(holdButton, 'touchstart', [touchPoint(600, 620)]);
        dispatchTouch(document, 'touchmove', [touchPoint(900, 540)]);
        dispatchTouch(document, 'touchend', [touchPoint(900, 540)]);

        await waitFor(() => expect(CloudStt.transcribe).toHaveBeenCalledTimes(1));
        expect(props.setInput).toHaveBeenCalledWith('识别后的文字');
        expect(mocks.addToast).toHaveBeenCalledWith('语音已转为文字', 'success');
        expect(props.onVoiceMessage).not.toHaveBeenCalled();
    });
});
