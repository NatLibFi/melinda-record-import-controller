FROM node:12-alpine
ENTRYPOINT ["/entrypoint.sh"]
CMD ["/usr/local/bin/node", "index.js"]
WORKDIR /home/node

COPY --chown=node:node . build
COPY entrypoint.sh /

RUN apk add -U --no-cache --virtual .build-deps git \
  && apk add --no-cache sudo tzdata \  
  && sudo -u node sh -c 'cd build && npm install && npm run build' \
  && sudo -u node cp -r build/package.json build/dist/* . \
  && sudo -u node npm install --prod \
  && sudo -u node npm cache clean -f \
  && apk del .build-deps \
  && rm -rf build tmp/* /var/cache/apk/*