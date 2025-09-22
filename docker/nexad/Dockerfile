FROM --platform=linux/amd64 ubuntu:20.04

RUN groupadd -r nexa && useradd -r -m -g nexa nexa

RUN set -ex \
	&& apt-get update \
	&& apt-get install -qq --no-install-recommends ca-certificates dirmngr gosu wget \
	&& rm -rf /var/lib/apt/lists/*

ENV NEXA_VERSION 1.4.0.1
ENV NEXA_URL https://bitcoinunlimited.info/nexa/1.4.0.1/nexa-1.4.0.1-linux64.tar.gz
ENV NEXA_SHA256 d57ba947edec39783681c776f2968bbde313398390256693d6df4e40bd01fc94

# install nexa binaries
RUN set -ex \
	&& cd /tmp \
	&& wget -qO nexa.tar.gz "$NEXA_URL" \
	&& echo "$NEXA_SHA256 nexa.tar.gz" | sha256sum -c - \
	&& tar -xzvf nexa.tar.gz -C /usr/local --strip-components=1 --exclude=*-qt \
	&& rm -rf /tmp/*

# create data directory
ENV NEXA_DATA /data
RUN mkdir "$NEXA_DATA" \
	&& chown -R exana:exana "$NEXA_DATA" \
	&& ln -sfn "$NEXA_DATA" /home/exana/.exana \
	&& chown -h exana:exana /home/exana/.exana
VOLUME /data

COPY ./docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
ENTRYPOINT ["/docker-entrypoint.sh"]


EXPOSE 7228 7227 7230 7229 20001 20002

CMD ["exanad"]
