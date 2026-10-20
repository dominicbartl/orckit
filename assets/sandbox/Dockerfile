# orckit sandbox base image — what `orc start` runs a worktree's environment in.
#
# Node 22 + a private Docker daemon (so `type: docker` processes start their
# containers *inside* the sandbox, on its network) + the tools orckit itself
# shells out to (lsof, ps, git). Projects layer their own tooling on top via
# `sandbox.dockerfile` (`ARG ORCKIT_BASE` / `FROM ${ORCKIT_BASE}`).
FROM node:22-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg iptables lsof procps git \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 # Resolve `localhost` to 127.0.0.1 before ::1. Dev servers that listen on
 # "localhost" (ng serve, webpack-dev-server, …) would otherwise bind ::1 only,
 # which the entrypoint's localhost bridge (IPv4) can't route to.
 && echo 'precedence ::ffff:0:0/96  100' >> /etc/gai.conf

COPY entrypoint.sh /usr/local/bin/orckit-sandbox-entrypoint
RUN chmod +x /usr/local/bin/orckit-sandbox-entrypoint
ENTRYPOINT ["/usr/local/bin/orckit-sandbox-entrypoint"]
