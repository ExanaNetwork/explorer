import debug from "debug";
import express from 'express';
import csurf from 'csurf';
import qrcode from 'qrcode';
import crypto from 'crypto-js';
import Decimal from "decimal.js";
import { Script, ScriptFactory, Address } from 'libexana-ts'
import db from "../models/index.js";


import asyncHandler from "express-async-handler";

import utils from './../app/utils.js';
import tokenApi from './../app/api/tokenApi.js';
import coins from "./../app/coins.js";
import config from "./../app/config.js";
import coreApi from "./../app/api/coreApi.js";
import addressApi from "./../app/api/addressApi.js";
import rpcApi from "./../app/api/rpcApi.js";
import global from "../app/global.js";

import v8 from 'v8';

import electrumAddressApi from "../app/api/electrumAddressApi.js";
import StandardError from "../app/errors/standardError.js";
import marketDataApi from "../app/api/marketDataApi.js";

const debugLog = debug("nexexp:router");

const router = express.Router();
const {sha256, hexEnc} = crypto;
const coinConfig = coins[config.coin];
const { forceCsrf } = csurf;
var Op = db.Sequelize.Op;

function decode(req, res, next) {
	let query = req.params.query;
	res.locals.tokenData = [];
	const promises = [];

	if(req.method === "POST") {
		query = req.body.query
	}
	if (!query) {
		res.locals.decodedScript = "";
		res.locals.tx = undefined;
		res.locals.type = "unknown";
		res.render("decoder");
		utils.perfMeasure(req);
	}

	// Clean up the input in a variety of ways that a cut-paste might have
	let input = query.trim();
	while (input[0] === '"' || input[0] === "'") {
		input = input.slice(1);
	}
	while ((input.length > 0) && ( input[input.length-1] === '"' || input[input.length-1] === "'")) {
		input = input.slice(0,input.length-1);
	}
	if (input.slice(0,2) === "0x") input = input.slice(2);

	promises.push(coreApi.decodeScript(input));
	promises.push(coreApi.decodeRawTransaction(input));
	// promises.push(coreApi.validateRawTransaction(input))

	allSettled(promises).then(function(promiseResults) {
		let decodedScript = promiseResults[0];
		let decodedTx = promiseResults[1];
		res.locals.decodedScript = "";
		res.locals.tx = " ";
		res.locals.inputHex = input
		if ("txid" in decodedTx) {
			res.locals.type = "tx";
			res.locals.userMessage = "";
			res.locals.tx = decodedTx;
			// If tx decodes, assume its a tx because tx hex can be decoded as bad scripts
			res.locals.decodedJson = JSON.stringify(decodedTx, utils.bigIntToRawJSON, 4);
			res.locals.validatedTransaction = promiseResults[2]

		} else if ("asm" in decodedScript) {
			res.locals.type = "script";
			res.locals.userMessage = "";
			res.locals.decodedDetails = utils.prettyScript(decodedScript.asm, '\t');
			res.locals.decodedJson = JSON.stringify(decodedScript, utils.bigIntToRawJSON, 4);
			res.locals.script = new libexana.Script(input).toString()

		} else {
			res.locals.type = "unknown";
			res.locals.userMessage = "Decode failed";
			res.locals.tx = {};
			res.locals.decodedJson = {};
		}
		res.render("decoder");
		utils.perfMeasure(req);
	}).catch(function(err) {
		debugLog(err);
		res.locals.type = "unknown";
		res.locals.userMessage = "Decode failed";
		res.locals.tx = {};
		res.locals.decodedJson = {};

		res.render("decoder");
	});
}

router.get("/", function(req, res, next) {
	if (req.session.host == null || req.session.host.trim() == "") {
		if (req.cookies['rpc-host']) {
			res.locals.host = req.cookies['rpc-host'];
		}

		if (req.cookies['rpc-port']) {
			res.locals.port = req.cookies['rpc-port'];
		}

		if (req.cookies['rpc-username']) {
			res.locals.username = req.cookies['rpc-username'];
		}

		res.render("connect");
		res.end();

		return;
	}

	res.locals.homepage = true;

	// don't need timestamp on homepage "blocks-list", this flag disables
	//res.locals.hideTimestampColumn = true;

	var promises = [];

	promises.push(coreApi.getTxpoolInfo());
	promises.push(coreApi.getMiningInfo());
	promises.push(coreApi.getNetworkHashrate(5040));
	promises.push(coreApi.getNetworkHashrate(21600));

	coreApi.getBlockList({ limit: config.site.homepage.recentBlocksCount }).then(function(data) {
		Object.assign(res.locals, data);

		res.locals.difficultyPeriod = parseInt(Math.floor(data.blockChainInfo.blocks / coinConfig.difficultyAdjustmentBlockCount));

		if (config.showNextDiff) {
			promises.push(new Promise(function(resolve, reject) {
				coreApi.getMiningCandidate().then(function(bt) {
					resolve(bt);
				}).catch(function(err) {
					resolve(null); // ignore being unable to get block template
				});
			}));
		} else {// promiseResults[4]
			promises.push(new Promise(function(resolve, reject) {
				resolve(null);
			}));
		}

		// promiseResults[5]
		promises.push(new Promise(function(resolve, reject) {
			coreApi.getBlockHeaderByHeight(coinConfig.difficultyAdjustmentBlockCount * res.locals.difficultyPeriod).then(function(difficultyPeriodFirstBlockHeader) {
				resolve(difficultyPeriodFirstBlockHeader);
			});
		}));


		if (data.blockChainInfo.chain !== 'regtest') {
			var targetBlocksPerDay = 24 * 60 * 60 / coinConfig.targetBlockTimeSeconds;

			// promiseResults[6] (if not regtest)
			promises.push(coreApi.getTxCountStats(targetBlocksPerDay / 4, -targetBlocksPerDay, "latest"));

			var chainTxStatsIntervals = [ targetBlocksPerDay / 24, targetBlocksPerDay, targetBlocksPerDay * 7]
				.filter(numBlocks => numBlocks <= data.blockChainInfo.blocks);

			res.locals.chainTxStatsLabels = [ "1 hours", "1 day", "1 week"]
				.slice(0, chainTxStatsIntervals.length)
				.concat("All time");

			// promiseResults[7-X] (if not regtest)
			for (var i = 0; i < chainTxStatsIntervals.length; i++) {
				promises.push(coreApi.getChainTxStats(chainTxStatsIntervals[i]));
			}
		}

		if (data.blockChainInfo.chain !== 'regtest') {
			promises.push(coreApi.getChainTxStats(data.blockChainInfo.blocks - 1));
		}

		res.locals.blocksUntilDifficultyAdjustment = ((res.locals.difficultyPeriod + 1) * coinConfig.difficultyAdjustmentBlockCount) - data.blockList[0].height;

		Promise.all(promises).then(async function(promiseResults) {
			res.locals.txpoolInfo = promiseResults[0];
			res.locals.miningInfo = promiseResults[1];
			res.locals.hashrate7d = promiseResults[2];
			res.locals.hashrate30d = promiseResults[3];
			res.locals.processingTokens = global.processingTokens

			if (promiseResults[4]) {
				res.locals.blockTemplate = promiseResults[4];
				res.locals.realDifficulty = utils.getDifficulty(parseInt(promiseResults[4].nBits, 16));
			}

			res.locals.difficultyPeriodFirstBlockHeader = promiseResults[5];

			if (data.blockChainInfo.chain !== 'regtest') {
				res.locals.txStats = promiseResults[6];

				var chainTxStats = [];
				for (var i = 0; i < res.locals.chainTxStatsLabels.length; i++) {
					chainTxStats.push(promiseResults[i + 7]);
				}

				res.locals.chainTxStats = chainTxStats;
			}
			res.locals.topTenTokens = null;
			try {
				res.locals.topTenTokens = await coreApi.getTokens(10, 0, "desc");
			} catch (err) {
				console.log(err)
			}



			res.render("index");
			utils.perfMeasure(req);
		});
	}).catch(function(err) {
		res.locals.userMessage = "Error loading recent blocks: " + err;

		res.render("index");
	});
});

