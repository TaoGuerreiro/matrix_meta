#!/bin/bash
set -e

echo "🚀 Initialisation de mautrix-meta pour Clever Cloud"

# Vérifier les variables d'environnement requises
if [ -z "$POSTGRESQL_ADDON_URI" ]; then
    echo "❌ POSTGRESQL_ADDON_URI manquant!"
    exit 1
fi

# Générer le fichier de configuration
echo "📝 Génération de la configuration..."

# Générer des tokens aléatoires
AS_TOKEN=$(openssl rand -hex 32)
HS_TOKEN=$(openssl rand -hex 32)

cat > /app/config.yaml << 'CONFIG_END'
homeserver:
    address: http://localhost:8008
    domain: localhost

appservice:
    id: meta
    as_token: REPLACE_AS_TOKEN
    hs_token: REPLACE_HS_TOKEN

    address: http://0.0.0.0:29318
    hostname: 0.0.0.0
    port: 29318

    database:
        type: postgres
        uri: REPLACE_DB_URI
        max_open_conns: 20
        max_idle_conns: 2

    bot:
        username: metabot
        displayname: Meta Bridge Bot

bridge:
    username_template: "meta_{{.}}"
    displayname_template: "{{or .DisplayName .Username}} (Meta)"

    # Permissions configuration
    permissions:
        "*": user
        "@admin:localhost": admin

    # Encryption settings
    encryption:
        allow: false
        default: false
        require: false

    # Other bridge settings
    sync_direct_chat_list: true
    initial_chat_sync: 10
    message_status_events: true
    delivery_receipts: true

meta:
    mode: REPLACE_MODE
    ig_e2ee: false

logging:
    min_level: REPLACE_LOG_LEVEL
    writers:
        - type: stdout
          format: pretty-colored
CONFIG_END

# Remplacer les variables
sed -i "s|REPLACE_AS_TOKEN|$AS_TOKEN|g" /app/config.yaml
sed -i "s|REPLACE_HS_TOKEN|$HS_TOKEN|g" /app/config.yaml
sed -i "s|REPLACE_DB_URI|${POSTGRESQL_ADDON_URI}|g" /app/config.yaml
sed -i "s|REPLACE_MODE|${MAUTRIX_MODE:-both}|g" /app/config.yaml
sed -i "s|REPLACE_LOG_LEVEL|${LOG_LEVEL:-info}|g" /app/config.yaml

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