export const STATUS_CARD_WIDTH_PX = 330;
export const STATUS_CARD_MIN_HEIGHT_PX = 220;
export const STATUS_CARD_MAX_HEIGHT_PX = 560;
export const STATUS_CARD_MAX_VIEWPORT_HEIGHT = 'calc(100vh - 120px)';
export const STATUS_CARD_VIEWPORT_WIDTH_PADDING_PX = 48;
export const STATUS_CARD_MEASURE_BUFFER_PX = 8;

export const STATUS_CARD_IFRAME_SHELL = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
html, body {
    margin: 0;
    padding: 0;
    background: transparent;
    overflow: hidden;
    width: max-content;
    height: max-content;
}
body {
    min-height: 0;
    display: inline-flex;
    align-items: flex-start;
    justify-content: flex-start;
}
#root {
    display: inline-block;
    width: max-content;
    max-width: none;
}
</style>
</head>
<body>
<div id="styles"></div>
<div id="root"></div>
<script>
(function () {
    var root = document.getElementById('root');
    var styles = document.getElementById('styles');
    var activeChannel = null;
    var resizeObserver = null;

    function reportSize() {
        var nextWidth = Math.max(
            Math.ceil(root ? root.getBoundingClientRect().width || 0 : 0),
            document.documentElement.scrollWidth || 0,
            document.body.scrollWidth || 0,
            root ? root.scrollWidth || 0 : 0
        );
        var nextHeight = Math.max(
            Math.ceil(root ? root.getBoundingClientRect().height || 0 : 0),
            document.documentElement.scrollHeight || 0,
            document.body.scrollHeight || 0,
            root ? root.scrollHeight || 0 : 0
        );

        parent.postMessage(
            { type: 'preview-height', channel: activeChannel, width: nextWidth, height: nextHeight },
            '*'
        );
    }

    function scheduleReport() {
        requestAnimationFrame(function () {
            requestAnimationFrame(reportSize);
        });
    }

    function reconnectObserver() {
        if (resizeObserver) {
            resizeObserver.disconnect();
            resizeObserver = null;
        }

        if (typeof ResizeObserver !== 'function') {
            window.setTimeout(scheduleReport, 0);
            return;
        }

        resizeObserver = new ResizeObserver(scheduleReport);

        if (document.body) {
            resizeObserver.observe(document.body);
        }

        if (root) {
            resizeObserver.observe(root);
        }
    }

    window.addEventListener('message', function (event) {
        if (!event.data || event.data.type !== 'preview-update') return;

        var html = typeof event.data.html === 'string' ? event.data.html : '';
        activeChannel = typeof event.data.channel === 'string' ? event.data.channel : null;

        try {
            var parsed = new DOMParser().parseFromString(html, 'text/html');
            var headNodes = [];

            if (parsed.head && parsed.head.children) {
                Array.prototype.forEach.call(parsed.head.children, function (node) {
                    if (node && typeof node.outerHTML === 'string') {
                        headNodes.push(node.outerHTML);
                    }
                });
            }

            styles.innerHTML = headNodes.join('');
            root.innerHTML = parsed.body && parsed.body.innerHTML ? parsed.body.innerHTML : html;
            document.body.style.cssText = 'margin:0;background:transparent;overflow:hidden;min-height:0;display:inline-flex;align-items:flex-start;justify-content:flex-start;width:max-content;';

            if (parsed.body && parsed.body.getAttribute('style')) {
                document.body.style.cssText += parsed.body.getAttribute('style');
            }
        } catch (error) {
            styles.innerHTML = '';
            root.innerHTML = html;
            document.body.style.cssText = 'margin:0;background:transparent;overflow:hidden;min-height:0;display:inline-flex;align-items:flex-start;justify-content:flex-start;width:max-content;';
        }

        reconnectObserver();
        scheduleReport();
    });

    reconnectObserver();
    scheduleReport();
})();
</script>
</body>
</html>`;