router.get("/node-status", asyncHandler(async (req, res, next) => {
	try {
		var required = [
			{ target: "getblockchaininfo", promise: coreApi.getBlockchainInfo() },
			{ target: "getnetworkinfo", promise: coreApi.getNetworkInfo() },
			{ target: "uptimeSeconds", promise: coreApi.getUptimeSeconds() },
			{ target: "getnettotals", promise: coreApi.getNetTotals() },
			{ target: "gettxpoolinfo", promise: coreApi.getTxpoolInfo() },
		];
		await Promise.allSettled(required.map(r => r.promise)).then(function(promiseResults) {
			var rejects = promiseResults.filter(r => r.status === "rejected");
			if (rejects.length > 0)
				res.locals.userMessage = "Error getting node status: err=" +
					rejects.map(r => r.reason).join('\n');

			promiseResults.map((r, i) => [r, i])
				.filter(r => r[0].status === "fulfilled")
				.forEach(r => res.locals[required[r[1]].target] = r[0].value);

			res.render("node-status");
			utils.perfMeasure(req);
		});
	} catch (err) {
		utils.logError("32978efegdde", err);
		res.locals.userMessage = "Error building page: " + err;
	}
}));

router.get("/txpool-summary", function(req, res, next) {
	res.locals.satoshiPerByteBucketMaxima = coinConfig.feeSatoshiPerByteBucketMaxima;

	coreApi.getTxpoolInfo().then(function(txpoolinfo) {
		res.locals.txpoolinfo = txpoolinfo;

		coreApi.getTxpoolTxids().then(function(txpooltxids) {
			var debugMaxCount = 0;

			var inputChunkSize = 25;
			if (txpooltxids.length > 1000)
				inputChunkSize = 100;

			if (debugMaxCount > 0) {
				var debugtxids = [];
				for (var i = 0; i < Math.min(debugMaxCount, txpooltxids.length); i++) {
					debugtxids.push(txpooltxids[i]);
				}

				res.locals.txpooltxidChunks = utils.splitArrayIntoChunks(debugtxids, inputChunkSize);

			} else {
				res.locals.txpooltxidChunks = utils.splitArrayIntoChunks(txpooltxids, inputChunkSize);
			}

			res.locals.inputChunkSize = inputChunkSize;


			res.render("txpool-summary");
			utils.perfMeasure(req);

		});

	}).catch(function(err) {
		res.locals.userMessage = "Error: " + err;

		res.render("txpool-summary");

	});
});

router.get("/rich-list", function(req, res, next) {
	res.locals.richList = utils.readRichList();
	if (global.miningPoolsConfigs) {
		for(var j = 0; j < res.locals.richList[0].length; j++) {
			let address = res.locals.richList[0][j]['address']
			for (var i = 0; i < global.miningPoolsConfigs.length; i++) {
				if (global.miningPoolsConfigs[i].payout_addresses[address]) {
					res.locals.richList[0][j]['owner'] = global.miningPoolsConfigs[i].payout_addresses[address];
					break;
				}
				if ("exchange_addresses" in global.miningPoolsConfigs[i] && global.miningPoolsConfigs[i].exchange_addresses[address]) {
					res.locals.richList[0][j]['owner'] = global.miningPoolsConfigs[i].exchange_addresses[address];
					break;
				}
			}
		}

	}
	res.render("rich-list");
	utils.perfMeasure(req);
});

router.get("/tokens", function(req, res, next){

	var limit = 24;
	var offset = 0;
	var sort = "desc";


	if (req.query.limit) {
		limit = parseInt(req.query.limit);

		// for demo sites, limit page sizes
		if (config.demoSite && limit > config.site.addressTxPageSize) {
			limit = config.site.addressTxPageSize;

			res.locals.userMessage = "Transaction page size limited to " + config.site.addressTxPageSize + ". If this is your site, you can change or disable this limit in the site config.";
		}
	}

	if (req.query.offset) {
		offset = parseInt(req.query.offset);
	}

	if (req.query.sort) {
		sort = req.query.sort;
	}

	res.locals.limit = limit;
	res.locals.offset = offset;
	res.locals.sort = sort;
	res.locals.paginationBaseUrl = `/tokens?sort=${sort}`;

	let promises = [];
	promises.push(new Promise(function(resolve, reject) {
		coreApi.getTokens(limit, offset, sort).then(function(results){
			resolve(results)
		})
	}));

	promises.push(new Promise(function(resolve, reject) {
		coreApi.getTokenStats(false).then(function(results){
			resolve(results)
		})
	}));

	promises.push(new Promise(function(resolve, reject){
		coreApi.getBlockchainInfo().then(function(result) {
			res.locals.blockChainInfo = result
			resolve()
		}).catch(function(err){
			resolve()
		})
	}));

	Promise.all(promises).then(function(promiseResults) {
		res.locals.tokens = promiseResults[0];
		res.locals.tokenStats = promiseResults[1];
		res.render("tokens");
	})
	.catch(function(err) {
		res.locals.userMessage = "Error: " + err;
		res.render("tokens");
	});
})

router.get("/nfts", function(req, res, next){

	var limit = 24;
	var offset = 0;
	var sort = "desc";
	var filterBy = ''


	if (req.query.limit) {
		limit = parseInt(req.query.limit);

		// for demo sites, limit page sizes
		if (config.demoSite && limit > config.site.addressTxPageSize) {
			limit = config.site.addressTxPageSize;

			res.locals.userMessage = "Transaction page size limited to " + config.site.addressTxPageSize + ". If this is your site, you can change or disable this limit in the site config.";
		}
	}

	if (req.query.offset) {
		offset = parseInt(req.query.offset);
	}

	if (req.query.sort) {
		sort = req.query.sort;
	}

	if (req.query.filterBy) {
		filterBy = req.query.filterBy;
	}

	res.locals.limit = limit;
	res.locals.offset = offset;
	res.locals.sort = sort;
	res.locals.filterBy = filterBy
	res.locals.paginationBaseUrl = `/nfts`;
	res.locals.paginationNewBaseUrl = `/nfts?filterBy=new`;
	res.locals.paginationAllBaseUrl = `/nfts?filterBy=all`;

	let promises = [];
	promises.push(new Promise(function(resolve, reject) {
		let localLimit = limit
		let localOffset = offset
		if(filterBy) {
			localLimit = 24
			localOffset = 0
		}

		coreApi.getNFTsCollection(localLimit, localOffset, sort).then(function(results){
			resolve(results)
		})
	}));

	promises.push(new Promise(function(resolve, reject) {
		coreApi.getTokenStats(true).then(function(results){
			resolve(results)
		})
	}));

	promises.push(new Promise(function(resolve, reject){
		coreApi.getNFTsHoldersCount().then(function(result) {
			resolve(result)
		}).catch(function(err){
			resolve()
		})
	}));

	promises.push(new Promise(function(resolve, reject){
		coreApi.getTotalNFTs().then(function(result) {
			resolve(result)
		}).catch(function(err){
			resolve()
		})
	}));
	promises.push(new Promise(function(resolve, reject){
		coreApi.getTotalNFTsCollectionCount().then(function(result) {
			resolve(result)
		}).catch(function(err){
			resolve()
		})
	}));


	promises.push(new Promise(function(resolve, reject){
		let localLimit = limit
		let localOffset = offset
		if(filterBy != 'new') {
			localLimit = 24
			localOffset = 0
		}
		coreApi.getNewNFTS(localLimit, localOffset).then(function(results) {
			resolve(results)
		}).catch(function(err){
			resolve()
		})
	}));

	promises.push(new Promise(function(resolve, reject){
		let localLimit = limit
		let localOffset = offset
		if(filterBy != 'all') {
			localLimit = 24
			localOffset = 0
		}
		coreApi.getAllNFTs(localLimit, localOffset).then(function(results) {
			resolve(results)
		}).catch(function(err){
			resolve()
		})
	}));

	promises.push(new Promise(function(resolve, reject){
		coreApi.getBlockchainInfo().then(function(result) {
			resolve(result)
		}).catch(function(err){
			resolve()
		})
	}));


	Promise.all(promises).then(function(promiseResults) {
		res.locals.tokens = promiseResults[0];
		res.locals.tokenStats = promiseResults[1];
		res.locals.holdersCount = promiseResults[2]
		res.locals.totalNFTs = promiseResults[3]
		res.locals.collectionCount = promiseResults[4]
		res.locals.newNFTs = promiseResults[5];
		res.locals.allNFTs = promiseResults[6];
		res.locals.blockChainInfo = promiseResults[7];
		res.render("nfts");
	})
	.catch(function(err) {
		res.locals.userMessage = "Error: " + err;
		res.render("nfts");
	});
})


