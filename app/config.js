import fs from 'fs'
import crypto from 'crypto'
import url from 'url'
import coins from './coins.js';
import credentials from './credentials.js';

var currentCoin = process.env.NEXEXP_COIN || "NEX";
var richListPath = process.env.NEXEXP_RICHLIST_PATH || "/tmp/rich_list.csv";
var utxoPath = process.env.NEXEXP_UTXO_PATH || "/tmp/utxo.csv";

var rpcCred = credentials.rpc;

if (rpcCred.cookie && !rpcCred.username && !rpcCred.password && fs.existsSync(rpcCred.cookie)) {
  console.log(`Loading RPC cookie file: ${rpcCred.cookie}`);

  [ rpcCred.username, rpcCred.password ] = fs.readFileSync(rpcCred.cookie).toString().split(':', 2);

  if (!rpcCred.password) {
    throw new Error(`Cookie file ${rpcCred.cookie} in unexpected format`);
  }
}

var cookieSecret = process.env.NEXEXP_COOKIE_SECRET
 || (rpcCred.password && crypto.createHmac('sha256', JSON.stringify(rpcCred))
                               .update('nex-rpc-explorer-cookie-secret').digest('hex'))
 || "0x000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f";


var electrumXServerUriStrings = (process.env.NEXEXP_ELECTRUMX_SERVERS || "").split(',').filter(Boolean);
var electrumXServers = [];
for (var i = 0; i < electrumXServerUriStrings.length; i++) {
  var uri = url.parse(electrumXServerUriStrings[i]);

  electrumXServers.push({protocol:uri.protocol.substring(0, uri.protocol.length - 1), host:uri.hostname, port:parseInt(uri.port)});
}


var corsAllowedServersStrings = (process.env.NEXEXP_CORS_SERVERS || "").split(',').filter(Boolean);
var corsAllowedServers = [];
for (var i = 0; i < corsAllowedServersStrings.length; i++) {
  try {
    url.parse(corsAllowedServersStrings[i]);
    corsAllowedServers.push(corsAllowedServersStrings[i]);
  }catch (err) {
    console.log(err)
  }
}

["NEXEXP_DEMO", "NEXEXP_PRIVACY_MODE", "NEXEXP_NO_INMEMORY_RPC_CACHE", "NEXEXP_UI_SHOW_RPC", "NEXEXP_HEADER_BY_HEIGHT_SUPPORT", "NEXEXP_BLOCK_BY_HEIGHT_SUPPORT", "NEXEXP_SHOW_NEXTDIFF"].forEach(function(item) {
  if (process.env[item] === undefined) {
    process.env[item] = "false";
  }
});

["NEXEXP_NO_RATES", "NEXEXP_UI_SHOW_TOOLS_SUBHEADER", "NEXEXP_SLOW_DEVICE_MODE", "NEXEXP_HIDE_IP", "NEXEXP_SHOW_PUG_RENDER_STACKTRACE"].forEach(function(item) {
  if (process.env[item] === undefined) {
    process.env[item] = "true";
  }
});

var siteToolsJSON = [
  { "name": "Token Tracker", "url": "/tokens", "desc": "Token Tracker.", "fontawesome": "fas fa-money-bill green-300" },
  { "name": "Node Status", "url": "/node-status", "desc": "Summary of this node: version, network, uptime, etc.", "fontawesome": "fas fa-broadcast-tower green-300" },
  { "name": "Peers", "url": "/peers", "desc": "Detailed info about the peers connected to this node.", "fontawesome": "fas fa-sitemap green-300" },
  { "name": "Browse Blocks", "url": "/blocks", "desc": "Browse all blocks in the blockchain.", "fontawesome": "fas fa-cubes green-300" },
  { "name": "Transaction Stats", "url": "/tx-stats", "desc": "See graphs of total transaction volume and transaction rates.", "fontawesome": "fas fa-chart-bar green-300" },
  { "name": "Txpool Summary", "url": "/txpool-summary", "desc": "Detailed summary of the current txpool for this node.", "fontawesome": "fas fa-clipboard-list green-300" },
  { "name": "Unconfirmed Txs", "url": "/unconfirmed-tx", "desc": "Browse unconfirmed/pending transactions.", "fontawesome": "fas fa-unlock-alt green-300" },
  { "name": `${coins[currentCoin].name} Fun`, "url": "/fun", "desc": "See fun/interesting historical blockchain data.", "fontawesome": "fas fa-certificate green-300" },
  { "name": "Mining Summary", "url": "/mining-summary", "desc": "Summary of recent data about miners.", "fontawesome": "fas fa-chart-pie green-300" },
  { "name": "Block Stats", "url": "/block-stats", "desc": "Summary data for blocks in configurable range.", "fontawesome": "fas fa-layer-group green-300" },
  { "name": "Block Analysis", "url": "/block-analysis", "desc": "Summary analysis for all transactions in a block.", "fontawesome": "fas fa-angle-double-down green-300" },
  { "name": "Difficulty History", "url": "/difficulty-history", "desc": "Graph of difficulty changes over time.", "fontawesome": "fas fa-chart-line green-300" },
  { "name": "Rich List", "url": "/rich-list", "desc": "Top 100 balance addresses", "fontawesome": "fas fa-money-bill-wave green-300" },
  { "name": "Decoder", "url": "/decoder", "desc": "Transaction/script decoder.", "fontawesome": "fas fa-flask green-300" }
];

