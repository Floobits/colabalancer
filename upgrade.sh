#!/bin/bash

if [ $# -eq 0 ]
then
  echo "Usage: $0 release-name.tar.gz"
  exit 0
fi

TARBALL=$1
RELEASE_NAME=$(basename "$TARBALL")
RELEASE_NAME="${RELEASE_NAME%%.*}"
RELEASE_DIR="/data/releases/$RELEASE_NAME"

mkdir $RELEASE_DIR && \
tar xzf $TARBALL --directory $RELEASE_DIR && \
cd $RELEASE_DIR && \
HOME=/tmp npm rebuild --unsafe-perm && \
cp /data/colabalancer/lib/local_settings.js $RELEASE_DIR/lib/local_settings.js && \
ln -s -f $RELEASE_DIR /data/colabalancer-new && \
mv -T -f /data/colabalancer-new /data/colabalancer && \
sv restart /service/colabalancer && \
echo "Successfully updated to $RELEASE_NAME"
