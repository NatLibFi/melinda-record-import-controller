#!/bin/sh
DOCKER_GROUP=$(stat -c '%g' /var/run/docker.sock)

addgroup -g $DOCKER_GROUP docker
addgroup node docker

exec sudo -H -E -u node $@