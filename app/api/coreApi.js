import debug from "debug";

const debugLog = debug("nexexp:core");

import fs from 'fs';

import utils from "../utils.js";
import tokenApi from "../api/tokenApi.js";
import config from "../config.js";
import coins from "../coins.js";
import Decimal from "decimal.js";


import db from '../../models/index.js'
var Op = db.Sequelize.Op;

// choose one of the below: RPC to a node, or mock data while testing
import rpcApi from "./rpcApi.js";
import electrumAddressApi from "../api/electrumAddressApi.js";
// import { reject } from "bluebird"; // Uncomment if needed

import global from "../global.js";
import tokenLoadQueue from "../tokenLoadQueue.js";
import {Address} from "libexana-ts";
global.cacheStats = {};
import cacheApi from "./cacheApi.js";


function getGenesisBlockHash() {
	return coins[config.coin].genesisBlockHashesByNetwork[global.activeBlockchain];
}

function getGenesisCoinbaseTransactionId() {
	return coins[config.coin].genesisCoinbaseTransactionIdsByNetwork[global.activeBlockchain];
}

function getGeoDataForIps(ip, loadFunction) {
	return cacheApi.tryCacheThenCallFunction( "ip-" + ip, cacheApi.ONE_HR, loadFunction);
}
function getMarketDataForToken(token, exchange, loadFunction) {
	return cacheApi.tryCacheThenCallFunction("getMarketInfo-" + token + '-' + exchange, cacheApi.FIVE_MINUTES, loadFunction);
}

function getTokenGenesis(token) {
	return cacheApi.tryCacheThenCallFunction("getTokenGenesis-" + token, cacheApi.ONE_YR, () => electrumAddressApi.getTokenGenesis(token));
}

function shouldCacheTransaction(tx) {
	if (!tx.confirmations) {
		return false;
	}

	if (tx.confirmations < 1) {
		return false;
	}

	return !(tx.vin != null && tx.vin.length > 9);
}


function getBlockCount() {
	return cacheApi.tryCacheThenRpcApi( "getBlockCount", 10 * cacheApi.ONE_SEC, rpcApi.getBlockCount);
}

function getBlockchainInfo() {
	return cacheApi.tryCacheThenRpcApi("getBlockchainInfo", 10 * cacheApi.ONE_SEC, rpcApi.getBlockchainInfo);
}

function getNetworkInfo() {
	return cacheApi.tryCacheThenRpcApi("getNetworkInfo", 10 * cacheApi.ONE_SEC, rpcApi.getNetworkInfo);
}

function getNetTotals() {
	return cacheApi.tryCacheThenRpcApi("getNetTotals", 10 * cacheApi.ONE_SEC, rpcApi.getNetTotals);
}

function getTxpoolInfo() {
	return cacheApi.tryCacheThenRpcApi( "getTxpoolInfo", cacheApi.ONE_SEC, rpcApi.getTxpoolInfo);
}

function getTxpoolTxids() {
	// no caching, that would be dumb
	return rpcApi.getTxpoolTxids();
}

function getMiningInfo() {
	return cacheApi.tryCacheThenRpcApi( "getMiningInfo", 30 * cacheApi.ONE_SEC, rpcApi.getMiningInfo);
}

function getUptimeSeconds() {
	return cacheApi.tryCacheThenRpcApi( "getUptimeSeconds", cacheApi.ONE_SEC, rpcApi.getUptimeSeconds);
}

function getChainTxStats(blockCount) {
	return cacheApi.tryCacheThenRpcApi("getChainTxStats-" + blockCount, 20 * cacheApi.ONE_MIN, function() {
		return rpcApi.getChainTxStats(blockCount);
	});
}

function getNetworkHashrate(blockCount) {
	return cacheApi.tryCacheThenRpcApi("getNetworkHashrate-" + blockCount, 20 * cacheApi.ONE_MIN, function() {
		return rpcApi.getNetworkHashrate(blockCount);
	});
}

function getBlockStats(hash_or_height) {
	return cacheApi.tryCacheThenRpcApi("getBlockStats-" + hash_or_height, cacheApi.ONE_YR, function() {
		return rpcApi.getBlockStats(hash_or_height);
	});
}

function decodeScript(hex) {
	return cacheApi.tryCacheThenRpcApi( "decodeScript-" + hex, 1000 * 60 * 1000, function() {
		return rpcApi.decodeScript(hex);
	});
}

function getTokenMintage(token) {
	return cacheApi.tryCacheThenRpcApi( "getTokenMintage-" + token,  20 * cacheApi.ONE_MIN, function() {
		return rpcApi.tokenMintage(token);
	});
}