router.get("/collection/:collectionIdentifier", async function(req, res, next){

	var limit = 24;
	var offset = 0;
	var sort = "desc";

	var collectionIdentifier = req.params.collectionIdentifier;
	if(!collectionIdentifier) {
		res.redirect("/");
	}

	if (req.query.limit) {
		limit = parseInt(req.query.limit);

		// for demo sites, limit page sizes
		if (config.demoSite && limit > config.site.addressTxPageSize) {
			limit = config.site.addressTxPageSize;

			res.locals.userMessage = "Transaction page size limited to " + config.site.addressTxPageSize + ". If this is your site, you can change or disable this limit in the site config.";
		}
	}

	if (req.query.offset) {
		offset = parseInt(req.query.offset);
	}

	if (req.query.sort) {
		sort = req.query.sort;
	}

	res.locals.limit = limit;
	res.locals.offset = offset;
	res.locals.sort = sort;
	res.locals.paginationBaseUrl = `/collection/${collectionIdentifier}?sort=${sort}`;
	let collection = null;

	try {
		collection = await db.Collection.findOne({
			where: {
				identifier: collectionIdentifier
			}
		})
	} catch (err) {
		req.session.userMessage = "Error: " + err;
		res.redirect("/");
	}



	let promises = [];
	promises.push(new Promise(function(resolve, reject) {
		coreApi.getNFTsInCollection(limit, offset, sort, collection).then(function(results){
			resolve(results)
		}).catch(function(err){
			resolve()
		})
	}));

	promises.push(new Promise(function(resolve, reject){
		coreApi.getNFTCollectionStats(collection).then(function(result) {
			resolve(result)
		}).catch(function(err){
			resolve()
		})
	}));

	promises.push(new Promise(function(resolve, reject){
		coreApi.getTotalNFTsInCollectionCount(collection).then(function(result) {
			resolve(result)
		}).catch(function(err){
			resolve()
		})
	}));

	Promise.all(promises).then(function(promiseResults) {
		res.locals.collection = collection
		res.locals.tokens = promiseResults[0];
		res.locals.nftStats = promiseResults[1][0]
		res.locals.collectionCount = promiseResults[2]
		res.locals.collectionIdentifier = collectionIdentifier
		res.render("collection");
	})
	.catch(function(err) {
		req.session.userMessage = "Error: " + err;
		res.redirect("/");
	});
})

router.get("/peers", function(req, res, next) {
	coreApi.getPeerSummary().then(async function (peerSummary) {
		res.locals.peerSummary = peerSummary;
		try {
			res.locals.peerIpSummary = await utils.geoLocateIpAddresses(peerSummary);
			res.locals.mapBoxKey = config.credentials.mapBoxKey

			const versionCounts = {};
			const countryCounts = {}
			const hostCounts = {}

			Object.values(res.locals.peerIpSummary.detailsByIp).forEach(item => {
				const version = item.subver;
				if (version) {
					versionCounts[version] = (versionCounts[version] || 0) + 1;
				}

				const country = item.country
				if (country) {
					countryCounts[country] = (countryCounts[country] || 0) + 1;
				}

				const host = item.org
				if (country) {
					hostCounts[host] = (hostCounts[host] || 0) + 1;
				}
			});

			const versionPlotData = utils.sortChartData(Object.keys(versionCounts), Object.values(versionCounts))
			const hostPlotData = utils.sortChartData(Object.keys(hostCounts), Object.values(hostCounts))
			const countryPlotData = utils.sortChartData(Object.keys(countryCounts), Object.values(countryCounts))

			res.locals.versionPlot = {
				labels: versionPlotData.labels,
				data: versionPlotData.data,
				label: "Exana Versions on the network"
			}

			res.locals.hostPlot = {
				labels: hostPlotData.labels,
				data: hostPlotData.data,
				label: "Server hosts on the network"
			}

			res.locals.countryPlot = {
				labels: countryPlotData.labels,
				data: countryPlotData.data,
				label: "Countries where nodes are located"
			}
		} catch (e) {
			debugLog("Cannot load peer ip summary: " + e)
		}
		res.render("peers");
		utils.perfMeasure(req);
	}).catch(function(err) {
		res.locals.userMessage = "Error: " + err;

		res.render("peers");

	});
});

//router.post("/connect", function(req, res, next) {
//	var host = req.body.host;
//	var port = req.body.port;
//	var username = req.body.username;
//	var password = req.body.password;
//
//	res.cookie('rpc-host', host);
//	res.cookie('rpc-port', port);
//	res.cookie('rpc-username', username);
//
//	req.session.host = host;
//	req.session.port = port;
//	req.session.username = username;
//
//	var newClient = new bitcoinCore({
//		host: host,
//		port: port,
//		username: username,
//		password: password,
//		timeout: 30000
//	});
//
//	debugLog("created new rpc client: " + newClient);
//
//	global.rpcClient = newClient;
//
//	req.session.userMessage = "<span class='font-weight-bold'>Connected via RPC</span>: " + username + " @ " + host + ":" + port;
//	req.session.userMessageType = "success";
//
//	res.redirect("/");
//});

// router.get("/disconnect", function(req, res, next) {
// 	res.cookie('rpc-host', "");
// 	res.cookie('rpc-port', "");
// 	res.cookie('rpc-username', "");

// 	req.session.host = "";
// 	req.session.port = "";
// 	req.session.username = "";

// 	debugLog("destroyed rpc client.");

// 	global.rpcClient = null;

// 	req.session.userMessage = "Disconnected from node.";
// 	req.session.userMessageType = "success";

// 	res.redirect("/");
// });

router.get("/changeSetting", function(req, res, next) {
	if (req.query.name) {
		req.session[req.query.name] = req.query.value;

		res.cookie('user-setting-' + req.query.name, req.query.value);
	}

	res.redirect(req.headers.referer);
});

router.get("/blocks", function(req, res, next) {
	var args = {}
	if (req.query.limit)
		args.limit = parseInt(req.query.limit);
	if (req.query.offset)
		args.offset = parseInt(req.query.offset);
	if (req.query.sort)
		args.sort = req.query.sort;

	res.locals.paginationBaseUrl = "/blocks";
	var promises = [];

	promises.push(coreApi.getMiningInfo());

	coreApi.getBlockList(args).then(function(data) {
		Object.assign(res.locals, data);

		Promise.all(promises).then(function(promiseResults) {
			res.locals.miningInfo = promiseResults[0];
			res.render("blocks");
		utils.perfMeasure(req);
		});
	}).catch(function(err) {
		res.locals.userMessage = "Error: " + err;

		res.render("blocks");

		next();
	});
});

router.get("/mining-summary", function(req, res, next) {
	coreApi.getBlockchainInfo().then(function(getblockchaininfo) {
		res.locals.currentBlockHeight = getblockchaininfo.blocks;

		res.render("mining-summary");

		utils.perfMeasure(req);

	}).catch(function(err) {
		res.locals.userMessage = "Error: " + err;

		res.render("mining-summary");

		next();
	});
});

router.get("/block-stats", function(req, res, next) {
	coreApi.getBlockchainInfo().then(function(getblockchaininfo) {
		res.locals.currentBlockHeight = getblockchaininfo.blocks;

		res.render("block-stats");
		utils.perfMeasure(req);


	}).catch(function(err) {
		res.locals.userMessage = "Error: " + err;

		res.render("block-stats");

		next();
	});
});

const allSettled = function(promiseList) {
    let results = new Array(promiseList.length);

    return new Promise((ok, rej) => {

        let fillAndCheck = function(i) {
            return function(ret) {
                results[i] = ret;
                for(let j = 0; j < results.length; j++) {
                    if (results[j] == null) return;
                }
                ok(results);
            }
        };

        for(let i=0;i<promiseList.length;i++) {
            promiseList[i].then(fillAndCheck(i), fillAndCheck(i));
        }
    });
}

router.get("/decoded-script/:scriptHex",function(req, res, next) {
	var hex = req.params.scriptHex;
	var promises = [];
	res.locals.type = "script";

	promises.push(coreApi.decodeScript(hex));

	Promise.all(promises).then(function(results) {
		var decodedScript = results[0];
		res.locals.decodedDetails = utils.prettyScript(decodedScript.asm, '\t');
		res.locals.decodedJson = JSON.stringify(decodedScript, utils.bigIntToRawJSON, 4);
		res.render("decoded-hex");
		utils.perfMeasure(req);

	}).catch(function(err) {
		req.session.userMessage = "Error: " + err;
		res.locals.userMessage = "Decoded failed";
		res.locals.type = "unknown";
		res.render("decoded-hex");
	});
});

