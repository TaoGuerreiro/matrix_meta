/**
 * API Wrapper HTTP pour mautrix-meta
 * Fournit une interface REST simple pour Instagram/Messenger
 * Messages en CLAIR - pas d'encryption!
 */

const express = require('express');
const axios = require('axios');
const bodyParser = require('body-parser');
const WebSocket = require('ws');

const app = express();
app.use(bodyParser.json());

// Configuration
const API_PORT = process.env.API_PORT || 8080;
const MAUTRIX_URL = process.env.MAUTRIX_URL || 'http://localhost:29318';
const API_TOKEN = process.env.API_AUTH_TOKEN || 'your-secret-token';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'webhook-secret';

// Stockage en mémoire des sessions (en production, utiliser Redis)
const sessions = new Map();
const webhooks = new Map();

// Middleware d'authentification
const authenticate = (req, res, next) => {
    const token = req.headers['x-api-token'] || req.headers['authorization'];
    
    if (token !== `Bearer ${API_TOKEN}` && token !== API_TOKEN) {
        return res.status(401).json({
            success: false,
            error: 'Token d\'authentification invalide'
        });
    }
    
    next();
};

// ==================== ENDPOINTS PUBLICS ====================

/**
 * GET /health
 * Healthcheck pour Clever Cloud
 */
app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        service: 'mautrix-meta-api',
        timestamp: new Date().toISOString()
    });
});

/**
 * GET /
 * Page d'accueil avec documentation
 */
app.get('/', (req, res) => {
    res.json({
        service: 'Mautrix-Meta API Wrapper',
        version: '1.0.0',
        mode: 'Messages en CLAIR (pas d\'encryption)',
        endpoints: {
            health: 'GET /health',
            login: 'POST /api/login',
            logout: 'POST /api/logout',
            conversations: 'GET /api/conversations',
            messages: 'GET /api/messages/:threadId',
            send: 'POST /api/send',
            webhook: 'POST /api/webhook/register',
            websocket: 'WS /ws'
        },
        authentication: 'Utiliser X-API-Token header avec votre token'
    });
});

// ==================== ENDPOINTS API (Authentifiés) ====================

/**
 * POST /api/login
 * Se connecter à Instagram ou Messenger
 */
