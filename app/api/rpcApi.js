import debug from 'debug';
import async from "async";
import semver from "semver";
import utils from "../utils.js";
import config from "../config.js";
import coins from "../coins.js";
import global from "../global.js";
import RpcError from "../errors/rpcError.js";

const debugLog = debug("nexexp:rpc");
var activeQueueTasks = 0;
const coinConfig = coins[config.coin];

var rpcQueue = async.queue(function(task, callback) {
	activeQueueTasks++;

	task.rpcCall(function() {
		try {
			callback();
		}

		catch(err){
			debugLog(err)
		}
		activeQueueTasks--;
	});

}, config.rpcConcurrency);


global.rpcStats = {};


function getBlockCount() {
	return getRpcData("getblockcount");
}

function getBlockchainInfo() {
	return getRpcData("getblockchaininfo");
}

function getNetworkInfo() {
	return getRpcData("getnetworkinfo");
}

function getNetTotals() {
	return getRpcData("getnettotals");
}

function getTxpoolInfo() {
	return getRpcData("gettxpoolinfo");
}

function getMiningInfo() {
	return getRpcData("getmininginfo");
}

function getUptimeSeconds() {
	return getRpcData("uptime");
}

function getPeerInfo() {
	return getRpcData("getpeerinfo");
}

function getTxpoolTxids() {
	return getRpcDataWithParams({method:"getrawtxpool", parameters:[false]});
}

function getNetworkHashrate(blockCount=720) {
	return getRpcDataWithParams({method:"getnetworkhashps", parameters:[blockCount]});
}

function getBlockStats(hash_or_height) {
	if ((hash_or_height == coinConfig.genesisBlockHashesByNetwork[global.activeBlockchain] || hash_or_height == 0) && coinConfig.genesisBlockStatsByNetwork[global.activeBlockchain]) {
		return new Promise(function(resolve, reject) {
			resolve(coinConfig.genesisBlockStatsByNetwork[global.activeBlockchain]);
		});
	} else {
		return getRpcDataWithParams({method:"getblockstats", parameters:[hash_or_height]});
	}
}

function tokenMintage(token) {
	return getRpcDataWithParams({method: "token", parameters: ["mintage", token]})
}

function decodeScript(hex) {
	return getRpcDataWithParams({method:"decodescript", parameters:[hex]});
}

function decodeRawTransaction(hex) {
	return getRpcDataWithParams({method:"decoderawtransaction", parameters:[hex]});
}
function validateRawTransaction(hex) {
	return getRpcDataWithParams({method:"validaterawtransaction", parameters:[hex]});
}


function getUtxoSetSummary() {
	return getRpcData("gettxoutsetinfo");
}

function dumpTokenset() {
	return getRpcData("dumptokenset");
}

