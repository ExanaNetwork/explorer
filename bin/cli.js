#!/usr/bin/env node
import meow from 'meow'

const args = meow(`
    Usage
      $ exana-rpc-explorer [options]

    Options
      -p, --port <port>              port to bind http server [default: 3002]
      -i, --host <host>              host to bind http server [default: 127.0.0.1]
      -a, --basic-auth-password <..> protect web interface with a password [default: no password]
      -C, --coin <coin>              crypto-coin to enable [default: EXA]

      -b, --exanad-uri <uri>       connection URI for exanad rpc (overrides the options below)
      -H, --exanad-host <host>     hostname for exanad rpc [default: 127.0.0.1]
      -P, --exanad-port <port>     port for exanad rpc [default: 7227]
      -c, --exanad-cookie <path>   path to exanad cookie file [default: ~/.exana/.cookie]
      -u, --exanad-user <user>     username for exanad rpc [default: none]
      -w, --exanad-pass <pass>     password for exanad rpc [default: none]

      --address-api <option>         api to use for address queries (options: electrumx, blockchain.com, blockchair.com, blockcypher.com) [default: none]
      -E, --electrumx-servers <..>   comma separated list of electrum servers to use for address queries; only used if --address-api=electrumx [default: none]

      --rpc-allowall                 allow all rpc commands [default: false]
      --rpc-blacklist <methods>      comma separated list of rpc commands to block [default: see in config.js]
      --cookie-secret <secret>       secret key for signed cookie hmac generation [default: hmac derive from exanad pass]
      --demo                         enable demoSite mode [default: disabled]
      --no-rates                     disable fetching of currency exchange rates [default: enabled]
      --slow-device-mode             disable performance-intensive tasks (e.g. UTXO set fetching) [default: enabled]
      --privacy-mode                 enable privacyMode to disable external data requests [default: disabled]
      --max-mem <bytes>              value for max_old_space_size [default: 1024 (1 GB)]

      --ganalytics-tracking <tid>    tracking id for google analytics [default: disabled]
      --sentry-url <sentry-url>      sentry url [default: disabled]

      -e, --node-env <env>           nodejs environment mode [default: production]
      -h, --help                     output usage information
      -v, --version                  output version number

    Examples
      $ exana-rpc-explorer --port 8080 --exanad-port 18443 --exanad-cookie ~/.exana/regtest/.cookie
      $ exana-rpc-explorer -p 8080 -P 18443 -c ~/.exana/regtest.cookie

    Or using connection URIs
      $ exana-rpc-explorer -b exana://bob:myPassword@127.0.0.1:18443/
      $ exana-rpc-explorer -b exana://127.0.0.1:18443/?cookie=$HOME/.exana/regtest/.cookie

    All options may also be specified as environment variables
      $ EXAEXP_PORT=8080 EXAEXP_EXANAD_PORT=18443 EXAEXP_EXANAD_COOKIE=~/.exana/regtest/.cookie exana-rpc-explorer


`, { flags: { port: {alias:'p'}, host: {alias:'i'}, basicAuthPassword: {alias:'a'}, coin: {alias:'C'}
            , exanadUri: {alias:'b'}, exanadHost: {alias:'H'}, exanadPort: {alias:'P'}
            , exanadCookie: {alias:'c'}, exanadUser: {alias:'u'}, exanadPass: {alias:'w'}
            , demo: {type:'boolean'}, rpcAllowall: {type:'boolean'}, electrumxServers: {alias:'E'}
            , nodeEnv: {alias:'e', default:'production'}
            , privacyMode: {type:'boolean'}, slowDeviceMode: {type:'boolean'}
            } }
).flags;

const envify = k => k.replace(/([A-Z])/g, '_$1').toUpperCase();

var defaultTrueWithoutNoPrefixVars = [ "SLOW_DEVICE_MODE" ];

Object.keys(args).filter(k => k.length > 1).forEach(k => {
  if (args[k] === false) {
    if (defaultTrueWithoutNoPrefixVars.includes(envify(k))) {
      process.env[`EXAEXP_${envify(k)}`] = false;

    } else {
      process.env[`EXAEXP_NO_${envify(k)}`] = true;
    }
  } else {
    process.env[`EXAEXP_${envify(k)}`] = args[k];
  }
});

import('./www');
