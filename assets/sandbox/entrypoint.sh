#!/bin/bash
# orckit sandbox entrypoint: prepare the container, then exec the inner
# `orc start` so it is the process `docker run`'s signal proxy and TTY talk to.
set -u

log() { printf '  \033[2msandbox: %s\033[0m\n' "$*" >&2; }

# 1. Seed the sandbox's own home from the Mac-home copies mounted read-only at
#    /orckit-seed (sandbox.copy_home). Once per home volume, again whenever the
#    copy_home list changes (ORCKIT_SEED_KEY), and on --refresh-home. A copy,
#    so a logout/revoke in here never reaches the Mac.
seed_marker="$HOME/.orckit-seeded"
if [ -d /orckit-seed ] && { [ "$(cat "$seed_marker" 2> /dev/null)" != "${ORCKIT_SEED_KEY:-}" ] || [ -n "${ORCKIT_RESEED:-}" ]; }; then
  cp -a /orckit-seed/. "$HOME"/ && printf '%s' "${ORCKIT_SEED_KEY:-}" > "$seed_marker" && log "copied home seeds"
fi

# 2. Private Docker daemon. Its image cache lives on a per-sandbox volume.
rm -f /var/run/docker.pid
dockerd > /var/log/dockerd.log 2>&1 &
for _ in $(seq 1 300); do
  docker info > /dev/null 2>&1 && break
  sleep 0.1
done
if ! docker info > /dev/null 2>&1; then
  log "dockerd did not start — last lines of /var/log/dockerd.log:"
  tail -n 20 /var/log/dockerd.log >&2
fi

# 3. Localhost bridge. Most dev servers bind 127.0.0.1 only, which would make
#    them unreachable at the sandbox's hostname. Route TCP arriving on eth0 to
#    127.0.0.1 instead. Appended after Docker's own PREROUTING rule, so ports
#    published by containers inside the sandbox still go to those containers.
if sysctl -qw net.ipv4.conf.eth0.route_localnet=1 2> /dev/null; then
  iptables -t nat -A PREROUTING -i eth0 -p tcp -j DNAT --to-destination 127.0.0.1 \
    || log "localhost bridge unavailable (iptables failed) — bind servers to 0.0.0.0"
else
  log "localhost bridge unavailable (no route_localnet) — bind servers to 0.0.0.0"
fi

exec "$@"