router.get("/decoded-tx/:txHex",function(req, res, next) {
	var hex = req.params.txHex;
	var promises = [];
	res.locals.type = "tx";

	promises.push(coreApi.decodeRawTransaction(hex));

	Promise.all(promises).then(function(results) {
		var decodedTx = results[0];
		res.locals.tx = decodedTx;
		res.locals.decodedJson = decodedTx;
		res.render("decoded-hex");
		utils.perfMeasure(req);

	}).catch(function(err) {
		req.session.userMessage = "Error: " + err;
		res.locals.userMessage = "Decoded failed";
		res.locals.type = "unknown";
		res.render("decoded-hex");
	});
});

router.get("/decoder", function(req, res, next) {
	res.locals.decodedScript = "";
	res.locals.tx = undefined;
	res.locals.type = "unknown";
	res.render("decoder");
	utils.perfMeasure(req);
});

router.post('/decoder', function (req, res, next){
	decode(req, res, next)
})

router.get('/decoder/:query', function(req, res, next){
	decode(req, res, next)
})

router.get("/search", function(req, res, next) {
	res.render("search");

});

router.post("/search", async function(req, res, next) {
	if (!req.body.query) {
		req.session.userMessage = "Enter a block height, block hash, transaction id or idem or outpoint.";

		res.redirect("/");

		return;
	}
	utils.search(req, res)
});

router.get("/block-height/:blockHeight", function(req, res, next) {
	var blockHeight = parseInt(req.params.blockHeight);

	res.locals.blockHeight = blockHeight;

	res.locals.result = {};

	var limit = config.site.blockTxPageSize;
	var offset = 0;

	if (req.query.limit) {
		limit = parseInt(req.query.limit);

		// for demo sites, limit page sizes
		if (config.demoSite && limit > config.site.blockTxPageSize) {
			limit = config.site.blockTxPageSize;

			res.locals.userMessage = "Transaction page size limited to " + config.site.blockTxPageSize + ". If this is your site, you can change or disable this limit in the site config.";
		}
	}

	if (req.query.offset) {
		offset = parseInt(req.query.offset);
	}

	res.locals.limit = limit;
	res.locals.offset = offset;
	res.locals.paginationBaseUrl = "/block-height/" + blockHeight;

	rpcApi.getBlockHash(blockHeight).then(function(blockHash) {
		var promises = [];

		promises.push(new Promise(function(resolve, reject) {
			coreApi.getBlockByHashWithTransactions(blockHash, limit, offset).then(function(result) {
				res.locals.result.getblock = result.getblock;
				res.locals.result.transactions = result.transactions;
				res.locals.result.txInputsByTransaction = result.txInputsByTransaction;

				resolve();

			}).catch(function(err) {
				res.locals.pageErrors.push(utils.logError("98493y4758h55", err));

				reject(err);
			});
		}));

		promises.push(new Promise(function(resolve, reject) {
			coreApi.getBlockStats(blockHash).then(function(result) {
				res.locals.result.blockstats = result;

				resolve();

			}).catch(function(err) {
				res.locals.pageErrors.push(utils.logError("983yr435r76d", err));

				reject(err);
			});
		}));

		Promise.all(promises).then(async function() {

			try {
				const TxIds = res.locals.result.transactions.map(elem => elem.txid)
				res.locals.tokenData = await coreApi.getTransactionTokens(TxIds);
			} catch (err){}

			res.render("block");

			utils.perfMeasure(req);

		}).catch(function(err) {

			res.render("block");

		});
	}).catch(function(err) {

		res.locals.pageErrors.push(utils.logError("389wer07eghdd", err));

		res.render("block");

	});
});

router.get("/block/:blockHash", function(req, res, next) {
	var blockHash = req.params.blockHash;

	res.locals.blockHash = blockHash;

	res.locals.result = {};

	var limit = config.site.blockTxPageSize;
	var offset = 0;

	if (req.query.limit) {
		limit = parseInt(req.query.limit);

		// for demo sites, limit page sizes
		if (config.demoSite && limit > config.site.blockTxPageSize) {
			limit = config.site.blockTxPageSize;

			res.locals.userMessage = "Transaction page size limited to " + config.site.blockTxPageSize + ". If this is your site, you can change or disable this limit in the site config.";
		}
	}

	if (req.query.offset) {
		offset = parseInt(req.query.offset);
	}

	res.locals.limit = limit;
	res.locals.offset = offset;
	res.locals.paginationBaseUrl = "/block/" + blockHash;

	var promises = [];

	promises.push(new Promise(async (resolve, reject) => {
		try {
			const result = await coreApi.getBlockByHashWithTransactions(blockHash, limit, offset);

			res.locals.result.getblock = result.getblock;
			res.locals.result.transactions = result.transactions;
			res.locals.result.txInputsByTransaction = result.txInputsByTransaction;

			const TxIds = result.transactions.map(elem => elem.txid);
			res.locals.tokenData = await coreApi.getTransactionTokens(TxIds);

			resolve();
		} catch (err) {
			res.locals.pageErrors.push(utils.logError("238h38sse", err));
			reject(err);
		}
	}));

	promises.push(new Promise(function(resolve, reject) {
		coreApi.getBlockStats(blockHash).then(function(result) {
			res.locals.result.blockstats = result;

			resolve();

		}).catch(function(err) {
			resolve();
		});
	}));

	Promise.all(promises).then(function() {
		res.render("block");
		utils.perfMeasure(req);

	}).catch(function(err) {

		res.render("block");

	});
});

router.get("/block-analysis/:blockHashOrHeight", function(req, res, next) {
	var blockHashOrHeight = req.params.blockHashOrHeight;

	var goWithBlockHash = function(blockHash) {
		var blockHash = blockHash;

		res.locals.blockHash = blockHash;

		res.locals.result = {};

		var txResults = [];

		var promises = [];

		res.locals.result = {};

		coreApi.getBlock(blockHash, true).then(function(block) {
			res.locals.result.getblock = block;

			res.render("block-analysis");
			utils.perfMeasure(req);


		}).catch(function(err) {
			res.locals.pageErrors.push(utils.logError("943h84ehedr", err));

			res.render("block-analysis");

		});
	};

	if (!isNaN(blockHashOrHeight)) {
		coreApi.getBlockByHeight(parseInt(blockHashOrHeight), true).then(function(blockByHeight) {
			goWithBlockHash(blockByHeight.hash);
		});
	} else {
		goWithBlockHash(blockHashOrHeight);
	}
});

router.get("/block-analysis", function(req, res, next) {
	res.render("block-analysis-search");

	utils.perfMeasure(req);
});

/**
 * Parse two-option-vote ballot from a transaction.
 *
 * This is best effort. This may fail or not be a valid vote.
 */
function parseTwoOptionVote(tx) {
	let scriptSig = "";
	try {
		// We assume the vote is in the first input.
		//
		// Technically, it can be in any input, or multiple ballots in multiple
		// inputs.
		scriptSig = tx.vin[0].scriptSig.hex;
	} catch (e) {
		// API change?
		return null;
	}
	const VOTE_REDEEM_SCRIPT = "5479a988547a5479ad557a5579557abb537901147f75537a"
		+ "887b01147f77767b8778537a879b7c14beefffffffffffff"
		+ "ffffffffffffffffffffffff879b";
	if (!scriptSig.endsWith(VOTE_REDEEM_SCRIPT)) {
		return null;
	}

	try {
		// Parse the vote out of it.
		scriptSig = Buffer.from(scriptSig, 'hex');
		let pos = 0;

		// skip vote signature
		const msgSigSize = scriptSig[pos++];
		pos += msgSigSize;

		// Next is the vote itself. It should be 40 bytes.
		// [20 bytes for the election ID] + [20 bytes for the vote]
		//
		// First, there should be a PUSH 40 opcode.
		if (scriptSig[pos++] != 40) {
			return null;
		}
		const electionID = scriptSig.slice(pos, pos + 20).toString('hex');
		const vote = scriptSig.slice(pos + 20, pos + 40).toString('hex');
		return [electionID, vote];

	} catch (e) {
		// Assume invalid vote script.
		return null;
	}
}

/**
 * Guess if transaction is a flipstarter transaction.
 *
 * Flipstarter transactions has all inputs signed as ALL|FORKID|ANYONECANPAY
 * and is around ~4 sat/bytes in fee.
 */
