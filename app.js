#!/usr/bin/env node

'use strict';
import os from 'os'
import path from 'path';
import dotenv from 'dotenv'
import fs from 'fs'
import { fileURLToPath } from 'url';

global.cacheStats = {};

// debug module is already loaded by the time we do dotenv.config
// so refresh the status of DEBUG env var
import debug from 'debug'
debug.enable(process.env.DEBUG || "nexexp:app,nexexp:error");

const debugLog = debug("nexexp:app");
const debugLogError = debug("nexexp:error");
const debugPerfLog = debug("nexexp:actionPerformace");
const debugAccessLog = debug("nexexp:access");

import express from 'express'
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import session from 'express-session';
import csurf from 'csurf';
import config from './app/config.js'
import simpleGit from 'simple-git';
import utils from './app/utils.js'

import moment from 'moment';
import Decimal from 'decimal.js';
import pug from 'pug'
import momentDurationFormat from 'moment-duration-format';
import coreApi from './app/api/coreApi.js';
import coins from './app/coins.js';
import axios from 'axios';
import qrcode from 'qrcode'
import addressApi from './app/api/addressApi.js';
import electrumAddressApi from './app/api/electrumAddressApi.js';
import auth from './app/auth.js';
import jayson from 'jayson'
import global from './app/global.js';


const coinConfig = coins[config.coin];

import { readFileSync } from "fs";

// ./package.json is relative to the current file
const packageJsonPath = "./package.json";

const packageJsonContents = readFileSync(packageJsonPath).toString();

const packageJson = JSON.parse(packageJsonContents);

global.appVersion = packageJson.version


// Assuming you are in a CommonJS module, not ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import baseActionsRouter from './routes/baseActionsRouter.js';
import apiActionsRouter from './routes/apiRouter.js';
import snippetActionsRouter from './routes/snippetRouter.js';
import tokenProcessQueue from './app/tokenProcessQueue.js';
import tokenLoadQueue from "./app/tokenLoadQueue.js";

var app = express();

// view engine setup
app.set('views', path.join(__dirname, 'views'));

// ref: https://blog.stigok.com/post/disable-pug-debug-output-with-expressjs-web-app
app.engine('pug', (path, options, fn) => {
	options.debug = false;
	return pug.__express.call(null, path, options, fn);
});

app.set('view engine', 'pug');

// basic http authentication
if (process.env.EXAEXP_BASIC_AUTH_PASSWORD) {
	app.disable('x-powered-by');
	app.use(auth(process.env.EXAEXP_BASIC_AUTH_PASSWORD));
}

// uncomment after placing your favicon in /public
//app.use(favicon(__dirname + '/public/favicon.ico'));
//app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(session({
	secret: config.cookieSecret,
	resave: false,
	saveUninitialized: false
}));

app.use(express.static(path.join(__dirname, 'public')));

let appStatus = 1;

app.use((req, res, next) => {
	if (appStatus) {
		return next();
	}
	throw new Error('App is closing');
})

app.locals.global = global;

process.on("unhandledRejection", (reason, p) => {
	debugLog("Unhandled Rejection at: Promise", p, "reason:", reason, "stack:", (reason != null ? reason.stack : "null"));
});

process.on('SIGINT', async (signal) => {
	// process.exit(0);
	appStatus = 0;
	console.log('*** Signal received ****');
	console.log('*** App will be closed in 3 sec ****');
	await shutdownProcedure()
})

async function shutdownProcedure() {
	await tokenProcessQueue.destroy()
	await tokenLoadQueue.destroy()
	// await electrumAddressApi.shutdown()
	console.log('*** App is now closing ***');
	setTimeout(process.exit(0), 3000);
}


