FROM floobits-base

ADD colabalancer-current.tar.gz /data/colabalancer
WORKDIR /data/colabalancer
RUN npm install

RUN ln -s /data/conf/settings-colabalancer.js /data/colabalancer/lib/settings.js

CMD ["/data/colabalancer/bin/colabalancer"]

EXPOSE 80
EXPOSE 443
EXPOSE 3148
EXPOSE 3448
EXPOSE 8048
EXPOSE 8443