function isFlipstarter(tx, fee) {
  try {
    if (fee < 3.9 || fee > 4.1) {
      return false;
    }
    if (tx.vin[0].coinbase) {
      return false;
    }

    // Assume at least n pledges
    if (tx.vin.length < 3) {
      return false;
    }

    for(let i = 0; i < tx.vin.length; i++) {
      if (!tx.vin[i].scriptSig.asm.includes("ALL|FORKID|ANYONECANPAY")) {
        return false;
      }
    }

    return true;

  } catch (e) {
    // On error, guess that it's not.
    return false;
  }
}

/**
 * If transaction is a 'Transaction Input Payload Contract', this returns the
 * payload it carries. Otherwise null.
 * https://nerdekollektivet.gitlab.io/votepeer-documentation/input-payload-contract/
 */
function getInputPayloadContractPayload(tx) {
	let scriptSig = "";
	try {
		scriptSig = tx.vin[0].scriptSig.hex;
		scriptAsm = tx.vin[0].scriptSig.asm;
	} catch (e) {
		// API change?
		return null;
	}
	const redeemscript_regex = /a97ca97e7ca97e21[a-z0-9]{66}76a97b7ea914[a-z0-9]{40}88ad7491$/;
	if (!scriptSig.match(redeemscript_regex)) {
		return null;
	}
	try {
		const stackElements = scriptAsm.split(' ');
		stackElements.pop(); // redeemscript
		const push3 = stackElements.pop();
		if (push3 === undefined) return null;
		const push2 = stackElements.pop();
		if (push2 === undefined) return null;
		const push1 = stackElements.pop();
		if (push1 === undefined) return null;

		let payload = push3;
		if (push2 !== '0') {
		    payload += push2;
		}
		if (push1 !== '0') {
		    payload += push1;
		}
		return payload;
	}
	catch (e) {
	    console.log(e);
	    return null;
	}
}

// the rendering of a transaction is going to work even if
// transactionIdem or utxo outpoints are used.
router.get("/tx/:transactionIdentifier", function(req, res, next) {
	var txIdentifier = req.params.transactionIdentifier;
	if (txIdentifier.length != 64) {
		const response = utils.logError("2237y4ewssgt", new StandardError({message:"Wrong transaction identifier length"}));
		res.locals.pageErrors.push(response);

		res.render("transaction");
	} else {

		var output = -1;
		if (req.query.output) {
			output = parseInt(req.query.output);
		}

		res.locals.txIdentifier = txIdentifier;
		res.locals.output = output;

		res.locals.result = {};

		// 5 minutes cache span should be short enough
		const FIVE_MIN = 1000 * 60 * 5
		coreApi.getRawTransactionsWithInputs([txIdentifier], -1, FIVE_MIN).then(function(rawTxResult) {
			var tx = rawTxResult.transactions[0];
			res.locals.result.ballot = parseTwoOptionVote(tx);
			res.locals.result.getrawtransaction = tx;
			res.locals.result.rawtransaction_parsed = JSON.stringify(tx, utils.bigIntToRawJSON, 4);

			res.locals.result.txInputs = rawTxResult.txInputsByTransaction[tx.txid]
			res.locals.txid = tx.txid
			res.locals.txidem = tx.txidem
			const fee = tx.fee;
			res.locals.result.isflipstarter = isFlipstarter(tx, fee);
			res.locals.result.inputPayloadContract = getInputPayloadContractPayload(tx);

			var promises = [];

			promises.push(new Promise(function(resolve, reject) {
				coreApi.getTxUtxos(tx).then(function(utxos) {
					if (utxos.every(element => element === null)) {
						res.locals.utxos = null;
					} else {
						res.locals.utxos = utxos;
						res.locals.utxos_parsed = JSON.stringify(utxos, utils.bigIntToRawJSON, 4);
					}

					resolve();

				}).catch(function(err) {
					res.locals.pageErrors.push(utils.logError("3208yhdsghssr", err));

					reject(err);
				});
			}));
			if (tx.confirmations == 0) {

				promises.push(new Promise(function(resolve, reject) {
					coreApi.getTxpoolTxDetails(tx.txid).then(function(txpoolDetails) {
						res.locals.txpoolDetails = txpoolDetails;

						resolve();

					}).catch(function(err) {
						res.locals.pageErrors.push(utils.logError("0q83hreuwgd", err));

						reject(err);
					});
				}));
			}

			if (tx.blockhash !== undefined) {
				promises.push(new Promise(function(resolve, reject) {
					coreApi.getBlockHeader(tx.blockhash).then(function(blockHeader) {
						res.locals.result.blockHeader = blockHeader;
						resolve()
					}).catch(function(err) {
						res.locals.pageErrors.push(utils.logError("1234abc456efd", err));

						reject(err);
					});
				}));
			}

			promises.push(new Promise(function (resolve, reject) {
				coreApi.getTransactionTokens([tx.txid]).then(async function(result){
					res.locals.tokenData = result;
					resolve();
				}).catch(function(err) {
					res.locals.pageErrors.push(utils.logError("132r80h32rh-a", err));

					reject(err);
				});
			}));

			Promise.all(promises).then(function() {

				res.render("transaction");
				utils.perfMeasure(req);

			}).catch(function(err) {
				res.render("transaction");
			});
		}).catch(function(err) {
			res.locals.pageErrors.push(utils.logError("1237y4ewssgt", err));

			res.render("transaction");

		});
	}
});

