# strfry runs the write policy as a subprocess, so the interpreter has to exist inside
# the relay image. The upstream image is Alpine carrying only /bin/sh — no node, python
# or perl — so this adds the one package the plugin needs and nothing else.
#
# Alpine 3.18 ships Node 18. The plugin only uses node:readline, node:url and plain ESM,
# so it does not need the Node 22 the client's package.json asks for; that engine floor
# is for Vite, which never runs here.
FROM ghcr.io/hoytech/strfry:latest

USER root
RUN apk add --no-cache nodejs
USER strfry
