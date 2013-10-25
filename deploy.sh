#!/bin/sh

if [ $# -ne 2 ] && [ $# -ne 1 ]
then
  echo "Usage: $0 release-name.tar.gz hostname"
  exit 0
fi

if [ $# -eq 1 ]
then
  TARBALL=`./build_release.sh`
  HOST=$1
else
  TARBALL=$1
  HOST=$2
fi

RELEASE_NAME=$(basename "$TARBALL")
RELEASE_NAME="${RELEASE_NAME%%.*}"
RELEASE_DIR="/data/releases/$RELEASE_NAME"

echo "Deploying $RELEASE_NAME to $HOST"

scp -C $RELEASE_NAME.tar.gz $HOST:/tmp

ssh $HOST "sudo mkdir /data/releases/$RELEASE_NAME && sudo tar xzf /tmp/$RELEASE_NAME.tar.gz --directory /data/releases/$RELEASE_NAME"
ssh $HOST "sudo cp /data/colabalancer/lib/settings.js /data/releases/$RELEASE_NAME/lib/settings.js"
ssh $HOST "sudo cp -r /data/colabalancer/node_modules /data/releases/$RELEASE_NAME/"
ssh $HOST "cd /data/releases/$RELEASE_NAME && \
sudo npm install && \
sudo npm update && \
sudo ln -s -f /data/releases/$RELEASE_NAME /data/colabalancer-new && \
sudo mv -T -f /data/colabalancer-new /data/colabalancer && \
sudo sv restart /service/colabalancer/"

curl -X POST http://$USER:$USER@dev00.floobits.com/deploy/colabalancer/$HOST
