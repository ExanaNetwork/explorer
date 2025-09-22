import debug from 'debug';
const debugLogError = debug("nexexp:error");
import config from "./../config.js";
import coins from "../coins.js";
import utils from "../utils.js";
import crypto from 'crypto-js';
import coreApi from './coreApi.js';
import rpcApi from './rpcApi.js';
import { ClusterOrder, ElectrumCluster, ElectrumTransport } from 'electrum-cash';
import global from "../global.js";
import db from '../../models/index.js';
const debugLog = debug("nexexp:electrumx");
import tokenProcessQueue from '../tokenProcessQueue.js';
import {Address, AddressType} from "libexana-ts";
var Op = db.Sequelize.Op;

const coinConfig = coins[config.coin];

let electrum;

var noConnectionsErrorText = "No ElectrumX connection available. This could mean that the connection was lost or that ElectrumX is processing transactions and therefore not accepting requests. This tool will try to reconnect. If you manage your own ElectrumX server you may want to check your ElectrumX logs.";

const handleNotifications = async function (data) {
	if(data.method === 'blockchain.headers.subscribe')
	{
		let blockHash = await rpcApi.getBlockHash(data.params[0].height);
		let block = await coreApi.getBlockByHashWithTransactions(blockHash, 1000, 0);

		let txIds =  block.transactions.map(x => x.txid);
		let tokens = new Set();
		let NFTs = new Set();
		const rawTxResult = await coreApi.getRawTransactionsWithInputs(txIds);

		var handledTxids = [];

		rawTxResult.transactions.forEach((tx) => {
			const txInputs = rawTxResult.txInputsByTransaction[tx.txid];

			if (handledTxids.includes(tx.txid)) {
				return;
			}

			handledTxids.push(tx.txid);

			tx.vout.forEach((vout) => {
				if (vout.scriptPubKey && vout.scriptPubKey.group) {
					try {
						if (Address.fromString(vout.scriptPubKey.group).isGroupIdentifierAddress())
							utils.parseGroupData(tokens, NFTs, vout.scriptPubKey.group, global.activeBlockchain);
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
							utils.parseGroupData(tokens, NFTs, txInput.scriptPubKey.group, global.activeBlockchain);
					} catch (err) {
						debugLog("vin electrum error", err)
					}
				}
			});
		});
		tokens = [...tokens];
		debugLog('tokens caught by electrum: ', tokens)
		NFTs = [...NFTs]
		debugLog('NFTS caught by electrum: ', NFTs)

		for (const token of tokens) {
			try {
				await tokenProcessQueue.createJob({token: token, isNFT: false})
					.timeout(30000)
					.retries(2)
					.delayUntil(Date.now() + 120000)
					.save()
			} catch (err) {
				debugLogError(err)
			}
		}

		for (const nft of NFTs) {
			debugLog("Updating NFT in cache: ",nft)
			try {
				await tokenProcessQueue.createJob({token: nft, isNFT: true})
					.timeout(30000)
					.retries(2)
					.delayUntil(Date.now() + 120000)
					.save()
			} catch (err) {
				debugLogError(err)
			}
		}
	}
}

function connectToServers() {
	debugLog('Connecting to Electrum...')
	return new Promise(async function(resolve, reject) {
		try {
			electrum = new ElectrumCluster('exana-rpc-explorer', '1.4.3', 1, config.electrumXServers.length, ClusterOrder.PRIORITY, 30000);
			for (let i = 0; i < config.electrumXServers.length; i++) {
				const {host, port, protocol} = config.electrumXServers[i];
				let defaultProtocol;
				switch (protocol) {
					case "tcp":
						defaultProtocol = ElectrumTransport.TCP.Scheme;
						break;
					case "tcp_tls":
						defaultProtocol = ElectrumTransport.TCP_TLS.Scheme;
						break;
					case "ws":
						defaultProtocol = ElectrumTransport.WS.Scheme;
						break;
					case "wss":
						defaultProtocol = ElectrumTransport.WSS.Scheme;
						break;
				}
				await electrum.addServer(host, port, defaultProtocol);
			}
			await electrum.startup()
			if(electrum.connections === 0) {
				reject("Not connected to enough electrum servers")
			}
			electrum.on('notification', handleNotifications);
			debugLog(`Connected to ElectrumX with ${electrum.connections} connections`);
			resolve()
		} catch (e) {
			reject(e)
		}

	});
}