app.post('/api/login', authenticate, async (req, res) => {
    try {
        const { platform, username, password, twoFactorCode } = req.body;
        
        if (!platform || !username || !password) {
            return res.status(400).json({
                success: false,
                error: 'platform, username et password sont requis'
            });
        }
        
        // Simuler la connexion à mautrix-meta
        // En production, faire l'appel réel à mautrix-meta
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Stocker la session
        sessions.set(sessionId, {
            platform,
            username,
            connectedAt: new Date().toISOString(),
            active: true
        });
        
        console.log(`✅ Connexion réussie: ${username} sur ${platform}`);
        
        res.json({
            success: true,
            sessionId,
            platform,
            username,
            message: 'Connecté avec succès'
        });
        
    } catch (error) {
        console.error('❌ Erreur login:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/conversations
 * Récupérer la liste des conversations
 */
app.get('/api/conversations', authenticate, async (req, res) => {
    try {
        const sessionId = req.headers['x-session-id'];
        
        if (!sessionId || !sessions.has(sessionId)) {
            return res.status(401).json({
                success: false,
                error: 'Session invalide ou expirée'
            });
        }
        
        // Données de test - en production, récupérer depuis mautrix-meta
        const conversations = [
            {
                id: 'thread_1',
                name: 'John Doe',
                platform: 'instagram',
                lastMessage: {
                    text: 'Salut! Comment vas-tu?',
                    timestamp: new Date(Date.now() - 3600000).toISOString(),
                    isRead: false
                },
                unreadCount: 2,
                participants: ['john_doe']
            },
            {
                id: 'thread_2',
                name: 'Marie Martin',
                platform: 'messenger',
                lastMessage: {
                    text: 'A bientôt!',
                    timestamp: new Date(Date.now() - 7200000).toISOString(),
                    isRead: true
                },
                unreadCount: 0,
                participants: ['marie.martin']
            }
        ];
        
        res.json({
            success: true,
            conversations,
            total: conversations.length
        });
        
    } catch (error) {
        console.error('❌ Erreur conversations:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/messages/:threadId
 * Récupérer les messages d'une conversation EN CLAIR
 */
app.get('/api/messages/:threadId', authenticate, async (req, res) => {
    try {
        const { threadId } = req.params;
        const { limit = 50, before } = req.query;
        const sessionId = req.headers['x-session-id'];
        
        if (!sessionId || !sessions.has(sessionId)) {
            return res.status(401).json({
                success: false,
                error: 'Session invalide ou expirée'
            });
        }
        
        // Messages de test EN CLAIR - pas d'encryption!
        const messages = [
            {
                id: 'msg_1',
                threadId,
                text: 'Salut! Comment vas-tu?',  // MESSAGE EN CLAIR!
                senderId: 'john_doe',
                senderName: 'John Doe',
                timestamp: new Date(Date.now() - 3600000).toISOString(),
                isOutgoing: false,
                attachments: [],
                reactions: []
            },
            {
                id: 'msg_2',
                threadId,
                text: 'Ça va bien merci, et toi?',  // MESSAGE EN CLAIR!
                senderId: 'me',
                senderName: 'Moi',
                timestamp: new Date(Date.now() - 3000000).toISOString(),
                isOutgoing: true,
                attachments: [],
                reactions: []
            },
            {
                id: 'msg_3',
                threadId,
                text: 'Super! On se voit demain?',  // MESSAGE EN CLAIR!
                senderId: 'john_doe',
                senderName: 'John Doe',
                timestamp: new Date(Date.now() - 1800000).toISOString(),
                isOutgoing: false,
                attachments: [],
                reactions: [{ emoji: '👍', userId: 'me' }]
            }
        ];
        
        console.log(`📨 Récupération de ${messages.length} messages EN CLAIR pour thread ${threadId}`);
        
        res.json({
            success: true,
            threadId,
            messages,
            hasMore: false
        });
        
    } catch (error) {
        console.error('❌ Erreur messages:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/send
 * Envoyer un message
 */
app.post('/api/send', authenticate, async (req, res) => {
    try {
        const { threadId, text, attachments = [] } = req.body;
        const sessionId = req.headers['x-session-id'];
        
        if (!sessionId || !sessions.has(sessionId)) {
            return res.status(401).json({
                success: false,
                error: 'Session invalide ou expirée'
            });
        }
        
        if (!threadId || !text) {
            return res.status(400).json({
                success: false,
                error: 'threadId et text sont requis'
            });
        }
        
        // Simuler l'envoi
        const messageId = `msg_${Date.now()}`;
        
        console.log(`📤 Message envoyé: "${text}" vers thread ${threadId}`);
        
        // Notifier les webhooks
        for (const [url, config] of webhooks) {
            if (config.events.includes('message.sent')) {
                notifyWebhook(url, {
                    type: 'message.sent',
                    data: {
                        messageId,
                        threadId,
                        text,
                        timestamp: new Date().toISOString()
                    }
                });
            }
        }
        
        res.json({
            success: true,
            messageId,
            threadId,
            timestamp: new Date().toISOString(),
            message: 'Message envoyé avec succès'
        });
        
    } catch (error) {
        console.error('❌ Erreur envoi:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/webhook/register
 * Enregistrer un webhook pour recevoir les événements
 */
app.post('/api/webhook/register', authenticate, async (req, res) => {
    try {
        const { url, events = ['message.received', 'message.sent'], secret } = req.body;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'URL du webhook requise'
            });
        }
        
        webhooks.set(url, {
            events,
            secret: secret || WEBHOOK_SECRET,
            registeredAt: new Date().toISOString()
        });
        
        console.log(`🎯 Webhook enregistré: ${url}`);
        
        res.json({
            success: true,
            url,
            events,
            message: 'Webhook enregistré avec succès'
        });
        
    } catch (error) {
        console.error('❌ Erreur webhook:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ==================== WEBHOOK RECEIVER ====================

/**
 * POST /webhook/receive
 * Recevoir les événements de mautrix-meta
 */
app.post('/webhook/receive', async (req, res) => {
    try {
        const event = req.body;
        
        console.log('🔔 Événement reçu:', event.type);
        
        // Redistribuer aux webhooks enregistrés
        for (const [url, config] of webhooks) {
            if (config.events.includes(event.type)) {
                notifyWebhook(url, event);
            }
        }
        
        res.json({ received: true });
        
    } catch (error) {
        console.error('❌ Erreur réception webhook:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==================== WEBSOCKET ====================

const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
    console.log('🔌 Nouvelle connexion WebSocket');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            if (data.type === 'auth') {
                ws.sessionId = data.sessionId;
                ws.send(JSON.stringify({
                    type: 'auth.success',
                    message: 'Authentifié'
                }));
            }
        } catch (error) {
            console.error('Erreur WebSocket:', error);
        }
    });
    
    ws.on('close', () => {
        console.log('🔌 WebSocket déconnecté');
    });
});

// ==================== HELPERS ====================

async function notifyWebhook(url, event) {
    try {
        await axios.post(url, event, {
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Secret': webhooks.get(url)?.secret || WEBHOOK_SECRET
            },
            timeout: 5000
        });
        console.log(`✅ Webhook notifié: ${url}`);
    } catch (error) {
        console.error(`❌ Erreur notification webhook ${url}:`, error.message);
    }
}

// ==================== SERVEUR ====================

const server = app.listen(API_PORT, '0.0.0.0', () => {
    console.log(`
========================================
   MAUTRIX-META API WRAPPER
========================================

✅ API démarrée sur le port ${API_PORT}
📂 URL: http://0.0.0.0:${API_PORT}
🔓 Token: ${API_TOKEN.substring(0, 10)}...
📨 Mode: Messages en CLAIR (pas d'encryption!)

Endpoints disponibles:
  GET  /                      - Documentation
  GET  /health               - Healthcheck
  POST /api/login            - Connexion
  GET  /api/conversations    - Liste des conversations
  GET  /api/messages/:id     - Messages EN CLAIR
  POST /api/send             - Envoyer un message
  POST /api/webhook/register - Enregistrer webhook
  WS   /ws                   - WebSocket temps réel

Utilisez le header X-API-Token pour l'authentification
    `);
});

// Upgrade HTTP vers WebSocket
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// Gestion propre de l'arrêt
process.on('SIGTERM', () => {
    console.log('\n🚫 Arrêt du serveur...');
    server.close(() => {
        process.exit(0);
    });
});

module.exports = app;