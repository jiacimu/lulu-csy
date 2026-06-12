import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StatusCardRenderer from '../components/chat/StatusCardRenderer';
import { STATUS_CARD_IFRAME_SHELL } from '../components/chat/statusCardIframe';
import type { StatusCardData } from '../types/statusCard';

const originalViewport = {
    width: window.innerWidth,
    height: window.innerHeight,
};

function setViewportSize(width: number, height: number) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: height });
    window.dispatchEvent(new Event('resize'));
}

function reportFrameSize(frame: HTMLIFrameElement, channel: string | null, width: number, height: number) {
    act(() => {
        const messageEvent = new MessageEvent('message', {
            data: { type: 'preview-height', channel, width, height },
        });
        Object.defineProperty(messageEvent, 'source', { value: frame.contentWindow });
        window.dispatchEvent(messageEvent);
    });
}

function loadFrame(frame: HTMLIFrameElement) {
    act(() => {
        fireEvent.load(frame);
    });
}

afterEach(() => {
    act(() => {
        setViewportSize(originalViewport.width, originalViewport.height);
    });
});

describe('StatusCardRenderer', () => {
    it('keeps the freeform iframe shell isolated from origin and network access', () => {
        expect(STATUS_CARD_IFRAME_SHELL).toContain("connect-src 'none'");
        expect(STATUS_CARD_IFRAME_SHELL).toContain("base-uri 'none'");
        expect(STATUS_CARD_IFRAME_SHELL).toContain("form-action 'none'");
        expect(STATUS_CARD_IFRAME_SHELL).toContain("media-src data: blob:");
        expect(STATUS_CARD_IFRAME_SHELL).toContain("defineBlockedValue(window, 'fetch'");
        expect(STATUS_CARD_IFRAME_SHELL).toContain("defineBlockedValue(window, 'XMLHttpRequest'");
        expect(STATUS_CARD_IFRAME_SHELL).toContain("collectAndRemoveScripts");
        expect(STATUS_CARD_IFRAME_SHELL).toContain("node.hasAttribute('src')");
        expect(STATUS_CARD_IFRAME_SHELL).toContain("type === 'text/javascript'");
        expect(STATUS_CARD_IFRAME_SHELL).toContain('data-status-card-stage');
        expect(STATUS_CARD_IFRAME_SHELL).toContain('getStageWidth');
    });

    it('sizes freeform cards from the reported html width and height', async () => {
        const data: StatusCardData = {
            cardType: 'freeform',
            body: 'Custom card',
            meta: {
                html: '<html><body><div style="height:360px">Marcus</div></body></html>',
            },
            style: {},
        };

        render(<StatusCardRenderer data={data} />);

        const frame = screen.getByTitle('Freeform creative card') as HTMLIFrameElement;
        const fitShell = screen.getByTestId('freeform-status-card-fit');
        expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
        expect(frame).toHaveStyle({ height: '1px' });

        loadFrame(frame);

        const channel = frame.getAttribute('data-preview-channel');
        expect(channel).toBeTruthy();

        reportFrameSize(frame, channel, 286, 360);

        await waitFor(() => {
            expect(fitShell).toHaveStyle({ width: '360px' });
            expect(fitShell).toHaveStyle({ height: '368px' });
            expect(frame).toHaveStyle({ width: '360px' });
            expect(frame).toHaveStyle({ height: '368px' });
            expect(frame.style.transform).toBe('translate(-50%, -50%) scale(1)');
        });
    });

    it('scales freeform cards down when their width exceeds the mobile viewport', async () => {
        setViewportSize(220, 1000);

        const data: StatusCardData = {
            cardType: 'freeform',
            body: 'Wide card',
            meta: {
                html: '<html><body><div style="width:392px;height:200px">wide</div></body></html>',
            },
            style: {},
        };

        render(<StatusCardRenderer data={data} />);

        const frame = screen.getByTitle('Freeform creative card') as HTMLIFrameElement;
        const fitShell = screen.getByTestId('freeform-status-card-fit');
        loadFrame(frame);
        const channel = frame.getAttribute('data-preview-channel');

        reportFrameSize(frame, channel, 392, 200);

        await waitFor(() => {
            expect(fitShell).toHaveStyle({ width: '200px' });
            expect(fitShell).toHaveStyle({ height: '107px' });
            expect(frame).toHaveStyle({ width: '392px' });
            expect(frame).toHaveStyle({ height: '208px' });
            expect(frame.style.transform).toContain('scale(0.5102040816326531)');
        });
    });

    it('scales freeform cards down when their height exceeds the viewport', async () => {
        setViewportSize(1000, 496);

        const data: StatusCardData = {
            cardType: 'freeform',
            body: 'Tall card',
            meta: {
                html: '<html><body><div style="width:192px;height:792px">tall</div></body></html>',
            },
            style: {},
        };

        render(<StatusCardRenderer data={data} />);

        const frame = screen.getByTitle('Freeform creative card') as HTMLIFrameElement;
        const fitShell = screen.getByTestId('freeform-status-card-fit');
        loadFrame(frame);
        const channel = frame.getAttribute('data-preview-channel');

        reportFrameSize(frame, channel, 192, 792);

        await waitFor(() => {
            expect(fitShell).toHaveStyle({ width: '199px' });
            expect(fitShell).toHaveStyle({ height: '441px' });
            expect(frame).toHaveStyle({ width: '360px' });
            expect(frame).toHaveStyle({ height: '800px' });
            expect(frame.style.transform).toContain('scale(0.55');
        });
    });

    it('does not height-scale freeform cards in width-only fit mode', async () => {
        setViewportSize(1000, 496);

        const data: StatusCardData = {
            cardType: 'freeform',
            body: 'Tall Date card',
            meta: {
                html: '<html><body><div style="width:192px;height:792px">tall</div></body></html>',
            },
            style: {},
        };

        render(<StatusCardRenderer data={data} freeformFitMode="width" />);

        const frame = screen.getByTitle('Freeform creative card') as HTMLIFrameElement;
        const fitShell = screen.getByTestId('freeform-status-card-fit');
        loadFrame(frame);
        const channel = frame.getAttribute('data-preview-channel');

        reportFrameSize(frame, channel, 192, 792);

        await waitFor(() => {
            expect(fitShell).toHaveStyle({ width: '192px' });
            expect(fitShell).toHaveStyle({ height: '800px' });
            expect(fitShell.style.maxHeight).toBe('');
            expect(frame).toHaveStyle({ width: '192px' });
            expect(frame).toHaveStyle({ height: '800px' });
            expect(frame.style.transform).toBe('translate(-50%, -50%) scale(1)');
        });
    });

    it('keeps width-only freeform cards from shrinking after interactive remeasurements', async () => {
        setViewportSize(390, 800);

        const data: StatusCardData = {
            cardType: 'freeform',
            body: 'Interactive Date card',
            meta: {
                html: '<html><body><details><summary>展开</summary><div style="width:330px;height:500px">content</div></details></body></html>',
            },
            style: {},
        };

        render(<StatusCardRenderer data={data} freeformFitMode="width" />);

        const frame = screen.getByTitle('Freeform creative card') as HTMLIFrameElement;
        const fitShell = screen.getByTestId('freeform-status-card-fit');
        loadFrame(frame);
        const channel = frame.getAttribute('data-preview-channel');

        reportFrameSize(frame, channel, 330, 220);

        await waitFor(() => {
            expect(fitShell).toHaveStyle({ width: '330px' });
            expect(frame).toHaveStyle({ width: '330px' });
            expect(frame.style.transform).toBe('translate(-50%, -50%) scale(1)');
        });

        reportFrameSize(frame, channel, 260, 520);

        await waitFor(() => {
            expect(fitShell).toHaveStyle({ width: '330px' });
            expect(fitShell).toHaveStyle({ height: '528px' });
            expect(frame).toHaveStyle({ width: '330px' });
            expect(frame).toHaveStyle({ height: '528px' });
            expect(frame.style.transform).toBe('translate(-50%, -50%) scale(1)');
        });

        reportFrameSize(frame, channel, 220, 180);

        await waitFor(() => {
            expect(fitShell).toHaveStyle({ width: '330px' });
            expect(fitShell).toHaveStyle({ height: '188px' });
            expect(frame).toHaveStyle({ width: '330px' });
            expect(frame).toHaveStyle({ height: '188px' });
            expect(frame.style.transform).toBe('translate(-50%, -50%) scale(1)');
        });
    });

    it('uses the smaller scale when both freeform card axes overflow', async () => {
        setViewportSize(420, 496);

        const data: StatusCardData = {
            cardType: 'freeform',
            body: 'Large card',
            meta: {
                html: '<html><body><div style="width:1192px;height:792px">large</div></body></html>',
            },
            style: {},
        };

        render(<StatusCardRenderer data={data} />);

        const frame = screen.getByTitle('Freeform creative card') as HTMLIFrameElement;
        const fitShell = screen.getByTestId('freeform-status-card-fit');
        loadFrame(frame);
        const channel = frame.getAttribute('data-preview-channel');

        reportFrameSize(frame, channel, 1192, 792);

        await waitFor(() => {
            expect(fitShell).toHaveStyle({ width: '400px' });
            expect(fitShell).toHaveStyle({ height: '269px' });
            expect(frame).toHaveStyle({ width: '1192px' });
            expect(frame).toHaveStyle({ height: '800px' });
            expect(frame.style.transform).toContain('scale(0.33557046979865773)');
        });
    });

    it('passes the allowScripts flag only for opted-in freeform cards', async () => {
        const data: StatusCardData = {
            cardType: 'freeform',
            body: 'Custom card',
            meta: {
                html: '<html><body><button id="toggle">Toggle</button><script>document.body.dataset.ready = "yes";</script></body></html>',
                allowScripts: true,
            },
            style: {},
        };

        render(<StatusCardRenderer data={data} />);

        const frame = screen.getByTitle('Freeform creative card') as HTMLIFrameElement;
        const postMessageSpy = vi.spyOn(frame.contentWindow!, 'postMessage');

        loadFrame(frame);

        await waitFor(() => {
            expect(postMessageSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'preview-update',
                    html: data.meta?.html,
                    allowScripts: true,
                }),
                '*',
            );
        });
    });

    it('passes a mobile stage width to viewport-fitted freeform cards', async () => {
        setViewportSize(390, 844);

        const data: StatusCardData = {
            cardType: 'freeform',
            body: 'Stage card',
            meta: {
                html: '<html><body><div style="width:100%;height:240px">stage</div></body></html>',
            },
            style: {},
        };

        render(<StatusCardRenderer data={data} />);

        const frame = screen.getByTitle('Freeform creative card') as HTMLIFrameElement;
        const postMessageSpy = vi.spyOn(frame.contentWindow!, 'postMessage');

        loadFrame(frame);

        await waitFor(() => {
            expect(postMessageSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'preview-update',
                    stageWidth: 360,
                }),
                '*',
            );
        });
    });

    it('injects host font and stable Date status layout overrides when requested', async () => {
        setViewportSize(390, 800);

        const data: StatusCardData = {
            cardType: 'freeform',
            body: 'Date status card',
            meta: {
                html: '<!DOCTYPE html><html><head><style>.date-status-v2{width:330px;max-width:calc(100vw - 24px)}</style></head><body><main class="status-card-frame"><section class="date-status-v2 date-registry__module">状态</section></main></body></html>',
            },
            style: {},
        };

        render(
            <StatusCardRenderer
                data={data}
                customFont="data:font/woff2;base64,AAAA"
                stabilizeDateStatusLayout
            />,
        );

        const frame = screen.getByTitle('Freeform creative card') as HTMLIFrameElement;
        const postMessageSpy = vi.spyOn(frame.contentWindow!, 'postMessage');

        loadFrame(frame);

        await waitFor(() => {
            expect(postMessageSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'preview-update',
                    html: expect.stringContaining('--status-card-host-viewport-width:390px'),
                }),
                '*',
            );
        });

        const postedHtml = String(postMessageSpy.mock.calls[0]?.[0]?.html || '');
        expect(postedHtml).toContain('--status-card-host-width:min(330px,calc(var(--status-card-host-viewport-width) - 24px))');
        expect(postedHtml).toContain('.status-card-frame,.date-status-v2,.date-registry__module{width:var(--status-card-host-width)!important');
        expect(postedHtml).toContain('@font-face{font-family:"StatusCardHostFont"');
        expect(postedHtml).toContain('--cn-serif:var(--status-card-host-font)');
        expect(postedHtml).toContain('.status-card-frame,.status-card-frame *{font-family:var(--status-card-host-font)!important}');
    });

    it('renders custom text cards with the dedicated non-fallback shell', () => {
        const data: StatusCardData = {
            cardType: 'custom_text',
            title: 'Location',
            body: '中环泰臣大厦顶层，执行总裁办公室',
            footer: 'Marcus',
            style: {},
        };

        render(<StatusCardRenderer data={data} />);

        expect(screen.getByTestId('custom-text-status-card')).toHaveTextContent('Location');
        expect(screen.getByTestId('custom-text-status-card')).toHaveTextContent('中环泰臣大厦顶层');
        expect(screen.queryByText('Inner Voice')).not.toBeInTheDocument();
    });
});
