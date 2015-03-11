#!/bin/sh

./node_modules/eslint/bin/eslint.js \
lib/*.js \
lib/agent/*.js \
tests/*.js
