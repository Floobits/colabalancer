#!/bin/bash

cp -r runit /etc/sv/colabalancer

if [ ! -e /etc/service/colabalancer ]
then
    echo "/etc/service/colabalancer doesn't exist. Creating it..."
    ln -s /etc/sv/colabalancer /etc/service/
fi

if [ ! -e /service ]
then
    echo "/service doesn't exist. Creating it..."
    ln -s /etc/service /service
fi

if [ ! -e /etc/service/colabalancer/log/main ]
then
    echo "/etc/service/colabalancer/log/main doesn't exist. Creating it..."
    mkdir /etc/sv/colabalancer/log/main
    chown nobody:root /etc/sv/colabalancer/log/main
fi