function loadMiningPoolConfigs() {
	debugLog("Loading mining pools config");

	global.miningPoolsConfigs = [];

	var miningPoolsConfigDir = path.join(__dirname, "public", "txt", "mining-pools-configs", global.coinConfig.ticker);

	fs.readdir(miningPoolsConfigDir, function(err, files) {
		if (err) {
			utils.logError("3ufhwehe", err, {configDir:miningPoolsConfigDir, desc:"Unable to scan directory"});

			return;
		}

		files.forEach(function(file) {
			var filepath = path.join(miningPoolsConfigDir, file);

			var contents = fs.readFileSync(filepath, 'utf8');

			global.miningPoolsConfigs.push(JSON.parse(contents));
		});

		for (var i = 0; i < global.miningPoolsConfigs.length; i++) {
			for (var x in global.miningPoolsConfigs[i].payout_addresses) {
				if (global.miningPoolsConfigs[i].payout_addresses.hasOwnProperty(x)) {
					global.specialAddresses[x] = {type:"minerPayout", minerInfo:global.miningPoolsConfigs[i].payout_addresses[x]};
				}
			}
		}
	});
}

async function getSourcecodeProjectMetadata() {
	var options = {
		url: "https://api.github.com/repos/sickpig/bch-rpc-explorer",
		headers: {
			'User-Agent': 'axios'
		}
	};

	try {
		const response = await axios(options);
		global.sourcecodeProjectMetadata = response.data;
	} catch(err) {
			utils.logError("3208fh3ew7eghfg", err);
	}
}

function loadChangelog() {
	var filename = "CHANGELOG.md";

	fs.readFile(path.join(__dirname, filename), 'utf8', function(err, data) {
		if (err) {
			utils.logError("2379gsd7sgd334", err);

		} else {
			global.changelogMarkdown = data;
		}
	});
}

function loadHistoricalDataForChain(chain) {
	debugLog(`Loading historical data for chain=${chain}`);

	if (config.donations.addresses && config.donations.addresses[coinConfig.ticker]) {
		global.specialAddresses[config.donations.addresses[coinConfig.ticker].address] = {type:"donation"};
	}

	if (global.coinConfig.historicalData) {
		global.coinConfig.historicalData.forEach(function(item) {
			if (item.chain == chain) {
				if (item.type == "blockheight") {
					global.specialBlocks[item.blockHash] = item;

				} else if (item.type == "tx") {
					global.specialTransactions[item.txid] = item;

				} else if (item.type == "address") {
					global.specialAddresses[item.address] = {type:"fun", addressInfo:item};
				}
			}
		});
	}
}

function verifyRpcConnection() {
	if (!global.activeBlockchain) {
		debugLog(`Verifying RPC connection...`);

		coreApi.getNetworkInfo().then(function(getnetworkinfo) {
			coreApi.getBlockchainInfo().then(function(getblockchaininfo) {
				global.activeBlockchain = getblockchaininfo.chain;

				// we've verified rpc connection, no need to keep trying
				clearInterval(global.verifyRpcConnectionIntervalId);

				onRpcConnectionVerified(getnetworkinfo, getblockchaininfo);

			}).catch(function(err) {
				utils.logError("329u0wsdgewg6ed", err);
			});
		}).catch(function(err) {
			utils.logError("32ugegdfsde", err);
		});
	}
}

