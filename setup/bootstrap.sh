#!/bin/bash

echo "Installing apt packages..."
cat apt.txt | xargs apt-get -y install

sudo mkdir -p /var/cache/floobits/jobs/