if (process.env.NEXEXP_UI_SHOW_RPC.toLowerCase() === "true") {
  siteToolsJSON.push({ "name": "RPC Browser", "url": "/rpc-browser", "desc": "Browse the RPC functionality of this node. See docs and execute commands.", "fontawesome": "fas fa-book" })
  siteToolsJSON.push({ "name": "RPC Terminal", "url": "/rpc-terminal", "desc": "Directly execute RPCs against this node.", "fontawesome": "fas fa-terminal" })
}

export default {
  coin: currentCoin,

  cookieSecret: cookieSecret,
  richListPath: richListPath,
  utxoPath: utxoPath,
  renderPugError: (process.env.NEXEXP_SHOW_PUG_RENDER_STACKTRACE == "true"),

  privacyMode: (process.env.NEXEXP_PRIVACY_MODE.toLowerCase() == "true"),
  slowDeviceMode: (process.env.NEXEXP_SLOW_DEVICE_MODE.toLowerCase() == "true"),
  demoSite: (process.env.NEXEXP_DEMO.toLowerCase() == "true"),
  showRpc: (process.env.NEXEXP_UI_SHOW_RPC.toLowerCase() === "true"),
  queryExchangeRates: (process.env.NEXEXP_NO_RATES.toLowerCase() != "true"),
  noInmemoryRpcCache: (process.env.NEXEXP_NO_INMEMORY_RPC_CACHE.toLowerCase() == "true"),
  blockByHeightSupport: (process.env.NEXEXP_BLOCK_BY_HEIGHT_SUPPORT.toLowerCase() == "true"),
  hideIp: (process.env.NEXEXP_HIDE_IP.toLowerCase() == "true"),
  showNextDiff: (process.env.NEXEXP_SHOW_NEXTDIFF.toLowerCase() == "true"),

  rpcConcurrency: (process.env.NEXEXP_RPC_CONCURRENCY || 10),

  rpcBlacklist:
    process.env.NEXEXP_RPC_ALLOWALL  ? []
  : process.env.NEXEXP_RPC_BLACKLIST ? process.env.NEXEXP_RPC_BLACKLIST.split(',').filter(Boolean)
  : [
    "addnode",
    "backupwallet",
    "bumpfee",
    "clearbanned",
    "createmultisig",
    "createwallet",
    "disconnectnode",
    "dumpprivkey",
    "dumpwallet",
    "encryptwallet",
    "generate",
    "generatetoaddress",
    "getaccountaddrss",
    "getaddressesbyaccount",
    "getbalance",
    "getnewaddress",
    "getrawchangeaddress",
    "getreceivedbyaccount",
    "getreceivedbyaddress",
    "gettransaction",
    "getunconfirmedbalance",
    "getwalletinfo",
    "importaddress",
    "importmulti",
    "importprivkey",
    "importprunedfunds",
    "importpubkey",
    "importwallet",
    "invalidateblock",
    "keypoolrefill",
    "listaccounts",
    "listaddressgroupings",
    "listlockunspent",
    "listreceivedbyaccount",
    "listreceivedbyaddress",
    "listsinceblock",
    "listtransactions",
    "listunspent",
    "listwallets",
    "lockunspent",
    "logging",
    "move",
    "preciousblock",
    "pruneblockchain",
    "reconsiderblock",
    "removeprunedfunds",
    "rescanblockchain",
    "savetxpool",
    "sendfrom",
    "sendmany",
    "sendtoaddress",
    "sendrawtransaction",
    "setaccount",
    "setban",
    "setmocktime",
    "setnetworkactive",
    "signmessage",
    "signmessagewithprivatekey",
    "signrawtransaction",
    "signrawtransactionwithkey",
    "stop",
    "submitblock",
    "syncwithvalidationinterfacequeue",
    "verifychain",
    "waitforblock",
    "waitforblockheight",
    "waitfornewblock",
    "walletlock",
    "walletpassphrase",
    "walletpassphrasechange",
  ],

  addressApi:process.env.NEXEXP_ADDRESS_API,
  electrumXServers:electrumXServers,

  corsAllowedServers: corsAllowedServers,

  redisUrl:process.env.NEXEXP_REDIS_URL,

  site: {
    homepage:{
      recentBlocksCount:10
    },
    blockTxPageSize:20,
    addressTxPageSize:10,
    tokenTransferPageSize:100,
    txMaxInput:15,
    browseBlocksPageSize:50,
    addressPage:{
      txOutputMaxDefaultDisplay:10
    },
    valueDisplayMaxLargeDigits: 4,
    header:{
      showToolsSubheader:(process.env.NEXEXP_UI_SHOW_TOOLS_SUBHEADER == "false"),
      dropdowns:[
        {
          title:"Network",
          links:[
            {name: "Testnet", url:"https://testnet-explorer.nexa.org", imgUrl:"/img/logo/nex.svg"},
            {name: "Nexa", url:"https://explorer.nexa.org", imgUrl:"/img/logo/nex.svg"},
          ]
        }
      ]
    },
    subHeaderToolsList:[0, 1, 4, 7, 8, 9], // indexes in "siteTools" below that are shown in the site "sub menu" (visible on all pages except homepage)
    prioritizedToolIdsList: [0, 1, 4, 7, 8, 9, 3, 2, 5, 10, 11, 12, 6, 13],
  },

  credentials: credentials,

  siteTools: siteToolsJSON,

  donations:{
    addresses:{
      coins:["NEXA"],
      sites:{"NEXA":"https://explorer.nexa.org"},

      "NEXA":{address:"nexa:nqtsq5g5wtkt44pfqusjj3wulk2n2pd27lhpzg0m326kcnsj"}
    }
  }
};