function getTransactions(txids, cacheSpan=cacheApi.ONE_HR) {
	return new Promise(function(resolve, reject) {
		var promises = [];
		for (var i = 0; i < txids.length; i++) {
			promises.push(getTransaction(txids[i], cacheSpan));
		}

		Promise.all(promises).then(function(results) {
			resolve(results);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getTransaction(tx) {
	return cacheApi.tryCacheThenRpcApi("gettransaction-" + tx, 1000 * 60 * 1000, function() {
		return rpcApi.getTransaction(tx);
	});
}

function decodeRawTransaction(hex) {
	return cacheApi.tryCacheThenRpcApi( "decodeRawTransaction-" + hex, 1000 * 60 * 1000, function() {
		return rpcApi.decodeRawTransaction(hex);
	});
}
function validateRawTransaction(hex) {
	return cacheApi.tryCacheThenRpcApi( "validateRawTransaction-" + hex, 1000 * 60 * 1000, function() {
		return rpcApi.validateRawTransaction(hex);
	});
}

function getUtxoSetSummary() {
	return cacheApi.tryCacheThenRpcApi( "getUtxoSetSummary", 15 * cacheApi.ONE_MIN, rpcApi.getUtxoSetSummary);
}

function getTxCountStats(dataPtCount, blockStart, blockEnd, plot = true) {
	return new Promise(function(resolve, reject) {
		var dataPoints = dataPtCount;

		getBlockchainInfo().then(function(getblockchaininfo) {
			let i;
			if (typeof blockStart === "string") {
				if (["genesis", "first", "zero"].includes(blockStart)) {
					blockStart = 0;
				}
			}

			if (typeof blockEnd === "string") {
				if (["latest", "tip", "newest"].includes(blockEnd)) {
					blockEnd = getblockchaininfo.blocks;
				}
			}

			if (blockStart > blockEnd) {
				reject(`Error 37rhw0e7ufdsgf: blockStart (${blockStart}) > blockEnd (${blockEnd})`);

				return;
			}

			if (blockStart < 0) {
				blockStart += getblockchaininfo.blocks;
			}

			if (blockEnd < 0) {
				blockEnd += getblockchaininfo.blocks;
			}
			const chainTxStatsIntervals = [];
			for (i = 0; i < dataPoints; i++) {
				chainTxStatsIntervals.push(parseInt(Math.max(10, getblockchaininfo.blocks - blockStart - i * (blockEnd - blockStart) / (dataPoints - 1) - 1)));
			}

			const promises = [];
			for (i = 0; i < chainTxStatsIntervals.length; i++) {
				promises.push(getChainTxStats(chainTxStatsIntervals[i]));
			}

			Promise.all(promises).then(function(results) {
				let i;
				if (results[0].name === "RpcError" && results[0].code === -8) {
					// recently started node - no meaningful data to return
					resolve(null);

					return;
				}

				const txStats = {
					txCounts: [],
					txCumulativeCounts: [],
					txRates: [],
				};

				if (!plot) {
					for (i = results.length - 1; i >= 0; i--) {
						if (results[i].window_tx_count) {
							txStats.txCounts.push(results[i].window_tx_count)
							txStats.txCumulativeCounts.push(results[i].txcount - results[i].window_tx_count)
							txStats.txRates.push(results[i].txrate);
						}
					}

					resolve({
						txCountStats:txStats,
						totalTxCount:txStats.txCounts[txStats.txCounts.length - 1],
						window: {
							block_start: blockStart,
							block_end: blockEnd,
						}
					});
					return;
				}
				txStats['txLabels'] = []
				for (i = results.length - 1; i >= 0; i--) {
					if (results[i].window_tx_count) {
						txStats.txCounts.push( {x:(getblockchaininfo.blocks - results[i].window_block_count), y: (results[i].txcount - results[i].window_tx_count)} );
						txStats.txRates.push( {x:(getblockchaininfo.blocks - results[i].window_block_count), y: (results[i].txrate)} );
						txStats.txLabels.push(i);
					}
				}

				resolve({txCountStats:txStats, getblockchaininfo:getblockchaininfo, totalTxCount:results[0].txcount});

			}).catch(function(err) {
				reject(err);
			});

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getPeerSummary() {
	return new Promise(function(resolve, reject) {
		cacheApi.tryCacheThenRpcApi( "getpeerinfo", cacheApi.ONE_SEC, rpcApi.getPeerInfo).then(function(getpeerinfo) {
			var result = {};
			result.getpeerinfo = getpeerinfo;

			result.getpeerinfo_has_mapped_as = getpeerinfo.length > 0 && "mapped_as" in getpeerinfo[0];

			var versionSummaryMap = {};
			for (var i = 0; i < getpeerinfo.length; i++) {
				var x = getpeerinfo[i];

				if (versionSummaryMap[x.subver] == null) {
					versionSummaryMap[x.subver] = 0;
				}

				versionSummaryMap[x.subver]++;
			}

			var versionSummary = [];
			for (var prop in versionSummaryMap) {
				if (versionSummaryMap.hasOwnProperty(prop)) {
					versionSummary.push([prop, versionSummaryMap[prop]]);
				}
			}

			versionSummary.sort(function(a, b) {
				if (b[1] > a[1]) {
					return 1;

				} else if (b[1] < a[1]) {
					return -1;

				} else {
					return a[0].localeCompare(b[0]);
				}
			});



			var servicesSummaryMap = {};
			for (var i = 0; i < getpeerinfo.length; i++) {
				var x = getpeerinfo[i];

				if (servicesSummaryMap[x.services] == null) {
					servicesSummaryMap[x.services] = 0;
				}

				servicesSummaryMap[x.services]++;
			}

			var servicesSummary = [];
			for (var prop in servicesSummaryMap) {
				if (servicesSummaryMap.hasOwnProperty(prop)) {
					servicesSummary.push([prop, servicesSummaryMap[prop]]);
				}
			}

			servicesSummary.sort(function(a, b) {
				if (b[1] > a[1]) {
					return 1;

				} else if (b[1] < a[1]) {
					return -1;

				} else {
					return a[0].localeCompare(b[0]);
				}
			});



			result.versionSummary = versionSummary;
			result.servicesSummary = servicesSummary;

			resolve(result);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getTxpoolDetails(start, count) {
	return new Promise(function(resolve, reject) {
		cacheApi.tryCacheThenRpcApi("getTxpoolTxids", cacheApi.ONE_SEC, rpcApi.getTxpoolTxids).then(function(resultTxids) {
			var txids = [];

			for (var i = start; (i < resultTxids.length && i < (start + count)); i++) {
				txids.push(resultTxids[i]);
			}

			getRawTransactionsWithInputs(txids, config.site.txMaxInput).then(function(result) {
				resolve({ txCount:resultTxids.length, transactions:result.transactions, txInputsByTransaction:result.txInputsByTransaction });
			});

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getBlockInt(hash_or_height)
{
	return new Promise(function(resolve, reject) {
		rpcApi.getBlock(hash_or_height).then(function(block) {
			getRawTransaction(block.txid[0]).then(function(tx) {
				block.coinbaseTx = tx;
				block.totalFees = utils.getBlockTotalFeesFromCoinbaseTxAndBlockHeight(tx, block.height);
				block.subsidy = global.coinConfig.blockRewardFunction(block.height, global.activeBlockchain);
				if (block.nTx === undefined)
					block.nTx = block.txid.length;
				resolve(block);
			}).catch(function(err) {
				debugLog(err);
				reject(err);
			});
		}).catch(function(err) {
			debugLog(err);
			reject(err);
		});
	});
}

function getBlockCached(hash_or_height, full = false) {
	if (!full) {
		return cacheApi.tryCacheThenRpcApi( "getBlock-" + hash_or_height, cacheApi.ONE_YR, function() {
			return new Promise(function(resolve, reject) {
				getBlockInt(hash_or_height).then(function(block) {
					block.txid.length = 1; // only keep the coinbase TX when caching the result
					resolve(block);
				}).catch(function(err) {
					reject(err);
				});
			});
		});
	} else {
		return getBlockInt(hash_or_height);
	}
}

function getBlock(blockHash, full = false) {
	return new Promise(function(resolve, reject) {
		getBlockCached(blockHash, full).then(function(block) {
			block.miner = utils.getMinerFromCoinbaseTx(block.coinbaseTx); // do not cache miner info
			resolve(block);
		}).catch(function(err) {
			reject(err);
		});
	});
}

function getBlocks(blockHashes, full = false) {
	return new Promise(function(resolve, reject) {
		Promise.all(blockHashes.map(h => getBlock(h, full))).then(function(blocks) {
			resolve(blocks);
		}).catch(function(err) {
			reject(err);
		});
	});
}

function getBlockByHeight(blockHeight, full = false) {
	if (!config.blockByHeightSupport) {
		return new Promise(function(resolve, reject) {
			rpcApi.getBlockHash(blockHeight).then(function(blockhash) {
				getBlock(blockhash, full).then(function(block) {
					resolve(block);
				}).catch(function(err) {
					reject(err);
				});
			}).catch(function(err) {
				reject(err);
			});
		});
	} else {
		return getBlock(blockHeight, full);
	}
}

function getBlocksByHeight(blockHeights, full = false) {
	return new Promise(function(resolve, reject) {
		Promise.all(blockHeights.map(h => getBlockByHeight(h, full))).then(function(results) {
			resolve(results);
		}).catch(function(err) {
			reject(err);
		});
	});
}

function getBlockHeader(blockHash) {
	return cacheApi.tryCacheThenRpcApi( "getBlockHeader-" + blockHash, cacheApi.ONE_YR, function() {
		return rpcApi.getBlockHeader(blockHash);
	});
}

function getBlockHeaderByHeight(blockHeight) {
	return cacheApi.tryCacheThenRpcApi( "getBlockHeader-" + blockHeight, cacheApi.ONE_YR, function() {
		return rpcApi.getBlockHeader(blockHeight);
	});
}

function getBlockHeadersByHeight(blockHeights) {
	return new Promise(function(resolve, reject) {
		Promise.all(blockHeights.map(h => getBlockHeaderByHeight(h))).then(function(results) {
			resolve(results);
		}).catch(function(err) {
			reject(err);
		});
	});
}

function getBlocksStats(blockHashes) {
	return new Promise(function(resolve, reject) {
		Promise.all(blockHashes.map(h => getBlockStats(h))).then(function(results) {
			resolve(results);
		}).catch(function(err) {
			debugLog(err);
			reject(err);
		});
	});
}

function getBlocksStatsByHeight(blockHeights) {
	return new Promise(function(resolve, reject) {
		Promise.all(blockHeights.map(h => getBlockStats(h))).then(function(results) {
			resolve(results);
		}).catch(function(err) {
			reject(err);
		});
	});
}

function getMiningCandidate(args = {}) {
	return cacheApi.tryCacheThenRpcApi( "getMiningCandidate", cacheApi.ONE_MIN, function() {
		return rpcApi.getMiningCandidate(args);
	});
}

function getRawTransaction(txid, cacheSpan=cacheApi.ONE_HR) {
	var rpcApiFunction = function() {
		return rpcApi.getRawTransaction(txid);
	};

	return cacheApi.tryCacheThenRpcApi("getRawTransaction-" + txid, cacheSpan, rpcApiFunction, shouldCacheTransaction);
}

/*
 * This function pulls raw tx data and then summarizes the outputs. It's used in memory-constrained situations.
 */
function getSummarizedTransactionOutput(outpoint, txid, cacheSpan=cacheApi.ONE_HR) {
	var rpcApiFunction = function() {
		return new Promise(function(resolve, reject) {
			rpcApi.getRawTransaction(outpoint, cacheSpan).then(function(rawTx) {
				var vout = {};
				for (const v of rawTx.vout) {
					if (v.outpoint == outpoint) {vout = v}
				}
				if (vout.scriptPubKey) {
					if (vout.scriptPubKey.asm) {
						delete vout.scriptPubKey.asm;
					}

					if (vout.scriptPubKey.hex) {
						delete vout.scriptPubKey.hex;
					}

				}

				vout.txid = rawTx.txid;
				vout.txidem = rawTx.txidem;
				vout.utxoTime = rawTx.time;

				if (rawTx.vin.length == 0) {
					vout.coinbaseSpend = true;
				}

				resolve(vout);

			}).catch(function(err) {
				reject(err);
			});
		});
	};

	return cacheApi.tryCacheThenRpcApi( `txoSummary-${txid}-${outpoint}`, cacheSpan, rpcApiFunction, function() { return true; });
}

function getTxUtxos(tx) {
	return new Promise(function(resolve, reject) {
		var promises = [];

		for (var i = 0; i < tx.vout.length; i++) {
			promises.push(getUtxo(tx.txidem, i));
		}

		Promise.all(promises).then(function(results) {
			resolve(results);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getUtxo(txid, outputIndex) {
	return new Promise(function(resolve, reject) {
		cacheApi.tryCacheThenRpcApi( "utxo-" + txid + "-" + outputIndex, cacheApi.ONE_HR, function() {
			return rpcApi.getUtxo(txid, outputIndex);

		}).then(function(result) {
			// to avoid cache misses, rpcApi.getUtxo returns "0" instead of null
			if (typeof result == "string" && result == "0") {
				resolve(null);

				return;
			}

			resolve(result);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getTxpoolTxDetails(txid, includeAncDec) {
	return cacheApi.tryCacheThenRpcApi( "txpoolTxDetails-" + txid + "-" + includeAncDec, cacheApi.ONE_HR, function() {
		return rpcApi.getTxpoolTxDetails(txid, includeAncDec);
	});
}

function getAddress(address) {
	return cacheApi.tryCacheThenRpcApi( "getAddress-" + address, cacheApi.ONE_HR, function() {
		return rpcApi.getAddress(address);
	});
}

function getRawTransactions(txids, cacheSpan=cacheApi.ONE_HR) {
	return new Promise(function(resolve, reject) {
		var promises = [];
		for (var i = 0; i < txids.length; i++) {
			promises.push(getRawTransaction(txids[i], cacheSpan));
		}

		Promise.all(promises).then(function(results) {
			resolve(results);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function buildBlockAnalysisData(blockHeight, txids, txIndex, results, callback) {
	if (txIndex >= txids.length) {
		callback();

		return;
	}

	var txid = txids[txIndex];

	getRawTransactionsWithInputs([txid]).then(function(txData) {
		results.push(summarizeBlockAnalysisData(blockHeight, txData.transactions[0], txData.txInputsByTransaction[txid]));

		buildBlockAnalysisData(blockHeight, txids, txIndex + 1, results, callback);
	});
}

function summarizeBlockAnalysisData(blockHeight, tx, inputs) {
	var txSummary = {};

	txSummary.txid = tx.txid;
	txSummary.version = tx.version;
	txSummary.size = tx.size;

	if (tx.vin.lenght = 0) {
		txSummary.coinbase = true;
	}

	txSummary.vin = [];
	txSummary.totalInput = new Decimal(0);

	if (txSummary.coinbase) {
		var subsidy = global.coinConfig.blockRewardFunction(blockHeight, global.activeBlockchain);

		txSummary.totalInput = txSummary.totalInput.plus(new Decimal(subsidy));

		txSummary.vin.push({
			coinbase: true,
			value: subsidy
		});

	} else {
		for (var i = 0; i < tx.vin.length; i++) {
			var vin = tx.vin[i];
			var inputVout = inputs[i];

			txSummary.totalInput = txSummary.totalInput.plus(new Decimal(inputVout.value));

			txSummary.vin.push({
				txid: tx.vin[i].txid,
				vout: tx.vin[i].vout,
				sequence: tx.vin[i].sequence,
				value: inputVout.value,
				type: inputVout.scriptPubKey.type,
				reqSigs: inputVout.scriptPubKey.reqSigs,
				addressCount: (inputVout.scriptPubKey.addresses ? inputVout.scriptPubKey.addresses.length : 0)
			});
		}
	}


	txSummary.vout = [];
	txSummary.totalOutput = new Decimal(0);

	for (var i = 0; i < tx.vout.length; i++) {
		txSummary.totalOutput = txSummary.totalOutput.plus(new Decimal(tx.vout[i].value));

		txSummary.vout.push({
			value: tx.vout[i].value,
			type: tx.vout[i].scriptPubKey.type,
			reqSigs: tx.vout[i].scriptPubKey.reqSigs,
			addressCount: tx.vout[i].scriptPubKey.addresses ? tx.vout[i].scriptPubKey.addresses.length : 0
		});
	}

	if (txSummary.coinbase) {
		txSummary.totalFee = new Decimal(0);
	} else {
		txSummary.totalFee = txSummary.totalInput.minus(txSummary.totalOutput);
	}

	return txSummary;
}

function getRawTransactionsWithInputs(txids, maxInputs=-1, cacheSpan=cacheApi.ONE_HR) {
	return new Promise(function(resolve, reject) {
		getRawTransactions(txids, cacheSpan).then(function(transactions) {
			var maxInputsTracked = config.site.txMaxInput;

			// FIXME need to make this magic number a parameter
			if (maxInputs <= 0) {
				maxInputsTracked = 1000000;
			} else if (maxInputs > 0) {
				maxInputsTracked = maxInputs;
			}

			var vinIds = [];
			for (var i = 0; i < transactions.length; i++) {
				var transaction = transactions[i];
				// try to determine if the query has been done by txid or txidem
				if (transaction.txidem == txids[i]) {
					transactions[i].searchByIdem = true;
				} else {
					transactions[i].searchByIdem = false;
				}

				if (transaction && transaction.vin) {
					for (var j = 0; j < Math.min(maxInputsTracked, transaction.vin.length); j++) {
						if (transaction.vin[j].outpoint) {
							vinIds.push({outpoint:transaction.vin[j].outpoint, txid:transaction.txid});
						}
					}
				}
			}

			var promises = [];

			for (var i = 0; i < vinIds.length; i++) {
				var vinId = vinIds[i];

				// we are actually fetching data about inputs of this transaction
				// by looking at the parent transaction of each inputs
				promises.push(getSummarizedTransactionOutput(vinId.outpoint, vinId.txid, cacheSpan));
			}

			Promise.all(promises).then(function(promiseResults) {
				var summarizedTxOutputs = {};
				for (var i = 0; i < promiseResults.length; i++) {
					var summarizedTxOutput = promiseResults[i];
					summarizedTxOutputs[`${summarizedTxOutput.outpoint}`] = summarizedTxOutput;
				}

				var txInputsByTransaction = {};

				transactions.forEach(function(tx) {
					txInputsByTransaction[tx.txid] = {};
					txInputsByTransaction[tx.txidem] = {};
					if (tx && tx.vin) {
						for (var i = 0; i < Math.min(maxInputsTracked, tx.vin.length); i++) {
							var summarizedTxOutput = summarizedTxOutputs[`${tx.vin[i].outpoint}`];
							if (summarizedTxOutput) {
								txInputsByTransaction[tx.txidem][i] = summarizedTxOutput;
								txInputsByTransaction[tx.txid][i] = summarizedTxOutput;
							}
						}
					}
				});

				resolve({ transactions:transactions, txInputsByTransaction:txInputsByTransaction });
			});
		}).catch(function(err) {
			reject(err);
		});
	});
}

function getBlockByHashWithTransactions(blockHash, txLimit, txOffset) {
	return new Promise(function(resolve, reject) {
		getBlock(blockHash, true).then(function(block) {
			var txids = [];

			if (txOffset > 0) {
				txids.push(block.txid[0]);
			}

			for (var i = txOffset; i < Math.min(txOffset + txLimit, block.txid.length); i++) {
				txids.push(block.txid[i]);
			}

			getRawTransactionsWithInputs(txids, config.site.txMaxInput).then(function(txsResult) {
				if (txsResult.transactions && txsResult.transactions.length > 0) {
					block.coinbaseTx = txsResult.transactions[0];
					block.totalFees = utils.getBlockTotalFeesFromCoinbaseTxAndBlockHeight(block.coinbaseTx, block.height);
					block.miner = utils.getMinerFromCoinbaseTx(block.coinbaseTx);
				}

				// if we're on page 2, we don't really want the coinbase tx in the tx list anymore
				if (txOffset > 0) {
					txsResult.transactions.shift();
				}

				resolve({ getblock:block, transactions:txsResult.transactions, txInputsByTransaction:txsResult.txInputsByTransaction });
			});
		}).catch(function(err) {
			reject(err);
		});
	});
}

function getRecentBlocksMinimalData(count) {
	return new Promise(function(resolve, reject) {
		getBlockchainInfo().then(function(getblockchaininfo) {
			// Get all the block heights we will display
			var blockHeights = Array.from({length: 10})
				.map((_, i) => getblockchaininfo.blocks - i)
				.filter(h => h >= 0 && h <= getblockchaininfo.blocks);

			var promises = [];
			promises.push(getBlocksByHeight(blockHeights));

			Promise.all(promises).then(function(promiseResults) {
				var blocks = promiseResults[0];
				var data = blockHeights.map((h, i) => {
					var minimalData = [blocks[i].height, blocks[i].time, blocks[i].hash];
					return minimalData;
				});

				resolve({"blocks": data});
			}).catch(function(err) {
				debugLog(err);
				reject(err);
			});
		}).catch(function(err) {
			debugLog(err);
			reject(err);
		});
	});
}

const getBlockListDefaultArgs = {
	limit: config.site.browseBlocksPageSize,
	offset: 0,
	sort: 'desc'
};

function getBlockList(args)
{
	args = Object.assign(Object.assign({}, getBlockListDefaultArgs), args);

	return new Promise(function(resolve, reject) {
		getBlockchainInfo().then(function(getblockchaininfo) {
			var sortDesc = args.sort == 'desc';

			// Get all the block heights we will display
			var blockHeights = Array.from({length: args.limit})
				.map((_, i) => sortDesc ? (getblockchaininfo.blocks - args.offset - i) : (args.offset + i))
				.filter(h => h >= 0 && h <= getblockchaininfo.blocks);

			// hack: default regtest node returns getblockchaininfo.blocks=0, despite having a genesis block
			if (global.activeBlockchain == "regtest" && blockHeights.length < 1)
				blockHeights.push(0);

			// Check if we can fetch an extra block height for time difference calculation
			var hasExtraElement = false;
			var extraElement = sortDesc ? getblockchaininfo.blocks - args.offset - args.limit : args.offset - 1;
			if (extraElement >= 0) {
				if (sortDesc)
					blockHeights.push(extraElement);
				else
					blockHeights.unshift(extraElement);
				hasExtraElement = true;
			}

			//FIXME: remove map since we just need to iterate over the array of heights
			Promise.all(blockHeights.map(h => h)).then(function(blockHashes) {
				var promises = [];
				promises.push(getBlocks(blockHashes));
				promises.push(getBlocksStats(blockHashes));

				Promise.all(promises).then(function(promiseResults) {
					var blocks = promiseResults[0];
					var blockstats = promiseResults[1];
					var data = blockHeights.map((h, i) => {
						var res = blocks[i];
						if (blockstats) {
							res.stats = blockstats[i];
							res.stats.volume = res.stats.total_out + res.stats.subsidy + res.stats.totalfee;
						}
						return res;
					});

					// Calculate time deltas
					var prevIdx = sortDesc ? 1 : -1;
					data.forEach((d, i) => { if (data[i + prevIdx]) d.timeDiff = d.time - data[i + prevIdx].time });

					// Remove extra element from the beginning/end if we have one
					if (hasExtraElement) {
						if (sortDesc)
							data.length = data.length - 1;
						else
							data = data.slice(1)
					}

					resolve({ blockList: data, blockListArgs: args, hasBlockStats: !!blockstats, blockChainInfo: getblockchaininfo });
				}).catch(function(err) {
					debugLog(err);
					reject(err);
				});
			}).catch(function(err) {
				debugLog(err);
				reject(err);
			});
		}).catch(function(err) {
			debugLog(err);
			reject(err);
		});
	});
}

function getHelp() {
	return new Promise(function(resolve, reject) {
		cacheApi.tryCacheThenRpcApi( "getHelp", cacheApi.ONE_DAY, rpcApi.getHelp).then(function(helpContent) {
			var lines = helpContent.split("\n");
			var sections = [];

			lines.forEach(function(line) {
				if (line.startsWith("==")) {
					var sectionName = line.substring(2);
					sectionName = sectionName.substring(0, sectionName.length - 2).trim();

					sections.push({name:sectionName, methods:[]});

				} else if (line.trim().length > 0) {
					var methodName = line.trim();

					if (methodName.includes(" ")) {
						methodName = methodName.substring(0, methodName.indexOf(" "));
					}

					sections[sections.length - 1].methods.push({name:methodName, content:line.trim()});
				}
			});

			resolve(sections);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getRpcMethodHelp(methodName) {
	var rpcApiFunction = function() {
		return rpcApi.getRpcMethodHelp(methodName);
	};

	return new Promise(function(resolve, reject) {
		cacheApi.tryCacheThenRpcApi( "getHelp-" + methodName, cacheApi.ONE_DAY, rpcApiFunction).then(function(helpContent) {
			var output = {};
			output.string = helpContent;

			var str = helpContent;

			var lines = str.split("\n");
			var argumentLines = [];
			var catchArgs = false;
			lines.forEach(function(line) {
				if (line.trim().length == 0) {
					catchArgs = false;
				}

				if (catchArgs) {
					argumentLines.push(line);
				}

				if (line.trim() == "Arguments:" || line.trim() == "Arguments") {
					catchArgs = true;
				}
			});

			var args = [];
			var argX = null;
			// looking for line starting with "N. " where N is an integer (1-2 digits)
			argumentLines.forEach(function(line) {
				var regex = /^([0-9]+)\.\s*"?(\w+)"?\s*\(([^,)]*),?\s*([^,)]*),?\s*([^,)]*),?\s*([^,)]*)?\s*\)\s*(.+)?$/;

				var match = regex.exec(line);

				if (match) {
					argX = {};
					argX.name = match[2];
					argX.detailsLines = [];

					argX.properties = [];

					if (match[3]) {
						argX.properties.push(match[3]);
					}

					if (match[4]) {
						argX.properties.push(match[4]);
					}

					if (match[5]) {
						argX.properties.push(match[5]);
					}

					if (match[6]) {
						argX.properties.push(match[6]);
					}

					if (match[7]) {
						argX.description = match[7];
					}

					args.push(argX);
				}

				if (!match && argX) {
					argX.detailsLines.push(line);
				}
			});

			output.args = args;

			resolve(output);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function logCacheSizes() {
	var itemCounts = [ cacheApi.redisCacheObj.itemCount];

	var stream = fs.createWriteStream("memoryUsage.csv", {flags:'a'});
	stream.write("itemCounts: " + JSON.stringify(itemCounts) + "\n");
	stream.end();
}

function getStatsForToken(token) {
	return new Promise(function(resolve, reject){
		db.Token.findOne({
			include:db.Collection,
			where: {
				group: token
			}
		}).then(function(result){
			resolve(result)
		}).catch(function(err) {
			utils.logError("getStatsForToken-failure", err);
			resolve([])
		});
	});
}

function getTokenStats(is_nft = false) {
	return new Promise(function(resolve, reject){
		db.Token.findAll({where:{ is_nft: is_nft}}).then(function(results){
			if(!results || results.length == 0) {
				resolve({
					totalTokens: 0,
					totalTransfers: 0,
					totalHolders: 0
				})
			}
			let totalTransfers = results.reduce((n, {transfers}) => n + transfers, 0)
			let totalHolders = results.reduce((n, {holders}) => n + holders, 0)
			resolve({
				totalTokens: results.length,
				totalTransfers: totalTransfers,
				totalHolders: totalHolders
			});
		}).catch(function(err) {
			utils.logError("getTokenStats-failure", err);
			reject(err)
		});
	});
}

function getNFTsCollection (pageLimit, pageoffset) {
	return new Promise(function(resolve, reject){
		// Skip 5 instances and fetch the 5 after that
		db.sequelizeInstance.query(`
			SELECT Collections.id, Collections.name, Collections.author, Collections.identifier, Collections.cover_image, COUNT(Tokens.id) as tokenCount, COUNT(Tokens.transfers) as tokenTransfers
			FROM Collections
			LEFT JOIN Tokens ON Collections.id = Tokens.collection_id
			GROUP BY Collections.id
			ORDER BY tokenCount DESC
			LIMIT :limit OFFSET :offset
		  `, {
			type: db.Sequelize.QueryTypes.SELECT,
			replacements: {
			  limit: pageLimit,
			  offset: pageoffset
			}
		  }).then(data => {
			resolve(data);
		  }).catch(function(err) {
			utils.logError("getNFTsCollection-failure", err);
			reject(err)
		  });
	});
}

function getNFTsInCollection (pageLimit = 24, pageoffset = 0, sortDir = 'desc', collection) {
	return new Promise(async function(resolve, reject){
		// Skip 5 instances and fetch the 5 after that
		db.Token.findAll({
			offset: pageoffset,
			limit: pageLimit,
			where: {
				collection_id: collection.id
			},
			order: [
				['genesis_datetime', sortDir]
			]
		}).then(function(results){
			resolve(results);
		}).catch(function(err) {
			utils.logError("getNFTsInCollection-failure", err);
			reject(err)
		});
	});
}

function getNewNFTS (pageLimit = 24, pageoffset = 0) {
	return new Promise(function(resolve, reject){
		// Skip 5 instances and fetch the 5 after that
		db.Token.findAll({
			offset: pageoffset,
			limit: pageLimit,
			where: {
				is_nft: true
			},
			order: [
				['genesis_datetime', 'desc']
			]
		}).then(function(results){
			resolve(results);
		}).catch(function(err) {
			utils.logError("getNewNFTS-failure", err);
			reject(err)
		});
	});
}

function getAllNFTs (pageLimit = 24, pageoffset = 0) {
	return new Promise(function(resolve, reject){
		// Skip 5 instances and fetch the 5 after that
		db.Token.findAll({
			offset: pageoffset,
			limit: pageLimit,
			where: {
				is_nft: true
			},
			order: [
				['genesis_datetime', 'asc']
			]
		}).then(function(results){
			resolve(results);
		}).catch(function(err) {
			utils.logError("getAllNFTs-failure", err);
			reject(err)
		});
	});
}

function getTotalNFTs(){
	return new Promise(function(resolve, reject){
		// Skip 5 instances and fetch the 5 after that
		db.Token.count({
			where: {
				is_nft: true
			},
		}).then(function(results){
			resolve(results);
		}).catch(function(err) {
			utils.logError("getTotalNFTs-failure", err);
			reject(err)
		});
	});
}


function getTotalNFTsInCollectionCount(collection){
	return new Promise(async function(resolve, reject){
		// Skip 5 instances and fetch the 5 after that
		db.Token.count({
			where: {
				collection_id: collection.id
			},
		}).then(function(results){
			resolve(results);
		}).catch(function(err) {
			utils.logError("getTotalNFTs-failure", err);
			reject(err)
		});
	});
}

function getNFTCollectionStats(collection){
	return new Promise(async function(resolve, reject){
		db.Token.findAll({
			where: {
				is_nft: true,
				collection_id: collection.id
			},
			attributes: {
				include: [
					[db.sequelizeInstance.fn('COUNT', db.sequelizeInstance.col('holders')), 'holders_count'],
					[db.sequelizeInstance.fn('COUNT', db.sequelizeInstance.col('transfers')), 'transfers_count']
				],
			},
			raw:true
		}).then(function(results){
			resolve(results);
		}).catch(function(err) {
			utils.logError("getTotalNFTsInCollection-failure", err);
			reject(err)
		});
	});
}

function getTotalNFTsCollectionCount(){
	return new Promise(function(resolve, reject){
		// Skip 5 instances and fetch the 5 after that
		db.Collection.count({
		}).then(function(results){
			resolve(results);
		}).catch(function(err) {
			utils.logError("getTotalNFTsCollectionCount-failure", err);
			reject(err)
		});
	});
}

// sum the holders of all NFT's
function getNFTsHoldersCount () {
	return new Promise(function(resolve, reject){
		db.Token.sum('holders', {
			where: {
				is_nft: true
			},
		}).then(function(results){
			resolve(results);
		}).catch(function(err) {
			utils.logError("getNFTsHoldersCount-failure", err);
			reject(err)
		});
	});
}

// find an NFT
function getNFT(group) {
	return new Promise(function(resolve, reject){
		// Skip 5 instances and fetch the 5 after that
		db.Token.findOne({
			where: {
				is_nft: true,
				group: group
			}
		}).then(function(results){
			resolve(results);
		}).catch(function(err) {
			utils.logError("Getting NFT Failure", err);
			resolve([])
		});
	});
}

// get all tokens and paginate
function getTokens(pageLimit = 24, pageoffset = 0, sortDir = 'desc'){
	return new Promise(function(resolve, reject){
		// Skip 5 instances and fetch the 5 after that
		db.Token.findAll({
			offset: pageoffset,
			limit: pageLimit,
			where: {
				is_nft: false
			},
			order: [
				['transfers', sortDir]
			]
		}).then(function(results){
			resolve(results);
		}).catch(function(err) {
			utils.logError("getTokens() failure: ", err);
			reject(err)
		});
	});
}

// get transfers for a token / nft
async function getTransfersForToken(token, size, page) {
	return new Promise(function(resolve, reject){
		getPaginatedData(token, size, page)
		.then(function(results){
			resolve(results);
		}).catch(function(err) {
			utils.logError("getTokens() failure: ", err);
			reject(err)
		});
	});
}

// get richlist / holders for an token / nft
function getRichList(token) {
	return new Promise(function(resolve, reject){
		tokenApi.fetchRichlist(token)
		.then(function(results){
			resolve(results);
		}).catch(function(err) {
			utils.logError("getTokens() failure: ", err);
			reject(err)
		});
	});
}

// get holders count for a single token / nft
function getTokenHolders(token) {
	return new Promise(function(resolve, reject){
		tokenApi.fetchTokenHoldersCount(token).then(function(result) {
			resolve(result);
		}).catch(function(err) {
			utils.logError("token-holders-failure", err, {token:token});
			reject(err)
		});
	});
}



function getTokenOperations(token) {
	return new Promise(function(resolve, reject){
		tokenApi.fetchTokenOperations(token)
		.then(function(results){
			resolve(results);
		}).catch(function(err) {
			utils.logError("getTokens() failure: ", err);
			reject(err)
		});
	});
}

function getTransactionTokens(txids) {
	return new Promise(async function(resolve, reject){

		const rawTxResult = await getRawTransactionsWithInputs(txids);

		var handledTxids = [];
		let tokens = new Set();
		let tokensWithData = {};

		rawTxResult.transactions.forEach((tx) => {
			const txInputs = rawTxResult.txInputsByTransaction[tx.txid];

			if (handledTxids.includes(tx.txid)) {
				return;
			}

			handledTxids.push(tx.txid);

			tx.vout.forEach((vout) => {
				if (vout.scriptPubKey && vout.scriptPubKey.group) {
					try {
						if (Address.fromString(vout.scriptPubKey.group).isGroupIdentifierAddress()) tokens.add(vout.scriptPubKey.group);
					} catch (err) {
						debugLog("An error occured while parsing transaction " + tx.txidem + " outputs searching for tokens");
						debugLog(err);
					}
				}
			});

			tx.vin.forEach((vin, j) => {
				const txInput = txInputs[j];

				if (txInput && txInput.scriptPubKey && txInput.scriptPubKey.group) {
					try {
						if (Address.fromString(txInput.scriptPubKey.group).isGroupIdentifierAddress()) tokens.add(txInput.scriptPubKey.group);
					} catch (err) {
						debugLog("An error occured while parsing transaction " + tx.txidem + " inputs searching for tokens");
						debugLog(err)
					}
				}
			});
		});
		tokens = [...tokens];

		let tokenDbObj = await db.Token.findAll({
			where: {
			  group: {
				[Op.in]: tokens
			  }
			}
		})

		for (const token of tokens) {
			tokensWithData[token] = tokenDbObj.find((tk) => tk.group == token);
		}

		resolve(tokensWithData);
	});
}

async function readKnownTokensIntoCache() {
	await tokenLoadQueue.createJob({})
		.timeout(30000)
		.retries(2)
		.save()
}

// Main function to get reverse paginated data
async function getPaginatedData(token, pageSize, page) {
	try {
		const data = await tokenApi.fetchTransfers(token, page, pageSize);

		if(data.transactions.length > 0) {
			for(var i = 0; i < data.transactions.length; i++) {

				const rawTxResult = await getRawTransactionsWithInputs([data.transactions[i].txId]);

				var inputs = [];
				var outputs = [];

				rawTxResult.transactions.forEach((tx) => {
					const txInputs = rawTxResult.txInputsByTransaction[tx.txid];

					tx.vout.forEach((vout) => {
						if (vout.scriptPubKey && vout.scriptPubKey.group) {
							try {
								if (Address.fromString(vout.scriptPubKey.group).isGroupIdentifierAddress())
									outputs.push({
										group: vout.scriptPubKey.group,
										groupQuantity: vout.scriptPubKey.groupQuantity,
										groupAuthority: vout.scriptPubKey.groupAuthority,
										address: vout.scriptPubKey.addresses[0]
									})
							} catch (err) {
								debugLog("vout electrum error", err)
							}
						}
					});

					tx.vin.forEach((vin, j) => {
						const txInput = txInputs[j];

						if (txInput && txInput.scriptPubKey && txInput.scriptPubKey.group) {
							try {
								if (Address.fromString(txInput.scriptPubKey.group).isGroupIdentifierAddress())
									inputs.push({
										group: txInput.scriptPubKey.group,
										groupQuantity: txInput.scriptPubKey.groupQuantity,
										groupAuthority: txInput.scriptPubKey.groupAuthority,
										address: txInput.scriptPubKey.addresses[0]
									})
							} catch (err) {
								debugLog("vin electrum error", err)
							}
						}
					});
				});
				data.transactions[i].inputs = inputs;
				data.transactions[i].outputs = outputs;
			}

			return data.transactions
		} else {
			return []
		}
	} catch (error) {
		console.error('Error fetching data:', error);
	}
}



export default {
	getGenesisBlockHash,
	getGenesisCoinbaseTransactionId,
	getBlockchainInfo,
	getNetworkInfo,
	getNetTotals,
	getTxpoolInfo,
	getTxpoolTxids,
	getMiningInfo,
	getBlock,
	getBlocks,
	getBlockByHeight,
	getBlocksByHeight,
	getBlockByHashWithTransactions,
	getMiningCandidate,
	getRawTransaction,
	getRawTransactions,
	getRawTransactionsWithInputs,
	getRecentBlocksMinimalData,
	getTxUtxos,
	getTxpoolTxDetails,
	getUptimeSeconds,
	getHelp,
	getRpcMethodHelp,
	getAddress,
	logCacheSizes,
	getPeerSummary,
	getChainTxStats,
	getTxpoolDetails,
	getTxCountStats,
	getUtxoSetSummary,
	getNetworkHashrate,
	getBlockStats,
	getBlockCount,
	getBlocksStats,
	getBlocksStatsByHeight,
	buildBlockAnalysisData,
	getBlockHeader,
	getBlockHeaderByHeight,
	getBlockHeadersByHeight,
	decodeScript,
	decodeRawTransaction,
	validateRawTransaction,
	getBlockList,
	getTokenMintage,
	getTransaction,
	getTransactions,
	getTransfersForToken,
	getRichList,
	getTokenHolders,
	getTokenOperations,
	getTokens,
	getNFT,
	getNFTsCollection,
	getNFTsInCollection,
	getNFTsHoldersCount,
	getTotalNFTs,
	getTokenStats,
	getStatsForToken,
	readKnownTokensIntoCache,
	getTokenGenesis,
	getTransactionTokens,
	getTotalNFTsCollectionCount,
	getNFTCollectionStats,
	getNewNFTS,
	getAllNFTs,
	getTotalNFTsInCollectionCount,
	getMarketDataForToken,
	getGeoDataForIps
};