function shutdown() {
	return electrum.shutdown();
}

function getAddressDetails(address, scriptPubkey, sort, limit, offset) {
	return new Promise(function(resolve, reject) {
		if (electrum.clients.length == 0) {
			reject({error: "No ElectrumX Connection", userText: noConnectionsErrorText});

			return;
		}

		var addrScripthash = crypto.enc.Hex.stringify(crypto.SHA256(crypto.enc.Hex.parse(scriptPubkey)));
		addrScripthash = addrScripthash.match(/.{2}/g).reverse().join("");

		var promises = [];

		var txidData = null;
		var balanceData = null;
		// TODO exit early in case getAddressTxids or getAddressBalance fails
		promises.push(new Promise(function(resolve2, reject2) {
			getAddressTxids(addrScripthash).then(function(result) {
				txidData = result;

				resolve2();

			}).catch(function(err) {
				err.userData = {address:address, sort:sort, limit:limit, offset:offset};

				utils.logError("2397wgs0sgse", err);

				reject2(err);
			});
		}));

		promises.push(new Promise(function(resolve2, reject2) {
			getAddressBalance(addrScripthash).then(function(result) {
				balanceData = result;

				resolve2();

			}).catch(function(err) {
				err.userData = {address:address, sort:sort, limit:limit, offset:offset};

				utils.logError("21307ws70sg", err);

				reject2(err);
			});
		}));

		Promise.all(promises.map(utils.reflectPromise)).then(function(results) {
			var addressDetails = {};
			if (txidData) {
				addressDetails.txCount = txidData.length;

				addressDetails.txids = [];
				addressDetails.blockHeightsByTxid = {};

				if (sort == "desc") {
					txidData.reverse();
				}

				for (var i = offset; i < Math.min(txidData.length, limit + offset); i++) {
					addressDetails.txids.push(txidData[i].tx_hash);
					addressDetails.blockHeightsByTxid[txidData[i].tx_hash] = txidData[i].height;
				}
			}

			if (balanceData) {
				addressDetails.balanceSat = balanceData.confirmed;
			}

			var errors = [];
			results.forEach(function(x) {
				if (x.status == "rejected") {
					errors.push(x);
				}
			});

			resolve({addressDetails:addressDetails, errors:errors});
		});
	});
}



function getAddressTxids(addrScripthash) {
	return new Promise(async function(resolve, reject) {
		try {
		 	let results = await electrum.request('blockchain.scripthash.get_history', addrScripthash);
			debugLog(`getAddressTxids=${utils.ellipsize(JSON.stringify(results, utils.bigIntToRawJSON), 200)}`);

			if (addrScripthash == coinConfig.genesisCoinbaseOutputAddressScripthash) {
				for (var i = 0; i < results.length; i++) {
					results[i].result.unshift({tx_hash:coinConfig.genesisCoinbaseTransactionIdsByNetwork[global.activeBlockchain], height:0});
				}
			}

			var first = results[0];
			var done = false;

			for (var i = 1; i < results.length; i++) {
				if (results[i].length != first.length) {
					resolve({conflictedResults:results});

					done = true;
				}
			}

			if (!done) {
				resolve(results);
			}
		} catch (err) {
			reject(err);
		}
	});
}

function getAddressBalance(addrScripthash) {
	return new Promise(async function(resolve, reject) {
		try {
			let results = await electrum.request('blockchain.scripthash.get_balance', addrScripthash);

			debugLog(`getAddressBalance=${JSON.stringify(results, utils.bigIntToRawJSON)}`);

			if (addrScripthash == coinConfig.genesisCoinbaseOutputAddressScripthash) {
				for (var i = 0; i < results.length; i++) {
					var coinbaseBlockReward = coinConfig.blockRewardFunction(0, global.activeBlockchain);

					results[i].result.confirmed += (coinbaseBlockReward * coinConfig.baseCurrencyUnit.multiplier);
				}
			}

			var first = results[0];
			var done = false;

			for (var i = 1; i < results.length; i++) {
				if (results[i].confirmed != first.confirmed) {
					resolve({conflictedResults:results});

					done = true;
				}
			}

			if (!done) {
				resolve(results);
			}
		} catch (err) {
			reject(err);
		}
	});
}

