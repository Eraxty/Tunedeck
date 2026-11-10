#!/usr/bin/env bash
# ALSA is compiled out (nintendosdk tag selects the stubs); playback goes through PulseAudio.
# Builds a fully static armv7 go-librespot for the TV.
# The TV runs glibc 2.24 with a soft-float loader (/lib/ld-linux.so.3), so the
# upstream armhf release can't run on it; a static binary has no loader dependency.
set -euo pipefail
cd "$(dirname "$0")"

VERSION="${GLR_VERSION:-v0.10.5}"
if [ ! -d src ]; then
  git clone -q --depth 1 --branch "$VERSION" https://github.com/devgianlu/go-librespot src
fi

DOCKER_BUILDKIT=0 docker build \
  --build-arg TARGET=arm-linux-gnueabihf \
  --build-arg TRIPLET=arm-linux \
  --build-arg GOARCH=arm --build-arg GOARM=7 --build-arg GOAMD64= \
  --build-arg GOCC=arm-linux-gnueabihf-gcc \
  --build-arg VERSION="${VERSION#v}" \
  -f Dockerfile -t spotify-webos-engine src

mkdir -p out
docker run --rm -u "$(id -u):$(id -g)" -v "$PWD/src":/src spotify-webos-engine /bin/sh -c '
  go build -o ./go-librespot -trimpath -tags netgo,osusergo,nintendosdk \
    -ldflags "-s -w -linkmode external -extldflags -static -X github.com/devgianlu/go-librespot.version=$VERSION" \
    ./cmd/daemon'
mv src/go-librespot out/go-librespot
file out/go-librespot
