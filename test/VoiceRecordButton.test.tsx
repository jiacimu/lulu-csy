import { render,screen,waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach,describe,expect,it,vi } from 'vitest';
import VoiceRecordButton from '../components/chat/VoiceRecordButton';

vi.mock('../components/chat/WaveformCanvas', () => ({
    default: () => <div data-testid="waveform-canvas" />,
}));

function touchPoint(clientY: number) {
    return { clientX: 240, clientY } as Touch;
}

function dispatchTouch(target: EventTarget, type: string, points: Touch[]) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', {
        value: type === 'touchend' || type === 'touchcancel' ? [] : points,
    });
    Object.defineProperty(event, 'changedTouches', { value: points });
    target.dispatchEvent(event);
}

function renderButton(overrides: Partial<ComponentProps<typeof VoiceRecordButton>> = {}) {
    const props: ComponentProps<typeof VoiceRecordButton> = {
        onVoiceMessage: vi.fn(),
        recorderState: 'idle',
        recordingDuration: 0,
        onStartRecording: vi.fn().mockResolvedValue(true),
        onStopRecording: vi.fn().mockResolvedValue({ blob: new Blob(['voice']), duration: 3 }),
        onCancelRecording: vi.fn(),
        ...overrides,
    };

    const view = render(<VoiceRecordButton {...props} />);
    return { ...view, props };
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('VoiceRecordButton', () => {
    it('cancels when an Android-style swipe-up ends on the document', async () => {
        const { props } = renderButton();
        const button = screen.getByLabelText('按住说话');

        dispatchTouch(button, 'touchstart', [touchPoint(620)]);
        dispatchTouch(document, 'touchmove', [touchPoint(540)]);
        dispatchTouch(document, 'touchend', [touchPoint(540)]);

        expect(props.onStartRecording).toHaveBeenCalledTimes(1);
        expect(props.onCancelRecording).toHaveBeenCalledTimes(1);
        expect(props.onStopRecording).not.toHaveBeenCalled();
        expect(props.onVoiceMessage).not.toHaveBeenCalled();
    });

    it('sends when the finger releases without crossing the cancel threshold', async () => {
        const { props } = renderButton();
        const button = screen.getByLabelText('按住说话');

        dispatchTouch(button, 'touchstart', [touchPoint(620)]);
        dispatchTouch(document, 'touchmove', [touchPoint(590)]);
        dispatchTouch(document, 'touchend', [touchPoint(590)]);

        expect(props.onCancelRecording).not.toHaveBeenCalled();
        await waitFor(() => expect(props.onStopRecording).toHaveBeenCalledTimes(1));
        expect(props.onVoiceMessage).toHaveBeenCalledTimes(1);
    });
});