router.get("/token/:token", async function(req, res, next) {

	res.locals.isSafari = req.headers["user-agent"].includes("Safari") > 0

	var limit = config.site.tokenTransferPageSize;
	var offset = 0;
	var sort = "desc";


	if (req.query.limit) {
		limit = parseInt(req.query.limit);

		// for demo sites, limit page sizes
		if (config.demoSite && limit > config.site.addressTxPageSize) {
			limit = config.site.addressTxPageSize;

			res.locals.userMessage = "Transaction page size limited to " + config.site.addressTxPageSize + ". If this is your site, you can change or disable this limit in the site config.";
		}
	}

	if (req.query.offset) {
		offset = parseInt(req.query.offset);
	}

	if (req.query.sort) {
		sort = req.query.sort;
	}

	var token = req.params.token;

	res.locals.limit = limit;
	res.locals.offset = offset;
	res.locals.sort = sort;
	res.locals.paginationBaseUrl = `/token/${token}?sort=${sort}`;
	res.locals.transfers = [];
	res.locals.tokenIndexWaiting = false;
	res.locals.group = token;


	let isTokenValid = false;
	var prefix = global.activeBlockchain == "exana" ? "exana:" : "exanatest:";
	try {
		var saneToken = "";
		if(!token.includes(prefix)) {
			saneToken = prefix.concat(token);
		} else {
			saneToken = token;
		}
		let decodedAddress = Address.fromString(saneToken)
		if(decodedAddress.isGroupIdentifierAddress()) {
			token = saneToken;
			isTokenValid = true;
		} else {
			console.log("token not valid")
			console.log(decodedAddress.toObject().type)
			console.log(decodedAddress.toObject().data)
		}
	} catch(err3) {
		//res.locals.pageErrors.push(utils.logError("address parsing error", err3));
	}

	if (!isTokenValid) {
		req.session.userMessage = "No results found for query: " + token;
		res.redirect("/");
	}
	let indexedToken = null;
	let tokenGenesis = null;

	try {
		indexedToken = await db.Token.findOne({
			where: {
				group: token
			}
		})
	} catch(err) {
		debugLog('Cannot find Indexed Token: ', err)
		debugLog('Cannot find Indexed Token: ', token)
	}

	try {
		tokenGenesis = await coreApi.getTokenGenesis(token);
	} catch(err){
		debugLog('Token Genesis doesnt exist: ', token)
	}

	// We havent indexed the token but it exists on the chain
	if(indexedToken == null && tokenGenesis != null){
		res.locals.tokenIndexWaiting = true
		res.render("token");
		utils.perfMeasure(req);
	}
	if(indexedToken == null && tokenGenesis == null) {
		req.session.userMessage = "No results found for query: " + token;
		res.redirect("/");
	}

	coreApi.getTokenGenesis(token).then(async function(result){
		var promises = [];
		if(result) {
			res.locals.token = token;
			res.locals.tokenInfo = result
			try {
				res.locals.script = new Script(result.op_return).toString()
			} catch(err){
				debugLog("Cannot parse Script:", err)
			}

			// Get mintage data of token
			promises.push(new Promise(function(resolve, reject) {
				tokenApi.getTokenSupply(token).then(function(result) {
					resolve(result);
				}).catch(function(err) {
					debugLog(err)
					resolve(null);
				});
			}));

			// Get transaction string
			promises.push(new Promise(function(resolve, reject) {
				coreApi.getRawTransaction(res.locals.tokenInfo.txid).then(function(tx) {
					resolve(tx);
				}).catch(function(err) {
					debugLog(err)
					resolve(null);
				});
			}));

			// Get Token operations
			promises.push(new Promise(function(resolve, reject){
				coreApi.getTokenOperations(token).then(async function(result){
					resolve(result)
				}).catch(function(err){
					debugLog(err)
					resolve(null)
				})
			}));

			// Get market info
			promises.push(new Promise(function(resolve, reject){
				marketDataApi.loadMarketDataForTicker(res.locals.tokenInfo.ticker).then(async function(result){
					resolve(result)
				}).catch(function(err){
					debugLog(err)
					resolve(null)
				})
			}));

			// Get Transfers from token API
			promises.push(new Promise(function(resolve, reject){
				let page = res.locals.offset >= res.locals.transfersCount
					? 1
					: Math.floor(res.locals.offset / res.locals.limit) + 1;

				coreApi.getTransfersForToken(token, res.locals.limit, page).then(async function(result){
					resolve(result)
				}).catch(function(err){
					debugLog(err)
					resolve()
				})
			}));

			// Get richlist from token api and process it to have more data
			promises.push(new Promise(function(resolve, reject){
				coreApi.getRichList(token).then(async function(result){
					resolve(result)
				}).catch(function(err){
					debugLog(err)
					resolve(null)
				})
			}));

			// Get Token Object from SQLite
			promises.push(new Promise(function(resolve, reject){
				coreApi.getStatsForToken(token).then(async function(result){
					resolve(result)
				}).catch(function(err){
					debugLog(err)
					resolve(null)
				})
			}));


			// Get Token holders count
			promises.push(new Promise(function(resolve, reject){
				tokenApi.fetchAuthories(token).then(async function(result){
					if(result.length !== 0) {
						resolve(result[0])
					} else {
						resolve(null)
					}
					resolve(result)
				}).catch(function(err){
					debugLog(err)
					resolve(null)
				})
			}));

			// Get Token authorities
			promises.push(new Promise(function(resolve, reject){
				coreApi.getTokenHolders(token).then(async function(result){
					resolve(result)
				}).catch(function(err){
					debugLog(err)
					resolve(null)
				})
			}));

			Promise.all(promises).then(function(promiseData) {
				if(promiseData[0]) {
					res.locals.tokenMintage = promiseData[0];
					res.locals.totalSupply = promiseData[0].supply
					res.locals.circulatingSupply = promiseData[0].supply
					res.locals.totalSupplyUnformatted = BigInt(promiseData[0].rawSupply)
					res.locals.circulatingSupplyUnformatted = BigInt(promiseData[0].rawSupply)

					res.locals.totalSupply = utils.addThousandsSeparators(res.locals.totalSupply)
					res.locals.circulatingSupply = utils.addThousandsSeparators(res.locals.circulatingSupply)
				}

				if(promiseData[1]){
					res.locals.getrawtransaction = promiseData[1];
					res.locals.rawtransaction_parsed = JSON.stringify(promiseData[1], utils.bigIntToRawJSON, 4);
				}

				if(promiseData[2]) {
					res.locals.tokenOperations = promiseData[2]
					res.locals.transfersCount = promiseData[2].transfer
				}

				if(promiseData[3]){
					res.locals.marketInfo = promiseData[3].marketData ?? []
					res.locals.priceInfo = promiseData[3].priceData ?? 'N/A'
				}

				if(promiseData[4]) {
					res.locals.transfers = promiseData[4];
				}

				if(promiseData[5]){
					for(var i = 0; i < promiseData[5].length; i++){
						let item = promiseData[5][i]
						const percentage = res.locals.totalSupplyUnformatted ? (Number(item.amount) / Number(res.locals.totalSupplyUnformatted)) * 100 : BigInt(0);
						const formattedBalance = res.locals.tokenInfo.decimal_places > 0
							? String(item.amount).slice(0, - res.locals.tokenInfo.decimal_places) +
							"." + String(item.amount).slice(- res.locals.tokenInfo.decimal_places)
							: item.amount

						item.percentage =  new Intl.NumberFormat('en-us', { maximumSignificantDigits: 2 }).format(
							percentage,
						);
						item.net_amount = formattedBalance
					}
					res.locals.richList = promiseData[5];
				}

				if(promiseData[6]) {
					res.locals.tokenObj = promiseData[6];
				}

				if(promiseData[7]) {
					res.locals.authorityInfo = promiseData[7]
				}

				if(promiseData[8]){
					res.locals.tokenHolders = promiseData[8].total;
				}

				res.render("token");
				utils.perfMeasure(req);
			}).catch(function(err) {
				console.log(err)
				req.session.userMessage = "No results found for query: " + token;
				res.redirect("/");
			});
		}
	}).catch(function (err) {
		console.log(err)
		req.session.userMessage = "No results found for query: " + token;
		res.redirect("/");
	});
});

