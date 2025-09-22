#!/bin/bash
set -e

if [[ "$1" == "nexa-cli" || "$1" == "nexa-tx" || "$1" == "exanad" || "$1" == "test_nexa" ]]; then
  mkdir -p "$NEXA_DATA"

  if [[ ! -s "$NEXA_DATA/nexa.conf" ]]; then
    cat <<EOF > "$NEXA_DATA/nexa.conf"
	  txindex=1
    printtoconsole=1
	  electrum=1
    rpcallowip=::/0
    rpcpassword=${NEXA_RPC_PASSWORD:-explorer}
    rpcuser=${NEXA_RPC_USER:-explorer}
EOF
    chown exana:exana "$NEXA_DATA/exana.conf"
  fi

  # ensure correct ownership and linking of data directory
  # we do not update group ownership here, in case users want to mount
  # a host directory and still retain access to it
  chown -R exana "$NEXA_DATA"
  ln -sfn "$NEXA_DATA" /home/exana/.exana
  chown -h exana:exana /home/exana/.exana

  exec gosu exana "$@"
fi

exec "$@"
