#!/bin/sh
set -eu

export BASE_PATH="${BASE_PATH:-}"
envsubst '${BASE_PATH}' < /etc/nginx/nginx.conf.template > /etc/nginx/nginx.conf
exec nginx -g 'daemon off;'
