#!/bin/bash
set -e

echo "🚀 Initialisation de mautrix-meta pour Clever Cloud"

# Vérifier les variables d'environnement requises
if [ -z "$POSTGRESQL_ADDON_URI" ]; then
    echo "❌ POSTGRESQL_ADDON_URI manquant!"
    exit 1
fi

# Générer le fichier de configuration depuis le template
echo "📝 Génération de la configuration..."

# Générer des tokens aléatoires
AS_TOKEN=$(openssl rand -hex 32)
HS_TOKEN=$(openssl rand -hex 32)

cat > /app/config.yaml << EOF
# Configuration mautrix-meta
homeserver:
    address: http://localhost:8008
    domain: localhost

appservice:
    id: mautrix-meta
    as_token: $AS_TOKEN
    hs_token: $HS_TOKEN
    address: http://0.0.0.0:29318
    hostname: 0.0.0.0
    port: 29318

    database:
        type: postgres
        uri: ${POSTGRESQL_ADDON_URI}
        max_open_conns: 20
        max_idle_conns: 2

    bot:
        username: metabot
        displayname: Meta Bridge Bot
        avatar: mxc://localhost/avatar

bridge:
    username_template: meta_{userid}
    displayname_template: '{displayname} (Meta)'

    permissions:
        "*": "user"

    encryption:
        allow: false
        default: false
        require: false
        appservice: false

    sync_direct_chat_list: true
    initial_chat_sync: 10
    message_status_events: true
    delivery_receipts: true
    disable_bridge_notices: false

meta:
    mode: ${MAUTRIX_MODE:-both}
    ig_e2ee: false

logging:
    min_level: ${LOG_LEVEL:-info}
    writers:
        - type: stdout
          format: pretty-colored
EOF

echo "✅ Configuration générée"

# Lancer l'API wrapper en arrière-plan
if [ "${ENABLE_API_WRAPPER}" = "true" ]; then
    echo "🌐 Démarrage de l'API wrapper HTTP..."
    cd /app/api-wrapper
    node server.js &
    API_PID=$!
    echo "✅ API wrapper démarrée (PID: $API_PID)"
fi

# Lancer mautrix-meta
echo "🔧 Démarrage de mautrix-meta..."
echo "📍 Mode: ${MAUTRIX_MODE:-both}"
echo "🔓 Encryption: DISABLED"
echo "📱 Instagram E2EE: DISABLED"

exec /usr/bin/mautrix-meta -c /app/config.yaml