async function getTokenBalanceForAddress(address, token) {
	let results;
	if (token) {
		results = await executeElectrumRequest('token.address.get_balance', address, null, token);
	} else {
		results = await executeElectrumRequest('token.address.get_balance', address);
	}
	return mergeBalances(results);
}

async function getTokenTransactionsForAddress(address) {
	return await executeElectrumRequest('token.address.get_history', address)
}

async function getTokenTransactions(token) {
	const results = await executeElectrumRequest('token.transaction.get_history', token, null);
	debugLog(`getTokenTransactions=${JSON.stringify(results, utils.bigIntToRawJSON)}`);
	return results.history;
}

async function getTokenGenesis(tokenID) {
	const results = await executeElectrumRequest('token.genesis.info', tokenID);
	debugLog(`tokenGenesisInfo=${JSON.stringify(results, utils.bigIntToRawJSON)}`);
	return results;
}

async function getTx(tx) {
	const results = await executeElectrumRequest('blockchain.transaction.get', tx,true);
	debugLog(`getTx=${JSON.stringify(results, utils.bigIntToRawJSON)}`);
	return results;
}

async function getTokenNFTs(tokenID) {
	const results = await executeElectrumRequest('token.nft.list', tokenID);
	debugLog(`getTokenNFTs=${JSON.stringify(results, utils.bigIntToRawJSON)}`);
	return results;
}

async function subscribeToBlockHeaders() {
	const results = await electrum.subscribe('blockchain.headers.subscribe');
	if (results instanceof Error) {
		throw results;
	}

	return results;
}


async function executeElectrumRequest(method, ...params) {
	try {
		const results = await electrum.request(method, ...params);
		if (results instanceof Error) {
			throw results;
		}
		return results;
	} catch (error) {
		throw error;
	}
}

async function mergeBalances(balanceResults) {
	let mergedBalances = {};
	var network = global.activeBlockchain === "exana" ? "mainnet" : "testnet";

	// Combine confirmed and unconfirmed balances
	for (const type of ['confirmed', 'unconfirmed']) {
		for (const key of Object.keys(balanceResults[type])) {
			let group = new Address(Buffer.from(key, 'hex'), network, AddressType.GroupIdAddress).toString()
			let token = {}
			if(mergedBalances[group] == null) {
				mergedBalances[group] = {}
			} else{
				token = mergedBalances[group]
			}
			token[type + 'Balance'] = balanceResults[type][key];
			mergedBalances[group] = token;
		}
	}

	const dbTokens = await db.Token.findAll({
		where:{
			group: {
				[Op.in]: Object.keys(mergedBalances)
			}
		},
	})
	for(let i = 0; i < dbTokens.length; i++){
		const data = dbTokens[i];
		const mergedData = mergedBalances[data.group]
		const keys = Object.keys(mergedData);
		if(!data.is_nft){
			if(keys.includes('confirmedBalance')){
				mergedData['confirmedBalanceFormatted'] = formatBalance(mergedData['confirmedBalance'], data.genesis.decimal_places);
			}
			if(keys.includes('unconfirmedBalance')){
				mergedData['unconfirmedBalanceFormatted'] = formatBalance(mergedData['confirmedBalance'], data.genesis.decimal_places);
			}
		}
		let token = {}
		Object.assign(token, data.dataValues, mergedData);
		mergedBalances[data.group] = token
	}
	return mergedBalances;
}

function formatBalance(amountNotFormatted, decimalPlaces) {
	return decimalPlaces > 0
		? `${amountNotFormatted}`.slice(0, -decimalPlaces) + "." + `${amountNotFormatted}`.slice(-decimalPlaces)
		: amountNotFormatted;
}

export default {
	connectToServers,
	getAddressDetails,
	getTokenGenesis,
	getTokenTransactions,
	getTokenBalanceForAddress,
	subscribeToBlockHeaders,
	shutdown,
	getTokenTransactionsForAddress,
	getTokenNFTs,
	getTx
};
