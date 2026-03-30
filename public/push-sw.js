self.addEventListener('push', function(event) {
    if (!event.data) return;
    
    try {
        const data = event.data.json();
        
        const title = data.title || 'New Message';
        const options = {
            body: data.body || 'You have a new message from the AI Agent.',
            icon: data.icon || '/icon-192x192.png',
            badge: data.badge || '/icon-192x192.png',
            data: data.url || '/', // URL to open when clicked
            vibrate: [200, 100, 200],
            requireInteraction: true // Keep the notification until the user interacts with it
        };
        
        event.waitUntil(
            self.registration.showNotification(title, options)
        );
    } catch (err) {
        // Fallback if payload isn't JSON
        const text = event.data.text();
        event.waitUntil(
            self.registration.showNotification('SullyOS Notification', {
                body: text,
                icon: '/icon-192x192.png'
            })
        );
    }
});

self.addEventListener('notificationclick', function(event) {
    event.notification.close();
    
    // Open the window/tab associated with the notification data URL
    const urlToOpen = new URL(event.notification.data || '/', self.location.origin).href;
    
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // Check if there is already a window/tab open with the target URL
            for (let i = 0; i < windowClients.length; i++) {
                const client = windowClients[i];
                if (client.url === urlToOpen && 'focus' in client) {
                    return client.focus();
                }
            }
            // If not, open a new window/tab
            if (self.clients.openWindow) {
                return self.clients.openWindow(urlToOpen);
            }
        })
    );
});
