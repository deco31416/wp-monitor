#!/bin/sh
set -eu

exec /usr/bin/setpriv \
    --reuid=1000 \
    --regid=1000 \
    --clear-groups \
    --inh-caps=-all,+net_raw,+net_admin \
    --ambient-caps=-all,+net_raw,+net_admin \
    --bounding-set=-all,+net_raw,+net_admin \
    --nnp \
    /usr/local/bin/node \
    /app/dist/capture-agent.js
