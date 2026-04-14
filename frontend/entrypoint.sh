#!/bin/sh
BACKEND_URL=${BACKEND_URL:-"https://relcon-crm.onrender.com"}
sed -i "s|%%BACKEND_URL%%|${BACKEND_URL}|g" /usr/share/nginx/html/config.js
echo "Backend URL: $BACKEND_URL"
exec nginx -g "daemon off;"