function onRpcConnectionVerified(getnetworkinfo, getblockchaininfo) {
	// localservicenames introduced in 0.19
	var services = getnetworkinfo.localservicesnames ? ("[" + getnetworkinfo.localservicesnames.join(", ") + "]") : getnetworkinfo.localservices;

	global.getnetworkinfo = getnetworkinfo;

	var bitcoinCoreVersionRegex = /^.*\/Exana\:(.*)\/.*$/;

	var match = bitcoinCoreVersionRegex.exec(getnetworkinfo.subversion);
	if (match) {
		global.btcNodeVersion = match[1];

		var semver4PartRegex = /^([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)$/;

		var semver4PartMatch = semver4PartRegex.exec(global.btcNodeVersion);
		if (semver4PartMatch) {
			var p0 = semver4PartMatch[1];
			var p1 = semver4PartMatch[2];
			var p2 = semver4PartMatch[3];
			var p3 = semver4PartMatch[4];

			// drop last segment, which usually indicates a bug fix release which is (hopefully) irrelevant for RPC API versioning concerns
			global.btcNodeSemver = `${p0}.${p1}.${p2}`;

		} else {
			var semver3PartRegex = /^([0-9]+)\.([0-9]+)\.([0-9]+)$/;

			var semver3PartMatch = semver3PartRegex.exec(global.btcNodeVersion);
			if (semver3PartMatch) {
				var p0 = semver3PartMatch[1];
				var p1 = semver3PartMatch[2];
				var p2 = semver3PartMatch[3];

				global.btcNodeSemver = `${p0}.${p1}.${p2}`;

			} else {
				// short-circuit: force all RPC calls to pass their version checks - this will likely lead to errors / instability / unexpected results
				global.btcNodeSemver = "1000.1000.0"
			}
		}
	} else {
		// short-circuit: force all RPC calls to pass their version checks - this will likely lead to errors / instability / unexpected results
		global.btcNodeSemver = "1000.1000.0"

		debugLogError(`Unable to parse node version string: ${getnetworkinfo.subversion} - RPC versioning will likely be unreliable. Is your node a compatible with the Exana protocol?`);
	}

	debugLog(`RPC Connected: version=${getnetworkinfo.version} subversion=${getnetworkinfo.subversion}, parsedVersion(used for RPC versioning)=${global.btcNodeSemver}, protocolversion=${getnetworkinfo.protocolversion}, chain=${getblockchaininfo.chain}, services=${services}`);

	// load historical/fun items for this chain
	loadHistoricalDataForChain(global.activeBlockchain);

	if (global.activeBlockchain == "exana") {
		if (global.exchangeRates == null) {
			utils.refreshExchangeRates();
		}

		// refresh exchange rate periodically
		setInterval(utils.refreshExchangeRates, 1800000);

		// UTXO pull
		refreshUtxoSetSummary();
		setInterval(refreshUtxoSetSummary, 30 * 60 * 1000);

		// 1d / 7d volume
		refreshNetworkVolumes();
		setInterval(refreshNetworkVolumes, 30 * 60 * 1000);
	}
}

function refreshUtxoSetSummary() {
	if (config.slowDeviceMode) {
		global.utxoSetSummary = null;
		global.utxoSetSummaryPending = false;

		debugLog("Skipping performance-intensive task: fetch UTXO set summary. This is skipped due to the flag 'slowDeviceMode' which defaults to 'true' to protect slow nodes. Set this flag to 'false' to enjoy UTXO set summary details.");

		return;
	}

	// flag that we're working on calculating UTXO details (to differentiate cases where we don't have the details and we're not going to try computing them)
	global.utxoSetSummaryPending = true;

	coreApi.getUtxoSetSummary().then(function(result) {
		global.utxoSetSummary = result;

		result.lastUpdated = Date.now();

		debugLog("Refreshed utxo summary: " + JSON.stringify(result, utils.bigIntToRawJSON));
	});
}

function refreshNetworkVolumes() {
	if (config.slowDeviceMode) {
		debugLog("Skipping performance-intensive task: fetch last 24 hrs of blockstats to calculate transaction volume. This is skipped due to the flag 'slowDeviceMode' which defaults to 'true' to protect slow nodes. Set this flag to 'false' to enjoy UTXO set summary details.");

		return;
	}

	var cutoff1d = new Date().getTime() - (60 * 60 * 24 * 1000);
	var cutoff7d = new Date().getTime() - (60 * 60 * 24 * 7 * 1000);

	coreApi.getBlockchainInfo().then(function(result) {
		var promises = [];

		var blocksPerDay = 720 + 30; // 30 block (1hr) padding

		for (var i = 0; i < (blocksPerDay * 1); i++) {
			if (result.blocks - i >= 0) {
				promises.push(coreApi.getBlockStats(result.blocks - i));
			}
		}

		var startBlock = result.blocks;

		var endBlock1d = result.blocks;
		var endBlock7d = result.blocks;

		var endBlockTime1d = 0;
		var endBlockTime7d = 0;

		Promise.all(promises).then(function(results) {
			var volume1d = new Decimal(0);
			var volume7d = new Decimal(0);

			var blocks1d = 0;
			var blocks7d = 0;

			if (results && results.length > 0 && results[0] != null) {
				for (var i = 0; i < results.length; i++) {
					if (results[i].time * 1000 > cutoff1d) {
						volume1d = volume1d.plus(new Decimal(results[i].total_out));
						volume1d = volume1d.plus(new Decimal(results[i].subsidy));
						volume1d = volume1d.plus(new Decimal(results[i].totalfee));
						blocks1d++;

						endBlock1d = results[i].height;
						endBlockTime1d = results[i].time;
					}

					if (results[i].time * 1000 > cutoff7d) {
						volume7d = volume7d.plus(new Decimal(results[i].total_out));
						volume7d = volume7d.plus(new Decimal(results[i].subsidy));
						volume7d = volume7d.plus(new Decimal(results[i].totalfee));
						blocks7d++;

						endBlock7d = results[i].height;
						endBlockTime7d = results[i].time;
					}
				}

				debugLog("Volume 1d", volume1d);
				debugLog("Volume 7d", volume7d);

				global.networkVolume = {d1:{amt:volume1d, blocks:blocks1d, startBlock:startBlock, endBlock:endBlock1d, startTime:results[0].time, endTime:endBlockTime1d}};

				debugLog(`Network volume: ${JSON.stringify(global.networkVolume)}`);

			} else {
				debugLog("Unable to load network volume.");
			}
		});
	});
}


app.onStartup = function() {
	global.appStartTime = new Date().getTime();
	global.config = config;
	global.coinConfig = coins[config.coin];
	global.coinConfigs = coins;

	global.specialTransactions = {};
	global.specialBlocks = {};
	global.specialAddresses = {};

	loadChangelog();

	if (global.sourcecodeVersion == null && fs.existsSync('.git')) {
		simpleGit(".").log(["-n 1"], function(err, log) {
			if (err) {
				utils.logError("3fehge9ee", err, {desc:"Error accessing git repo"});

				debugLog(`Starting ${global.coinConfig.ticker} RPC Explorer, v${global.appVersion} (code: unknown commit)`);

			} else {
				global.sourcecodeVersion = log.all[0].hash.substring(0, 10);
				global.sourcecodeDate = log.all[0].date.substring(0, "0000-00-00".length);

				debugLog(`Starting ${global.coinConfig.ticker} RPC Explorer, v${global.appVersion} (commit: '${global.sourcecodeVersion}', date: ${global.sourcecodeDate})`);
			}

			app.continueStartup();
		});

	} else {
		debugLog(`Starting ${global.coinConfig.ticker} RPC Explorer, v${global.appVersion}`);

		app.continueStartup();
	}
}

app.continueStartup = async function() {
	let rpcCred = config.credentials.rpc;
	debugLog(`Connecting to RPC node at [${rpcCred.host}]:${rpcCred.port}`);

	let usernamePassword = `${rpcCred.username}:${rpcCred.password}`;
	let authorizationHeader = `Basic ${btoa(usernamePassword)}`; // basic auth header format (base64 of "username:password")

	var rpcClientProperties = {
		host: rpcCred.host,
		port: rpcCred.port,
		username: rpcCred.username,
		password: rpcCred.password,
		timeout: rpcCred.timeout,
		reviver: utils.intToBigInt,
		replacer: utils.bigIntToRawJSON
	};

	debugLog(`RPC Connection properties: ${JSON.stringify(utils.obfuscateProperties(rpcClientProperties, ["password"]), null, 4)}`);

	// add after logging to avoid logging base64'd credentials
	rpcClientProperties.headers = {
		"Authorization": authorizationHeader
	};

	// main RPC client
	global.rpcClient = jayson.Client.http(rpcClientProperties);

	let rpcClientNoTimeoutProperties = {
		host: rpcCred.host,
		port: rpcCred.port,
		username: rpcCred.username,
		password: rpcCred.password,
		timeout: 0,
		headers: {
			"Authorization": authorizationHeader
		},
		reviver: utils.intToBigInt,
		replacer: utils.bigIntToRawJSON
	};

	// no timeout RPC client, for long-running commands
	global.rpcClientNoTimeout = jayson.Client.http(rpcClientNoTimeoutProperties);


	// keep trying to verify rpc connection until we succeed
	// note: see verifyRpcConnection() for associated clearInterval() after success
	verifyRpcConnection();
	global.verifyRpcConnectionIntervalId = setInterval(verifyRpcConnection, 30000);


	if (config.donations.addresses) {
		var getDonationAddressQrCode = function(coinId) {
			qrcode.toDataURL(config.donations.addresses[coinId].address, function(err, url) {
				global.donationAddressQrCodeUrls[coinId] = url;
			});
		};

		global.donationAddressQrCodeUrls = {};

		config.donations.addresses.coins.forEach(function(item) {
			getDonationAddressQrCode(item);
		});
	}

	if (config.addressApi) {
		var supportedAddressApis = addressApi.getSupportedAddressApis();
		if (!supportedAddressApis.includes(config.addressApi)) {
			utils.logError("32907ghsd0ge", `Unrecognized value for EXAEXP_ADDRESS_API: '${config.addressApi}'. Valid options are: ${supportedAddressApis}`);
		}

		if (config.addressApi == "electrumx") {
			if (config.electrumXServers && config.electrumXServers.length > 0) {
				await electrumAddressApi.connectToServers().then(async function() {
					global.electrumAddressApi = electrumAddressApi;
					await electrumAddressApi.subscribeToBlockHeaders()
				}).catch(function(err) {
					utils.logError("31207ugf4e0fed", err, {electrumXServers:config.electrumXServers});
				});
			} else {
				utils.logError("327hs0gde", "You must set the 'EXAEXP_ELECTRUMX_SERVERS' environment variable when EXAEXP_ADDRESS_API=electrumx.");
			}
		}
	}


	loadMiningPoolConfigs();

	//load known tokens
	global.firstRun = true;
	global.processingTokens = false;
	global.tokenImages = [];

	// disable projects metadat a till we
	// find a proper API for gitlab
	//getSourcecodeProjectMetadata();
	//if (config.demoSite) {
	//	setInterval(getSourcecodeProjectMetadata, 3600000);
	//}

	utils.logMemoryUsage();
	setInterval(utils.logMemoryUsage, 5000);
	if(config.syncTokens){
		// first run on boot up
		await coreApi.readKnownTokensIntoCache()
		// run every 30 mins incase we miss a block notification
		setInterval(async function () {
			try {
				await coreApi.readKnownTokensIntoCache()
			} catch (err) {
				debugLog(err)
				global.processingTokens = false
			}

		}, 1800000)
	}
};

app.use(function(req, res, next) {
	req.startTime = Date.now();
	req.startMem = process.memoryUsage().heapUsed;

	next();
});

app.use(function(req, res, next) {
	// make session available in templates
	res.locals.session = req.session;

	if (config.credentials.rpc && req.session.host == null) {
		req.session.host = config.credentials.rpc.host;
		req.session.port = config.credentials.rpc.port;
		req.session.username = config.credentials.rpc.username;
	}

	var userAgent = req.headers['user-agent'];

	// make a bunch of globals available to templates
	res.locals.config = global.config;
	res.locals.coinConfig = global.coinConfig;
	res.locals.activeBlockchain = global.activeBlockchain;
	res.locals.exchangeRates = global.exchangeRates;
	res.locals.utxoSetSummary = global.utxoSetSummary;
	res.locals.utxoSetSummaryPending = global.utxoSetSummaryPending;
	res.locals.networkVolume = global.networkVolume;
	res.locals.rpcClient = global.rpcClient;

	res.locals.host = req.session.host;
	res.locals.port = req.session.port;

	res.locals.genesisBlockHash = coreApi.getGenesisBlockHash();
	res.locals.genesisCoinbaseTransactionId = coreApi.getGenesisCoinbaseTransactionId();

	res.locals.pageErrors = [];

	// currency format type
	if (!req.session.currencyFormatType) {
		var cookieValue = req.cookies['user-setting-currencyFormatType'];

		if (cookieValue) {
			req.session.currencyFormatType = cookieValue;

		} else {
			req.session.currencyFormatType = "";
		}
	}

	// theme
	if (!req.session.uiTheme) {
		var cookieValue = req.cookies['user-setting-uiTheme'];

		if (cookieValue) {
			req.session.uiTheme = cookieValue;

		} else {
			req.session.uiTheme = "dark";
		}
	}

	// blockPage.showTechSummary
	if (!req.session.blockPageShowTechSummary) {
		var cookieValue = req.cookies['user-setting-blockPageShowTechSummary'];

		if (cookieValue) {
			req.session.blockPageShowTechSummary = cookieValue;

		} else {
			req.session.blockPageShowTechSummary = "true";
		}
	}

	// homepage banner
	if (!req.session.hideHomepageBanner) {
		var cookieValue = req.cookies['user-setting-hideHomepageBanner'];

		if (cookieValue) {
			req.session.hideHomepageBanner = cookieValue;

		} else {
			req.session.hideHomepageBanner = "false";
		}
	}

	res.locals.currencyFormatType = req.session.currencyFormatType;
	global.currencyFormatType = req.session.currencyFormatType;


	if (!["/", "/connect"].includes(req.originalUrl)) {
		if (utils.redirectToConnectPageIfNeeded(req, res)) {
			return;
		}
	}

	if (req.session.userMessage) {
		res.locals.userMessage = req.session.userMessage;

		if (req.session.userMessageType) {
			res.locals.userMessageType = req.session.userMessageType;

		} else {
			res.locals.userMessageType = "warning";
		}

		req.session.userMessage = null;
		req.session.userMessageType = null;
	}

	if (req.session.query) {
		res.locals.query = req.session.query;

		req.session.query = null;
	}

	// make some var available to all request
	// ex: req.cheeseStr = "cheese";

	next();
});

app.use(csurf(), (req, res, next) => {
	res.locals.csrfToken = req.csrfToken();
	next();
});

app.use('/', baseActionsRouter);
app.use('/api/', apiActionsRouter);
app.use('/snippet/', snippetActionsRouter);

/// catch 404 and forwarding to error handler
app.use(function(req, res, next) {
	var err = new Error(`Not Found: ${req ? req.url : 'unknown url'}`);
	err.status = 404;

	next(err);
});

/// error handlers


const sharedErrorHandler = (req, err) => {
	if (err && err.message && err.message.includes("Not Found")) {
		const path = err.toString().substring(err.toString().lastIndexOf(" ") + 1);
		const userAgent = req.headers['user-agent'];
		const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

		const attributes = { path:path };

		debugLogError(`404 NotFound: path=${path}, ip=${ip}, userAgent=${userAgent}`);

		utils.logError(`NotFound`, err, attributes, false);

	} else {
		utils.logError("ExpressUncaughtError", err);
	}
};

// development error handler
// will print stacktrace
if (app.get("env") === "development" || app.get("env") === "local") {
	app.use(function(err, req, res, next) {
		if (err) {
			sharedErrorHandler(req, err);
		}

		res.status(err.status || 500);
		res.render('error', {
			message: err.message,
			error: err
		});
	});
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
	console.log(err)
	if (err) {
		sharedErrorHandler(req, err);
	}

	res.status(err.status || 500);
	res.render('error', {
		message: err.message,
		error: {}
	});
});

app.locals.moment = moment;
app.locals.Decimal = Decimal;
app.locals.utils = utils;



export default app;
