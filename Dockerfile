# Dockerfile optimisé pour Clever Cloud - mautrix-meta SANS encryption
FROM dock.mau.dev/mautrix/meta:latest

# Installation des dépendances supplémentaires
RUN apk add --no-cache nodejs npm curl bash

# Répertoire de travail
WORKDIR /app

# Copier les fichiers nécessaires
COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY config-template.yaml /app/config-template.yaml
COPY api-wrapper/ /app/api-wrapper/

# Installer les dépendances Node.js pour l'API wrapper
WORKDIR /app/api-wrapper
RUN npm install --production

# Retour au répertoire principal
WORKDIR /app

# Permissions
RUN chmod +x /docker-entrypoint.sh

# Port pour Clever Cloud
EXPOSE 8080

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

# Point d'entrée
ENTRYPOINT ["/docker-entrypoint.sh"]