router.get("/address/:address", function(req, res, next) {
	var limit = config.site.addressTxPageSize;
	var offset = 0;
	var sort = "desc";


	if (req.query.limit) {
		limit = parseInt(req.query.limit);

		// for demo sites, limit page sizes
		if (config.demoSite && limit > config.site.addressTxPageSize) {
			limit = config.site.addressTxPageSize;

			res.locals.userMessage = "Transaction page size limited to " + config.site.addressTxPageSize + ". If this is your site, you can change or disable this limit in the site config.";
		}
	}

	if (req.query.offset) {
		offset = parseInt(req.query.offset);
	}

	if (req.query.sort) {
		sort = req.query.sort;
	}


	var address = req.params.address;

	res.locals.address = address;
	res.locals.limit = limit;
	res.locals.offset = offset;
	res.locals.sort = sort;
	res.locals.paginationBaseUrl = `/address/${address}?sort=${sort}`;
	res.locals.transactions = [];
	res.locals.addressApiSupport = addressApi.getCurrentAddressApiFeatureSupport();
	res.locals.tokens = new Set();
	res.locals.tokenGenesisList = [];
	res.locals.tokenData = [];


	res.locals.result = {};
	try {
		var saneAddress = "";
		var prefix = global.activeBlockchain === "exana" ? "exana:" : "exanatest:";
		if(!address.includes(prefix)) {
			saneAddress = prefix.concat(address);
		} else {
			saneAddress = address;
		}
		res.locals.addressObj = Address.fromString(saneAddress).toObject()
	} catch(err3) {
		res.locals.pageErrors.push(utils.logError("address parsing error", err3));
	}

	if (global.miningPoolsConfigs) {
		for (var i = 0; i < global.miningPoolsConfigs.length; i++) {
			if (global.miningPoolsConfigs[i].payout_addresses[address]) {
				res.locals.payoutAddressForMiner = global.miningPoolsConfigs[i].payout_addresses[address];
				break;
			}
		}
	}

	coreApi.getAddress(address).then(function(validateaddressResult) {
		res.locals.result.validateaddress = validateaddressResult;

		var promises = [];
		if (!res.locals.crawlerBot) {
			var addrScripthash = crypto.enc.Hex.stringify(crypto.SHA256(crypto.enc.Hex.parse(validateaddressResult.scriptPubKey)));
			addrScripthash = addrScripthash.match(/.{2}/g).reverse().join("");

			res.locals.electrumScripthash = addrScripthash;

			promises.push(new Promise(function(resolve, reject) {
				addressApi.getAddressDetails(address, validateaddressResult.scriptPubKey, sort, limit, offset).then(function(addressDetailsResult) {
					var addressDetails = addressDetailsResult.addressDetails;

					if (addressDetailsResult.errors) {
						res.locals.addressDetailsErrors = addressDetailsResult.errors;
					}

					if (addressDetails) {
						res.locals.addressDetails = addressDetails;

						if (addressDetails.balanceSat == 0) {
							// make sure zero balances pass the falsey check in the UI
							addressDetails.balanceSat = "0";
						}

						if (addressDetails.txCount == 0) {
							// make sure txCount=0 pass the falsey check in the UI
							addressDetails.txCount = "0";
						}

						if (addressDetails.txids) {
							var txids = addressDetails.txids;

							// if the active addressApi gives us blockHeightsByTxid, it saves us work, so try to use it
							var blockHeightsByTxid = {};
							if (addressDetails.blockHeightsByTxid) {
								blockHeightsByTxid = addressDetails.blockHeightsByTxid;
							}

							res.locals.txids = txids;

							coreApi.getRawTransactionsWithInputs(txids).then(function(rawTxResult) {
								res.locals.transactions = rawTxResult.transactions;
								res.locals.txInputsByTransaction = rawTxResult.txInputsByTransaction;

								// for coinbase txs, we need the block height in order to calculate subsidy to display
								var coinbaseTxs = [];
								for (var i = 0; i < rawTxResult.transactions.length; i++) {
									var tx = rawTxResult.transactions[i];

									for (var j = 0; j < tx.vin.length; j++) {
										if (tx.vin[j].coinbase) {
											// addressApi sometimes has blockHeightByTxid already available, otherwise we need to query for it
											if (!blockHeightsByTxid[tx.txid]) {
												coinbaseTxs.push(tx);
											}
										}
									}
								}


								var coinbaseTxBlockHashes = [];
								var blockHashesByTxid = {};
								coinbaseTxs.forEach(function(tx) {
									coinbaseTxBlockHashes.push(tx.blockhash);
									blockHashesByTxid[tx.txid] = tx.blockhash;
								});

								var blockHeightsPromises = [];
								if (coinbaseTxs.length > 0) {
									// we need to query some blockHeights by hash for some coinbase txs
									blockHeightsPromises.push(new Promise(function(resolve2, reject2) {
										coreApi.getBlocks(coinbaseTxBlockHashes, false).then(function(blocks) {
											var blocksByHash = {};
											blocks.forEach(b => blocksByHash[b.hash] = b);
											for (var txid in blockHashesByTxid) {
												if (blockHashesByTxid.hasOwnProperty(txid)) {
													blockHeightsByTxid[txid] = blocksByHash[blockHashesByTxid[txid]].height;
												}
											}

											resolve2();

										}).catch(function(err) {
											res.locals.pageErrors.push(utils.logError("78ewrgwetg3", err));

											reject2(err);
										});
									}));
								}

								Promise.all(blockHeightsPromises).then(async function() {
									var addrGainsByTx = {};
									var addrLossesByTx = {};

									res.locals.addrGainsByTx = addrGainsByTx;
									res.locals.addrLossesByTx = addrLossesByTx;

									var handledTxids = [];

									for (var i = 0; i < rawTxResult.transactions.length; i++) {
										var tx = rawTxResult.transactions[i];
										var txInputs = rawTxResult.txInputsByTransaction[tx.txid];

										if (handledTxids.includes(tx.txid)) {
											continue;
										}

										handledTxids.push(tx.txid);

										for (var j = 0; j < tx.vout.length; j++) {
											if (tx.vout[j].value > 0 && tx.vout[j].scriptPubKey && tx.vout[j].scriptPubKey.addresses && tx.vout[j].scriptPubKey.addresses.includes(address)) {
												if (addrGainsByTx[tx.txid] == null) {
													addrGainsByTx[tx.txid] = new Decimal(0);
												}

												addrGainsByTx[tx.txid] = addrGainsByTx[tx.txid].plus(new Decimal(tx.vout[j].value));
											}
										}

										for (var j = 0; j < tx.vin.length; j++) {
											var txInput = txInputs[j];
											var vinJ = tx.vin[j];

											if (txInput != null) {
												if (txInput && txInput.scriptPubKey && txInput.scriptPubKey.addresses && txInput.scriptPubKey.addresses.includes(address)) {
													if (addrLossesByTx[tx.txid] == null) {
														addrLossesByTx[tx.txid] = new Decimal(0);
													}

												addrLossesByTx[tx.txid] = addrLossesByTx[tx.txid].plus(new Decimal(txInput.value));
												}
											}
										}

									}
									res.locals.blockHeightsByTxid = blockHeightsByTxid;
									resolve();

								}).catch(function(err) {
									res.locals.pageErrors.push(utils.logError("230wefrhg0egt3", err));

									reject(err);
								});

							}).catch(function(err) {
								res.locals.pageErrors.push(utils.logError("asdgf07uh23", err));

								reject(err);
							});

						} else {
							// no addressDetails.txids available
							resolve();
						}
					} else {
						// no addressDetails available
						resolve();
					}
				}).catch(function(err) {
					debugLog(err)
					console.log(err)
					res.locals.pageErrors.push(utils.logError("23t07ug2wghefud", err));

					res.locals.addressApiError = err;

					reject(err);
				});
			}));

			promises.push(new Promise(function(resolve, reject) {
				coreApi.getBlockchainInfo().then(function(getblockchaininfo) {
					res.locals.getblockchaininfo = getblockchaininfo;

					resolve();

				}).catch(function(err) {
					res.locals.pageErrors.push(utils.logError("132r80h32rh-b", err));

					reject(err);
				});
			}));
		}

		promises.push(new Promise(function(resolve, reject) {
			qrcode.toDataURL(address, function(err, url) {
				if (err) {
					res.locals.pageErrors.push(utils.logError("93ygfew0ygf2gf2", err));
				}

				res.locals.addressQrCodeUrl = url;

				resolve();
			});
		}));

		promises.push(new Promise(function (resolve, reject) {
			electrumAddressApi.getTokenBalanceForAddress(address).then(async function(result){
				res.locals.tokenData = result;
				resolve();
			}).catch(function(err) {
				res.locals.pageErrors.push(utils.logError("132r80h32rh-c", err));

				reject(err);
			});
		}));


		Promise.all(promises.map(utils.reflectPromise)).then(function() {
			res.render("address");
			utils.perfMeasure(req);

		}).catch(function(err) {
			res.locals.pageErrors.push(utils.logError("32197rgh327g2", err));

			res.render("address");

		});

	}).catch(function(err) {
		res.locals.pageErrors.push(utils.logError("2108hs0gsdfe", err, {address:address}));

		res.render("address");

	});
});

router.get("/rpc-terminal", function(req, res, next) {
	if (!config.demoSite && !req.authenticated) {
		res.send("RPC Terminal / Browser require authentication. Set an authentication password via the 'EXAEXP_BASIC_AUTH_PASSWORD' environment variable (see .env-sample file for more info).");

//		next();

		return;
	}

	res.render("terminal");
	utils.perfMeasure(req);

//	next();
});

router.post("/rpc-terminal", function(req, res, next) {
	if (!config.demoSite && !req.authenticated) {
		res.send("RPC Terminal / Browser require authentication. Set an authentication password via the 'EXAEXP_BASIC_AUTH_PASSWORD' environment variable (see .env-sample file for more info).");

		utils.perfMeasure(req);

		return;
	}

	var params = req.body.cmd.trim().split(/\s+/);
	var cmd = params.shift();
	var parsedParams = [];

	params.forEach(function(param, i) {
		if (!isNaN(param)) {
			parsedParams.push(parseInt(param));

		} else {
			parsedParams.push(param);
		}
	});

	if (config.rpcBlacklist.includes(cmd.toLowerCase())) {
		res.write("Sorry, that RPC command is blacklisted. If this is your server, you may allow this command by removing it from the 'rpcBlacklist' setting in config.js.", function() {
			res.end();
		});

		utils.perfMeasure(req);

		return;
	}

	global.rpcClientNoTimeout.command([{method:cmd, parameters:parsedParams}], function(err, result, resHeaders) {
		debugLog("Result[1]: " + JSON.stringify(result, null, 4));
		debugLog("Error[2]: " + JSON.stringify(err, null, 4));
		debugLog("Headers[3]: " + JSON.stringify(resHeaders, null, 4));

		if (err) {
			debugLog(JSON.stringify(err, null, 4));

			res.write(JSON.stringify(err, null, 4), function() {
				res.end();
			});

		} else if (result) {
			res.write(JSON.stringify(result, null, 4), function() {
				res.end();
			});

		} else {
			res.write(JSON.stringify({"Error":"No response from node"}, null, 4), function() {
				res.end();
			});

		}
	});
});