function getRawTxpool() {
	return new Promise(function(resolve, reject) {
		getRpcDataWithParams({method:"getrawtxpool", parameters:[false]}).then(function(txids) {
			var promises = [];

			for (var i = 0; i < txids.length; i++) {
				var txid = txids[i];

				promises.push(getRawTxpoolEntry(txid));
			}

			Promise.all(promises).then(function(results) {
				var finalResult = {};

				for (var i = 0; i < results.length; i++) {
					if (results[i] != null) {
						finalResult[results[i].txid] = results[i];
					}
				}

				resolve(finalResult);

			}).catch(function(err) {
				reject(err);
			});

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getRawTxpoolEntry(txid) {
	return new Promise(function(resolve, reject) {
		getRpcDataWithParams({method:"gettxpoolentry", parameters:[txid]}).then(function(result) {
			result.txid = txid;

			resolve(result);

		}).catch(function(err) {
			resolve(null);
		});
	});
}

function getChainTxStats(blockCount) {
	return getRpcDataWithParams({method:"getchaintxstats", parameters:[blockCount]});
}

function getBlockHash(blockHeight) {
	return getRpcDataWithParams({method:"getblockhash", parameters:[blockHeight]});
}

function getBlock(hash_or_height) {
	return getRpcDataWithParams({method:"getblock", parameters:[hash_or_height]});
}

function getBlockHeader(hash_or_height) {
	return getRpcDataWithParams({method:"getblockheader", parameters:[hash_or_height]});
}

function getAddress(address) {
	return getRpcDataWithParams({method:"validateaddress", parameters:[address]});
}

function getMiningCandidate(args = {}) {
	return getRpcDataWithParams({method:"getminingcandidate", parameters:[args]});
}

function getTransaction(tx) {
	return getRpcDataWithParams({method: "gettransaction", parameters: [tx]});
}

function getRawTransaction(txid) {
	return new Promise(function(resolve, reject) {
		if (coins[config.coin].genesisCoinbaseTransactionIdsByNetwork[global.activeBlockchain] && txid == coins[config.coin].genesisCoinbaseTransactionIdsByNetwork[global.activeBlockchain]) {
			// copy the "confirmations" field from genesis block to the genesis-coinbase tx
			getBlockchainInfo().then(function(blockchainInfoResult) {
				var result = coins[config.coin].genesisCoinbaseTransactionsByNetwork[global.activeBlockchain];
				result.confirmations = blockchainInfoResult.blocks;

				// hack: default regtest node returns "0" for number of blocks, despite including a genesis block;
				// to display this block without errors, tag it with 1 confirmation
				if (global.activeBlockchain == "regtest" && result.confirmations == 0) {
					result.confirmations = 1;
				}

				resolve(result);

			}).catch(function(err) {
				reject(err);
			});

		} else {
			getRpcDataWithParams({method:"getrawtransaction", parameters:[txid, 1]}).then(function(result) {
				if (result == null || result.code && result.code < 0) {
					reject(result);

					return;
				}

				// ABC & BCHN do not set the confirmations property on unconfirmed TXs
				if (result.confirmations === undefined)
					result.confirmations = 0;

				resolve(result);

			}).catch(function(err) {
				debugLog(err);
				reject(err);
			});
		}
	});
}

function getUtxo(txid, outputIndex) {
	return new Promise(function(resolve, reject) {
		getRpcDataWithParams({method:"gettxout", parameters:[txid, outputIndex]}).then(function(result) {
			if (result == null) {
				resolve("0");

				return;
			}

			if (result.code && result.code < 0) {
				reject(result);

				return;
			}

			resolve(result);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getTxpoolTxDetails(txid, includeAncDec=true) {
	debugLog("getTxpoolTxDetails: %s", txid);

	var promises = [];

	var txpoolDetails = {};

	promises.push(new Promise(function(resolve, reject) {
		getRpcDataWithParams({method:"gettxpoolentry", parameters:[txid]}).then(function(result) {
			txpoolDetails.entry = result;

			resolve();

		}).catch(function(err) {
		debugLog(err);
			reject(err);
		});
	}));

	if (includeAncDec) {
		promises.push(new Promise(function(resolve, reject) {
			getRpcDataWithParams({method:"gettxpoolancestors", parameters:[txid]}).then(function(result) {
				txpoolDetails.ancestors = result;

				resolve();

			}).catch(function(err) {
				reject(err);
			});
		}));

		promises.push(new Promise(function(resolve, reject) {
			getRpcDataWithParams({method:"gettxpooldescendants", parameters:[txid]}).then(function(result) {
				txpoolDetails.descendants = result;

				resolve();

			}).catch(function(err) {
				reject(err);
			});
		}));
	}

	return new Promise(function(resolve, reject) {
		Promise.all(promises).then(function() {
			resolve(txpoolDetails);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function getHelp() {
	return getRpcData("help");
}

function getRpcMethodHelp(methodName) {
	return getRpcDataWithParams({method:"help", parameters:[methodName]});
}



function getRpcData(cmd) {
	var startTime = new Date().getTime();

	return new Promise(function(resolve, reject) {
		debugLog(`RPC: ${cmd}`);

		let rpcCall = function(callback) {
			var client = (cmd == "gettxoutsetinfo" ? global.rpcClientNoTimeout : global.rpcClient);
			try {
				client.request(cmd, [], function(err, rpcResult) {
					if(err) {
						err.userData = {request:cmd};

						utils.logError("9u4278t5h7rfhgf", new RpcError(err), {request:cmd});

						reject(err);

						callback();
					};

					let result = null;
					if(rpcResult) {
						result = rpcResult.result;
					}

					if (Array.isArray(result) && result.length == 1) {
						var result0 = result[0];
						if (result0 && result0.name && result0.name == "RpcError") {

							logStats(cmd, false, new Date().getTime() - startTime, false);

							throw new Error(`RpcError: type=errorResponse-01`);
						}
					}

					if (result.name && result.name == "RpcError") {
						logStats(cmd, false, new Date().getTime() - startTime, false);

						throw new Error(`RpcError: type=errorResponse-02`);
					}

					resolve(result);

					logStats(cmd, false, new Date().getTime() - startTime, true);

					callback();

				});
			} catch (err) {
				reject(err);
			}

		};

		rpcQueue.push({rpcCall:rpcCall});
	});
}

function getRpcDataWithParams(request) {
	var startTime = new Date().getTime();

	return new Promise(function(resolve, reject) {
		debugLog(`RPC: ${JSON.stringify(request)}`);

		let rpcCall = async function(callback) {
			let client = (request.method == "gettxoutsetinfo" ? global.rpcClientNoTimeout : global.rpcClient);

			try {
				client.request(request.method, request.parameters, function(err, rpcResult) {
					if(err) {
						 
						err.userData = {request:request};
						const rpcError = new RpcError(err)

						utils.logError("283h7ewsede", err, rpcError, {request:request});
						logStats(request.method, true, new Date().getTime() - startTime, false)

						reject(rpcError);

						callback();
					};
					let result = null;
					if(rpcResult) {
						result = rpcResult.result;
					}

					if (Array.isArray(result) && result.length == 1) {
						var result0 = result[0];


						if (result0 && result0.name && result0.name == "RpcError") {
							logStats(request.method, true, new Date().getTime() - startTime, false);

								throw new Error(`RpcError: type=errorResponse-03`);
						}
					}

					if (result && result.name && result.name == "RpcError") {
						logStats(request.method, true, new Date().getTime() - startTime, false);

						throw new Error(`RpcError: type=errorResponse-04`);
					}

					resolve(result);

					logStats(request.method, true, new Date().getTime() - startTime, true);

					callback();
				});
			} catch (err) {
				resolve(err)
			}

		};

		rpcQueue.push({rpcCall:rpcCall});
	});
}

function unsupportedPromise(minRpcVersionNeeded) {
	return new Promise(function(resolve, reject) {
		resolve({success:false, error:"Unsupported", minRpcVersionNeeded:minRpcVersionNeeded});
	});
}

function logStats(cmd, hasParams, dt, success) {
	if (!global.rpcStats[cmd]) {
		global.rpcStats[cmd] = {count:0, withParams:0, time:0, successes:0, failures:0};
	}

	global.rpcStats[cmd].count++;
	global.rpcStats[cmd].time += dt;

	if (hasParams) {
		global.rpcStats[cmd].withParams++;
	}

	if (success) {
		global.rpcStats[cmd].successes++;

	} else {
		global.rpcStats[cmd].failures++;
	}
}

export default {
	getBlockchainInfo,
	getNetworkInfo,
	getNetTotals,
	getTxpoolInfo,
	getTxpoolTxids,
	getMiningInfo,
	getBlockHash,
	getBlock,
	getBlockCount,
	getMiningCandidate,
	getRawTransaction,
	getUtxo,
	getTxpoolTxDetails,
	getRawTxpool,
	getUptimeSeconds,
	getHelp,
	getRpcMethodHelp,
	getAddress,
	getPeerInfo,
	getChainTxStats,
	getUtxoSetSummary,
	getNetworkHashrate,
	getBlockStats,
	getBlockHeader,
	decodeScript,
	decodeRawTransaction,
	validateRawTransaction,
	tokenMintage,
	getTransaction,
	dumpTokenset
};
