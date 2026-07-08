const WS_ENABLED = false;

class WSClient {
    constructor() {
        this.ws = null;
        this.reconnectTimer = null;
        this.statusEl = null;
        this.dotEl = null;
    }

    init() {
        this.statusEl = document.getElementById('connection-status');
        this.dotEl = document.getElementById('status-dot');

        if (!this.statusEl) {
            return;
        }

        if (!WS_ENABLED) {
            this.setStatus('Offline');
            return;
        }

        this.connect();
    }

    setStatus(status) {
        if (this.statusEl) {
            this.statusEl.textContent = status;
        }

        if (this.dotEl) {
            this.dotEl.classList.toggle('online', status === 'Online');
            this.dotEl.classList.toggle('offline', status !== 'Online');
        }
    }

    connect() {
        const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
        const url = `${protocol}://${location.host}/ws`;

        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            this.setStatus('Online');
        };

        this.ws.onclose = () => {
            this.setStatus('Offline');

            clearTimeout(this.reconnectTimer);

            this.reconnectTimer = setTimeout(() => {
                this.connect();
            }, 5000);
        };

        this.ws.onerror = () => {
            this.setStatus('Offline');
        };

        this.ws.onmessage = event => {
            window.dispatchEvent(
                new CustomEvent('ws:message', {
                    detail: event.data
                })
            );
        };
    }
}

window.wsClient = new WSClient();

document.addEventListener('layout:ready', () => {
    window.wsClient.init();
});