router.get("/rpc-browser", function(req, res, next) {
	if (!config.demoSite && !req.authenticated) {
		res.send("RPC Terminal / Browser require authentication. Set an authentication password via the 'EXAEXP_BASIC_AUTH_PASSWORD' environment variable (see .env-sample file for more info).");

		utils.perfMeasure(req);

		return;
	}

	coreApi.getHelp().then(function(result) {
		res.locals.gethelp = result;

		if (req.query.method) {
			res.locals.method = req.query.method;

			coreApi.getRpcMethodHelp(req.query.method.trim()).then(function(result2) {
				res.locals.methodhelp = result2;

				if (req.query.execute) {
					var argDetails = result2.args;
					var argValues = [];

					if (req.query.args) {
						for (var i = 0; i < req.query.args.length; i++) {
							var argProperties = argDetails[i].properties;

							for (var j = 0; j < argProperties.length; j++) {
								if (argProperties[j] === "numeric") {
									if (req.query.args[i] == null || req.query.args[i] == "") {
										argValues.push(null);

									} else {
										argValues.push(parseInt(req.query.args[i]));
									}

									break;

								} else if (argProperties[j] === "boolean") {
									if (req.query.args[i]) {
										argValues.push(req.query.args[i] == "true");
									}

									break;

								} else if (argProperties[j] === "string" || argProperties[j] === "numeric or string" || argProperties[j] === "string or numeric") {
									if (req.query.args[i]) {
										argValues.push(req.query.args[i].replace(/[\r]/g, ''));
									}

									break;

								} else if (argProperties[j] === "array") {
									if (req.query.args[i]) {
										argValues.push(JSON.parse(req.query.args[i]));
									}

									break;

								} else {
									debugLog(`Unknown argument property: ${argProperties[j]}`);
								}
							}
						}
					}

					res.locals.argValues = argValues;

					if (config.rpcBlacklist.includes(req.query.method.toLowerCase())) {
						res.locals.methodResult = "Sorry, that RPC command is blacklisted. If this is your server, you may allow this command by removing it from the 'rpcBlacklist' setting in config.js.";

						res.render("browser");
						utils.perfMeasure(req);

						return;
					}

					forceCsrf(req, res, err => {
						if (err) {
							return next(err);
						}

						debugLog("Executing RPC '" + req.query.method + "' with params: " + JSON.stringify(argValues));

						global.rpcClientNoTimeout.command([{method:req.query.method, parameters:argValues}], function(err3, result3, resHeaders3) {
							debugLog("RPC Response: err=" + err3 + ", headers=" + resHeaders3 + ", result=" + JSON.stringify(result3));

							if (err3) {
								res.locals.pageErrors.push(utils.logError("23roewuhfdghe", err3, {method:req.query.method, params:argValues, result:result3, headers:resHeaders3}));

								if (result3) {
									res.locals.methodResult = {error:("" + err3), result:result3};

								} else {
									res.locals.methodResult = {error:("" + err3)};
								}
							} else if (result3) {
								res.locals.methodResult = result3;

							} else {
								res.locals.methodResult = {"Error":"No response from node."};
							}

							res.render("browser");
							utils.perfMeasure(req);

						});
					});
				} else {
					res.render("browser");
					utils.perfMeasure(req);

				}
			}).catch(function(err) {
				res.locals.userMessage = "Error loading help content for method " + req.query.method + ": " + err;

				res.render("browser");
				utils.perfMeasure(req);

			});

		} else {
			res.render("browser");
			utils.perfMeasure(req);

		}

	}).catch(function(err) {
		res.locals.userMessage = "Error loading help content: " + err;

		res.render("browser");
		utils.perfMeasure(req);

	});
});

router.get("/unconfirmed-tx", function(req, res, next) {
	var limit = config.site.browseBlocksPageSize;
	var offset = 0;
	var sort = "desc";

	if (req.query.limit) {
		limit = parseInt(req.query.limit);
	}

	if (req.query.offset) {
		offset = parseInt(req.query.offset);
	}

	if (req.query.sort) {
		sort = req.query.sort;
	}

	res.locals.limit = limit;
	res.locals.offset = offset;
	res.locals.sort = sort;
	res.locals.paginationBaseUrl = "/unconfirmed-tx";

	coreApi.getTxpoolDetails(offset, limit).then(async function(txpoolDetails) {
		res.locals.txpoolDetails = txpoolDetails

		try {
			const TxIds = txpoolDetails.transactions.map(elem => elem.txid)
			res.locals.tokenData = await coreApi.getTransactionTokens(TxIds);
		} catch (err){}


		res.render("unconfirmed-transactions");
		utils.perfMeasure(req);

	}).catch(function(err) {
		res.locals.userMessage = "Error: " + err;

		res.render("unconfirmed-transactions");
		utils.perfMeasure(req);

	});
});

router.get("/tx-stats", function(req, res, next) {
	var dataPoints = 100;

	if (req.query.dataPoints) {
		dataPoints = req.query.dataPoints;
	}

	if (dataPoints > 250) {
		dataPoints = 250;
	}

	var targetBlocksPerDay = 24 * 60 * 60 / global.coinConfig.targetBlockTimeSeconds;

	coreApi.getTxCountStats(dataPoints, 0, "latest").then(function(result) {
		res.locals.getblockchaininfo = result.getblockchaininfo;
		res.locals.txStats = result.txCountStats;

		coreApi.getTxCountStats(targetBlocksPerDay / 4, -targetBlocksPerDay, "latest").then(function(result2) {
			res.locals.txStatsDay = result2.txCountStats;

			coreApi.getTxCountStats(targetBlocksPerDay / 4, -targetBlocksPerDay * 7, "latest").then(function(result3) {
				res.locals.txStatsWeek = result3.txCountStats;

				coreApi.getTxCountStats(targetBlocksPerDay / 4, -targetBlocksPerDay * 30, "latest").then(function(result4) {
					res.locals.txStatsMonth = result4.txCountStats;

					res.render("tx-stats");

					utils.perfMeasure(req);
				});
			});
		});
	});
});

router.get("/difficulty-history", function(req, res, next) {
	try {
		coreApi.getBlockchainInfo().then(function(getblockchaininfo) {
			var blockHeights = Array.from({length: global.coinConfig.difficultyAdjustmentBlockOffset / global.coinConfig.difficultyAdjustmentBlockCount}, (_, i) => getblockchaininfo.blocks - (i * global.coinConfig.difficultyAdjustmentBlockCount));
			coreApi.getBlockHeadersByHeight(blockHeights).then(function(blockHeaders) {
				var data = blockHeaders.map((b, i) => {
					return {
						h: b.height,
						d: b.difficulty,
						dd: blockHeaders[i + 1] ? (b.difficulty / blockHeaders[i + 1].difficulty) - 1 : 0
					}
				});

				// 3hrs
				var avglen = Math.floor(90 / global.coinConfig.difficultyAdjustmentBlockCount) ;
				var avg = data[data.length - 1].d;
				var avgd = data[data.length - 1].dd;
				for (var i = data.length - 1; i >= 0; i--) {
					data[i].a  = avg  = ((avg  * (avglen - 1)) + data[i].d)  / avglen;
					data[i].ad = avgd = ((avgd * (avglen - 1)) + data[i].dd) / avglen;
				}

				res.locals.avglen = avglen
				res.locals.data = data;

				res.render("difficulty-history");
				utils.perfMeasure(req);
			});
		});
	} catch (err) {
		res.locals.userMessage = "Error: " + err;

		res.render("difficulty-history");
		utils.perfMeasure(req);

	}
});

router.get("/about", function(req, res, next) {
	res.render("about");
	utils.perfMeasure(req);

});

router.get("/tools", function(req, res, next) {
	res.render("tools");
	utils.perfMeasure(req);

});

router.get("/admin", function(req, res, next) {
	res.locals.appStartTime = global.appStartTime;
	res.locals.memstats = v8.getHeapStatistics();
	res.locals.rpcStats = global.rpcStats;
	res.locals.cacheStats = global.cacheStats;
	res.locals.appStartTime = global.appStartTime;
	res.locals.memstats = v8.getHeapStatistics();
	res.locals.rpcStats = global.rpcStats;
	res.locals.cacheStats = global.cacheStats;
	res.locals.errorStats = global.errorStats;

	res.render("admin");
	utils.perfMeasure(req);
});

router.get("/fun", function(req, res, next) {
	var sortedList = coins[config.coin].historicalData;
	sortedList.sort(function(a, b) {
		if (a.date > b.date) {
			return 1;

		} else if (a.date < b.date) {
			return -1;

		} else {
			return a.type.localeCompare(b.type);
		}
	});

	res.locals.historicalData = sortedList;

	res.render("fun");

	utils.perfMeasure(req);
});

export default router;
