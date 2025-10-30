const WebSocket = require('ws');
const http = require('http');

const server = http.createServer();
const wss = new WebSocket.Server({ server });

// Store connected clients
const clients = new Set();

// WebSocket connection handler
wss.on('connection', (ws) => {
    // Add new client to the set
    clients.add(ws);

    // Handle incoming messages
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            // Broadcast new media uploads to all connected clients
            if (data.type === 'new_media') {
                broadcastToAll({
                    type: 'new_media',
                    media: data.media
                });
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    // Handle client disconnection
    ws.on('close', () => {
        clients.delete(ws);
    });

    // Send initial connection confirmation
    ws.send(JSON.stringify({ type: 'connected' }));
});

// Broadcast message to all connected clients
function broadcastToAll(message) {
    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(message));
        }
    });
}

// Start the server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`WebSocket server is running on port ${PORT}`);
});