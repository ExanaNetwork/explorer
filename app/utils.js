var debug = require("debug");

var debugLog = debug("nexexp:utils");
var debugErrorLog = debug("nexexp:error");
var debugErrorVerboseLog = debug("nexexp:errorVerbose");
var debugPerfLog = debug("nexexp:actionPerformace");

var Decimal = require("decimal.js");
var axios = require("axios");
var qrcode = require("qrcode");
var textdecoding = require("text-decoding");
const fs = require('fs');
const path = require('path');

var config = require("./config.js");
var coins = require("./coins.js");
var coinConfig = coins[config.coin];
var redisCache = require("./redisCache.js");


var ipMemoryCache = {};

var ipRedisCache = null;
if (redisCache.active) {
	var onRedisCacheEvent = function(cacheType, eventType, cacheKey) {
		global.cacheStats.redis[eventType]++;
	}

	ipRedisCache = redisCache.createCache("v0", onRedisCacheEvent);
}

var ipCache = {
	get:function(key) {
		return new Promise(function(resolve, reject) {
			if (ipMemoryCache[key] != null) {
				resolve({key:key, value:ipMemoryCache[key]});

				return;
			}

			if (ipRedisCache != null) {
				ipRedisCache.get("ip-" + key).then(function(redisResult) {
					if (redisResult != null) {
						resolve({key:key, value:redisResult});

						return;
					}

					resolve({key:key, value:null});
				});

			} else {
				resolve({key:key, value:null});
			}
		});
	},
	set:function(key, value, expirationMillis) {
		ipMemoryCache[key] = value;

		if (ipRedisCache != null) {
			ipRedisCache.set("ip-" + key, value, expirationMillis);
		}
	}
};

function perfMeasure(req) {
	var time = Date.now() - req.startTime;
	var memdiff = process.memoryUsage().heapUsed - req.startMem;

	debugPerfLog("Finished action '%s' in %d ms", req.path, time);
}

function redirectToConnectPageIfNeeded(req, res) {
	if (!req.session.host) {
		req.session.redirectUrl = req.originalUrl;

		res.redirect("/");
		res.end();

		return true;
	}

	return false;
}

function hex2ascii(hex) {
	var str = "";
	for (var i = 0; i < hex.length; i += 2) {
		str += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
	}

	return str;
}

function hex2array(hex) {
	return new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
}

function hex2string(hex, encoding = 'utf-8') {
	return new textdecoding.TextDecoder(encoding).decode(hex2array(hex))
}

function splitArrayIntoChunks(array, chunkSize) {
	var j = array.length;
	var chunks = [];

	for (var i = 0; i < j; i += chunkSize) {
		chunks.push(array.slice(i, i + chunkSize));
	}

	return chunks;
}

function splitArrayIntoChunksByChunkCount(array, chunkCount) {
	var bigChunkSize = Math.ceil(array.length / chunkCount);
	var bigChunkCount = chunkCount - (chunkCount * bigChunkSize - array.length);

	var chunks = [];

	var chunkStart = 0;
	for (var chunk = 0; chunk < chunkCount; chunk++) {
		var chunkSize = (chunk < bigChunkCount ? bigChunkSize : (bigChunkSize - 1));

		chunks.push(array.slice(chunkStart, chunkStart + chunkSize));

		chunkStart += chunkSize;
	}

	return chunks;
}

function getRandomString(length, chars) {
	var mask = '';
	
	if (chars.indexOf('a') > -1) {
		mask += 'abcdefghijklmnopqrstuvwxyz';
	}
	
	if (chars.indexOf('A') > -1) {
		mask += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
	}
	
	if (chars.indexOf('#') > -1) {
		mask += '0123456789';
	}
	
	if (chars.indexOf('!') > -1) {
		mask += '~`!@#$%^&*()_+-={}[]:";\'<>?,./|\\';
	}
	
	var result = '';
	for (var i = length; i > 0; --i) {
		result += mask[Math.floor(Math.random() * mask.length)];
	}

	return result;
}

var formatCurrencyCache = {};

function getCurrencyFormatInfo(formatType) {
	if (formatCurrencyCache[formatType] == null) {
		for (var x = 0; x < coins[config.coin].currencyUnits.length; x++) {
			var currencyUnit = coins[config.coin].currencyUnits[x];

			for (var y = 0; y < currencyUnit.values.length; y++) {
				var currencyUnitValue = currencyUnit.values[y];

				if (currencyUnitValue == formatType) {
					formatCurrencyCache[formatType] = currencyUnit;
				}
			}
		}
	}

	return formatCurrencyCache[formatType];
}

function formatCurrencyAmountWithForcedDecimalPlaces(amount, formatType, forcedDecimalPlaces) {
	var formatInfo = getCurrencyFormatInfo(formatType);
	if (formatInfo != null) {
		var dec = new Decimal(amount);

		var decimalPlaces = formatInfo.decimalPlaces;

		if (forcedDecimalPlaces >= 0) {
			decimalPlaces = forcedDecimalPlaces;
		}

		if (formatInfo.type == "native") {
			dec = dec.times(formatInfo.multiplier);

			if (forcedDecimalPlaces >= 0) {
				// toFixed will keep trailing zeroes
				var baseStr = addThousandsSeparators(dec.toFixed(decimalPlaces));

				return {val:baseStr, currencyUnit:formatInfo.name, simpleVal:baseStr};

			} else {
				// toDP will strip trailing zeroes
				var baseStr = addThousandsSeparators(dec.toDP(decimalPlaces));

				var returnVal = {currencyUnit:formatInfo.name, simpleVal:baseStr};

				// max digits in "val"
				var maxValDigits = config.site.valueDisplayMaxLargeDigits;

				if (baseStr.indexOf(".") == -1) {
					returnVal.val = baseStr;

				} else {
					if (baseStr.length - baseStr.indexOf(".") - 1 > maxValDigits) {
						returnVal.val = baseStr.substring(0, baseStr.indexOf(".") + maxValDigits + 1);
						returnVal.lessSignificantDigits = baseStr.substring(baseStr.indexOf(".") + maxValDigits + 1);

					} else {
						returnVal.val = baseStr;
					}
				}

				return returnVal;
			}

		} else if (formatInfo.type == "exchanged") {
			if (global.exchangeRates != null && global.exchangeRates[formatInfo.multiplier] != null) {
				dec = dec.times(global.exchangeRates[formatInfo.multiplier]);

				var baseStr = addThousandsSeparators(dec.toDecimalPlaces(decimalPlaces));

				return {val:baseStr, currencyUnit:formatInfo.name, simpleVal:baseStr};
			} else {
				return formatCurrencyAmountWithForcedDecimalPlaces(amount, coinConfig.defaultCurrencyUnit.name, forcedDecimalPlaces);
			}
		}
	}

	return amount;
}

function formatCurrencyAmount(amount, formatType) {
	return formatCurrencyAmountWithForcedDecimalPlaces(amount, formatType, -1);
}

function formatCurrencyAmountInSmallestUnits(amount, forcedDecimalPlaces) {
	return formatCurrencyAmountWithForcedDecimalPlaces(amount, coins[config.coin].baseCurrencyUnit.name, forcedDecimalPlaces);
}

// ref: https://stackoverflow.com/a/2901298/673828
function addThousandsSeparators(x) {
	var parts = x.toString().split(".");
	parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");

	return parts.join(".");
}

function formatValueInActiveCurrency(amount) {
	if (global.currencyFormatType && global.exchangeRates[global.currencyFormatType.toLowerCase()]) {
		return formatExchangedCurrency(amount, global.currencyFormatType);

	} else {
		return formatExchangedCurrency(amount, "usdt");
	}
}

function satoshisPerUnitOfActiveCurrency() {
	if (global.currencyFormatType != null && global.exchangeRates != null) {
		var exchangeType = global.currencyFormatType.toLowerCase();

		if (!global.exchangeRates[global.currencyFormatType.toLowerCase()]) {
			// if current display currency is a native unit, default to USD for exchange values
			exchangeType = "usdt";
		}

		var dec = new Decimal(1);
		var one = new Decimal(1);
		dec = dec.times(global.exchangeRates[exchangeType]);

		// USDT/NEXA -> NEXA/USDT
		dec = one.dividedBy(dec);

		var unitName = coins[config.coin].baseCurrencyUnit.name;
		var formatInfo = getCurrencyFormatInfo(unitName);

		// BTC/USD -> sat/USD
		dec = dec.times(formatInfo.multiplier);

		var exchangedAmt = parseInt(dec);

		if (exchangeType == "eur") {
			return {amt:addThousandsSeparators(exchangedAmt), unit:`${unitName}/€`};
		} else {
			return {amt:addThousandsSeparators(exchangedAmt), unit:`${unitName}/$`};
		}

	}

	return null;
}

function formatExchangedCurrency(amount, exchangeType) {
	if (global.exchangeRates != null && global.exchangeRates[exchangeType.toLowerCase()] != null) {
		var dec = new Decimal(amount);
		dec = dec.times(global.exchangeRates[exchangeType.toLowerCase()]);
		var precision = coinConfig.currencyUnitsByName[exchangeType.toUpperCase()].decimalPlaces;
		var exchangedAmt = parseFloat(Math.round(dec*(10**precision))/10**precision);

		if (exchangeType == "eur") {
			return "€" + addThousandsSeparators(exchangedAmt);

		} else {
			return "$" + addThousandsSeparators(exchangedAmt);
		}

	}

	return "";
}

function seededRandom(seed) {
	var x = Math.sin(seed++) * 10000;
	return x - Math.floor(x);
}

function seededRandomIntBetween(seed, min, max) {
	var rand = seededRandom(seed);
	return (min + (max - min) * rand);
}

function ellipsize(str, length, ending="…") {
	if (str.length <= length) {
		return str;

	} else {
		return str.substring(0, length - ending.length) + ending;
	}
}

function shortenTimeDiff(str) {
	str = str.replace(" years", "y");
	str = str.replace(" year", "y");

	str = str.replace(" months", "mo");
	str = str.replace(" month", "mo");

	str = str.replace(" weeks", "w");
	str = str.replace(" week", "w");

	str = str.replace(" days", "d");
	str = str.replace(" day", "d");

	str = str.replace(" hours", "hr");
	str = str.replace(" hour", "hr");

	str = str.replace(" minutes", "min");
	str = str.replace(" minute", "min");

	return str;
}

function logMemoryUsage() {
	var mbUsed = process.memoryUsage().heapUsed / 1024 / 1024;
	mbUsed = Math.round(mbUsed * 100) / 100;

	var mbTotal = process.memoryUsage().heapTotal / 1024 / 1024;
	mbTotal = Math.round(mbTotal * 100) / 100;

	//debugLog("memoryUsage: heapUsed=" + mbUsed + ", heapTotal=" + mbTotal + ", ratio=" + parseInt(mbUsed / mbTotal * 100));
}

var possibleMinerSignalRE = /\/(.*)\//;

function getMinerCustomData(tx) {
	if (tx == null || tx.vin.length >=1 ) {
		return null;
	}
	var customData = tx.vout[tx.vout.length - 1].scriptPubKey.asm.split(" ").splice(2).join(" ");
	return customData
}

function getMinerFromCoinbaseTx(tx) {
	if (tx == null || tx.vin.length >=1 ) {
		return null;
	}

	var minerInfo = {
		coinbaseStr: hex2string(getMinerCustomData(tx))
	};

	var possibleSignal = minerInfo.coinbaseStr.match(possibleMinerSignalRE);
	if (possibleSignal)
		minerInfo.possibleSignal = possibleSignal[1];

	if (global.miningPoolsConfigs) {
		poolLoop:
		for (var i = 0; i < global.miningPoolsConfigs.length; i++) {
			var miningPoolsConfig = global.miningPoolsConfigs[i];

			for (var payoutAddress in miningPoolsConfig.payout_addresses) {
				if (miningPoolsConfig.payout_addresses.hasOwnProperty(payoutAddress)) {
					if (tx.vout && tx.vout.length > 0 && tx.vout[0].scriptPubKey && tx.vout[0].scriptPubKey.addresses && tx.vout[0].scriptPubKey.addresses.length > 0) {
						if (tx.vout[0].scriptPubKey.addresses[0] == payoutAddress) {
							Object.assign(minerInfo, miningPoolsConfig.payout_addresses[payoutAddress]);
							minerInfo.identifiedBy = "payout address " + payoutAddress;
							break poolLoop;
						}
					}
				}
			}

			for (var coinbaseTag in miningPoolsConfig.coinbase_tags) {
				if (miningPoolsConfig.coinbase_tags.hasOwnProperty(coinbaseTag)) {
					var coinbaseLower = minerInfo.coinbaseStr.toLowerCase();
					var coinbaseTagLower = coinbaseTag.toLowerCase();
					if (coinbaseLower.indexOf(coinbaseTagLower) != -1) {
						Object.assign(minerInfo, miningPoolsConfig.coinbase_tags[coinbaseTag]);
						minerInfo.identifiedBy = "coinbase tag '" + coinbaseTag + "' in '" + minerInfo.coinbaseStr + "'";
						break poolLoop;
					}
				}
			}

			for (var blockHash in miningPoolsConfig.block_hashes) {
				if (blockHash == tx.blockhash) {
					Object.assign(minerInfo, miningPoolsConfig.block_hashes[blockHash]);
					minerInfo.identifiedBy = "known block hash '" + blockHash + "'";
					break poolLoop;
				}
			}

			if ((!minerInfo.indentifiedBy) && (minerInfo.possibleSignal)) {
				minerInfo.name = minerInfo.possibleSignal;
				minerInfo.identifiedBy = "properly formatted signal e.g. '/tag/'";
				break poolLoop;
			}

		}
	}
	return minerInfo;
}

function getTxTotalInputOutputValues(tx, txInputs, blockHeight) {
	var totalInputValue = new Decimal(0);
	var totalOutputValue = new Decimal(0);

	try {
		for (var i = 0; i < tx.vin.length; i++) {
			if (tx.vin[i].coinbase) {
				totalInputValue = totalInputValue.plus(new Decimal(coinConfig.blockRewardFunction(blockHeight, global.activeBlockchain)));

			} else {
				var txInput = txInputs[i];

				if (txInput) {
					try {
						var vout = txInput;
						if (vout.value) {
							totalInputValue = totalInputValue.plus(new Decimal(vout.value));
						}
					} catch (err) {
						logError("2397gs0gsse", err, {txid:tx.txid, vinIndex:i});
					}
				}
			}
		}

		for (var i = 0; i < tx.vout.length; i++) {
			totalOutputValue = totalOutputValue.plus(new Decimal(tx.vout[i].value));
		}
	} catch (err) {
		logError("2308sh0sg44", err, {tx:tx, txInputs:txInputs, blockHeight:blockHeight});
	}

	return {input:totalInputValue, output:totalOutputValue};
}

// returns the amount of minted NEX (100 satoshis) for a given height
function getCoinsMinted(nHeight = -1) {
	let totalMinted = 0;
	const nSubsidyHalvingInterval = 1050000;
	const halvings = Math.floor(nHeight / nSubsidyHalvingInterval);
	let nSubsidy = 10 * 1000000 * 100; // 10 mil nex in satoshis
	let trackedHeight = nHeight;

	for (let i = 0; i <= halvings; ++i) {
		if (trackedHeight >= nSubsidyHalvingInterval) {
			totalMinted += nSubsidy * nSubsidyHalvingInterval;
			trackedHeight -= nSubsidyHalvingInterval;
		} else {
			totalMinted += nSubsidy * trackedHeight;
		}
		nSubsidy = Math.floor(nSubsidy / 2);
	}
	var to_return = totalMinted / 100;
	return to_return.toFixed(2);
}

// translate bits to diffigulty (target)

function getDifficulty(nBits) {
	let nShift = (nBits >> 24) & 0xff;

	let dDiff = 0x0000ffff / (nBits & 0x00ffffff);

	while (nShift < 29) {
		dDiff *= 256.0;
		nShift++;
	}
	while (nShift > 29) {
		dDiff /= 256.0;
		nShift--;
	}

	return dDiff;
}

function getBlockTotalFeesFromCoinbaseTxAndBlockHeight(coinbaseTx, blockHeight) {
	if (coinbaseTx == null) {
		return 0;
	}

	var blockReward = coinConfig.blockRewardFunction(blockHeight, global.activeBlockchain);

	var totalOutput = new Decimal(0);
	for (var i = 0; i < coinbaseTx.vout.length; i++) {
		var outputValue = coinbaseTx.vout[i].value;
		if (outputValue > 0) {
			totalOutput = totalOutput.plus(new Decimal(outputValue));
		}
	}

	return totalOutput.minus(new Decimal(blockReward));
}

async function refreshExchangeRates() {
	if (!config.queryExchangeRates || config.privacyMode) {
		return;
	}

	if (coins[config.coin].exchangeRateData) {
		try {
			const response = await axios.get(coins[config.coin].exchangeRateData.jsonUrl);

			var exchangeRates = coins[config.coin].exchangeRateData.responseBodySelectorFunction(response.data);
			if (exchangeRates != null) {
				global.exchangeRates = exchangeRates;
				global.exchangeRatesUpdateTime = new Date();

				debugLog("Using exchange rates: " + JSON.stringify(global.exchangeRates) + " starting at " + global.exchangeRatesUpdateTime);
					getExchangeFromExchangeRateExtensions();
			} else {
				debugLog("Unable to get exchange rate data");
			}
		} catch(err) {
			logError("39r7h2390fgewfgds", err);
		}
	}
}

async function getExchangeFromExchangeRateExtensions() {
	// Any other extended currency conversion must use the BCHUSD base conversion rate to be calculated, in consecuence --no-rates must be disabled.
	var anyExtensionIsActive = coins[config.coin].currencyUnits.find(cu => cu.isExtendedRate) != undefined;
	if (anyExtensionIsActive && coins[config.coin].exchangeRateDataExtension.length > 0 && global.exchangeRates['usd']) {
		for (const exchangeProvider of coins[config.coin].exchangeRateDataExtension) {
			try {
				const response = await axios.get(exchangeProvider.jsonUrl);
				var responseBody = response.data;

				var exchangeRates = exchangeProvider.responseBodySelectorFunction(responseBody);
				if (exchangeRates != null || Object.entries(exchangeRates).length > 0) {
					var originalExchangeRates = global.exchangeRates;
					var extendedExchangeRates =  {};
					for (const  key in exchangeRates) {
						extendedExchangeRates[key] = (parseFloat(originalExchangeRates.usd) * parseFloat(exchangeRates[key])).toString();
					}
					global.exchangeRates = {
						...originalExchangeRates,
						...extendedExchangeRates
					}
					global.exchangeRatesUpdateTime = new Date();

					debugLog("Using extended exchange rates: " + JSON.stringify(global.exchangeRates) + " starting at " + global.exchangeRatesUpdateTime);

				} else {
					debugLog("Unable to get extended exchange rate data");
				}
			} catch(err) {
				logError("83ms2hsnw2je34zc2", err);
			}
		}
	}
}

// Uses ipstack.com API
function geoLocateIpAddresses(ipAddresses, provider) {
	return new Promise(function(resolve, reject) {
		if (config.privacyMode || config.credentials.ipStackComApiAccessKey === undefined) {
			resolve({});

			return;
		}

		var ipDetails = {ips:ipAddresses, detailsByIp:{}};

		var promises = [];
		for (var i = 0; i < ipAddresses.length; i++) {
			var ipStr = ipAddresses[i];

			promises.push(new Promise(function(resolve2, reject2) {
				ipCache.get(ipStr).then(async function(result) {
					if (result.value == null) {
						var apiUrl = "http://api.ipstack.com/" + result.key + "?access_key=" + config.credentials.ipStackComApiAccessKey;

						try {
							const response = await axios.get(apiUrl);
							var ip = response.data.ip;
							ipDetails.detailsByIp[ip] = response.data;
							if (response.data.latitude && response.data.longitude) {
								debugLog(`Successful IP-geo-lookup: ${ip} -> (${response.data.latitude}, ${response.data.longitude})`);
							} else {
								debugLog(`Unknown location for IP-geo-lookup: ${ip}`);
							}
							ipCache.set(ip, response.data, 1000 * 60 * 60 * 24 * 365);
							resolve2();
						} catch(err) {
							debugLog("Failed IP-geo-lookup: " + result.key);
							logError("39724gdge33a", error, {ip: result.key});
							// we failed to get what we wanted, but there's no meaningful recourse,
							// so we log the failure and continue without objection
							resolve2();
						}
					} else {
						ipDetails.detailsByIp[result.key] = result.value
						resolve2();
					}
				});
			}));
		}

		Promise.all(promises).then(function(results) {
			resolve(ipDetails);
		}).catch(function(err) {
			logError("80342hrf78wgehdf07gds", err);

			reject(err);
		});
	});
}

function parseExponentStringDouble(val) {
	var [lead,decimal,pow] = val.toString().split(/e|\./);
	return +pow <= 0
		? "0." + "0".repeat(Math.abs(pow)-1) + lead + decimal
		: lead + ( +pow >= decimal.length ? (decimal + "0".repeat(+pow-decimal.length)) : (decimal.slice(0,+pow)+"."+decimal.slice(+pow)));
}

var exponentScales = [
	{val:1000000000000000000000000000000000, name:"?", abbreviation:"V", exponent:"33"},
	{val:1000000000000000000000000000000, name:"?", abbreviation:"W", exponent:"30"},
	{val:1000000000000000000000000000, name:"?", abbreviation:"X", exponent:"27"},
	{val:1000000000000000000000000, name:"yotta", abbreviation:"Y", exponent:"24"},
	{val:1000000000000000000000, name:"zetta", abbreviation:"Z", exponent:"21"},
	{val:1000000000000000000, name:"exa", abbreviation:"E", exponent:"18"},
	{val:1000000000000000, name:"peta", abbreviation:"P", exponent:"15", textDesc:"Q"},
	{val:1000000000000, name:"tera", abbreviation:"T", exponent:"12", textDesc:"T"},
	{val:1000000000, name:"giga", abbreviation:"G", exponent:"9", textDesc:"B"},
	{val:1000000, name:"mega", abbreviation:"M", exponent:"6", textDesc:"M"},
	{val:1000, name:"kilo", abbreviation:"K", exponent:"3", textDesc:"thou"},
	{val:1, name:"", abbreviation:"", exponent:"0", textDesc:""}
];

function testExponentScaleIndex(n, exponentScaleIndex) {
	var item = exponentScales[exponentScaleIndex];
	var fraction = new Decimal(n / item.val);
	return {
		ok: fraction >= 1,
		fraction: fraction
	};
}

function getBestExponentScaleIndex(n) {
	if (n < 1)
		return exponentScales.length - 1;

	for (var i = 0; i < exponentScales.length; i++) {
		var res = testExponentScaleIndex(n, i);
		if (res.ok)
			return i;
	}
	throw new Error(`Unable to find exponent scale index for ${n}`);
}

function findBestCommonExponentScaleIndex(ns) {
	var best = ns.map(n => getBestExponentScaleIndex(n));
	return Math.max(...best);
}

function formatLargeNumber(n, decimalPlaces, exponentScaleIndex = undefined) {
	if (exponentScaleIndex === undefined)
		exponentScaleIndex = getBestExponentScaleIndex(n);

	var item = exponentScales[exponentScaleIndex];
	var fraction = new Decimal(n / item.val);
	return [fraction.toDecimalPlaces(decimalPlaces), item];
}

function rgbToHsl(r, g, b) {
	r /= 255, g /= 255, b /= 255;
	var max = Math.max(r, g, b), min = Math.min(r, g, b);
	var h, s, l = (max + min) / 2;

	if(max == min){
		h = s = 0; // achromatic
	}else{
		var d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch(max){
			case r: h = (g - b) / d + (g < b ? 6 : 0); break;
			case g: h = (b - r) / d + 2; break;
			case b: h = (r - g) / d + 4; break;
		}
		h /= 6;
	}

	return {h:h, s:s, l:l};
}

function colorHexToRgb(hex) {
	// Expand shorthand form (e.g. "03F") to full form (e.g. "0033FF")
	var shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
	hex = hex.replace(shorthandRegex, function(m, r, g, b) {
		return r + r + g + g + b + b;
	});

	var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return result ? {
		r: parseInt(result[1], 16),
		g: parseInt(result[2], 16),
		b: parseInt(result[3], 16)
	} : null;
}

function colorHexToHsl(hex) {
	var rgb = colorHexToRgb(hex);
	return rgbToHsl(rgb.r, rgb.g, rgb.b);
}


// https://stackoverflow.com/a/31424853/673828
const reflectPromise = p => p.then(v => ({v, status: "resolved" }),
							e => ({e, status: "rejected" }));

global.errorStats = {};

function logError(errorId, err, optionalUserData = null) {
	if (!global.errorLog) {
		global.errorLog = [];
	}

	if (!global.errorStats[errorId]) {
		global.errorStats[errorId] = {
			count: 0,
			firstSeen: new Date().getTime()
		};
	}

	global.errorStats[errorId].count++;
	global.errorStats[errorId].lastSeen = new Date().getTime();

	global.errorLog.push({errorId:errorId, error:err, userData:optionalUserData, date:new Date()});
	while (global.errorLog.length > 100) {
		global.errorLog.splice(0, 1);
	}

	debugErrorLog("Error " + errorId + ": " + err + ", json: " + JSON.stringify(err) + (optionalUserData != null ? (", userData: " + optionalUserData + " (json: " + JSON.stringify(optionalUserData) + ")") : ""));

	if (err && err.stack) {
		debugErrorVerboseLog("Stack: " + err.stack);
	}

	var returnVal = {errorId:errorId, error:err};
	if (optionalUserData) {
		returnVal.userData = optionalUserData;
	}

	return returnVal;
}

function buildQrCodeUrls(strings) {
	return new Promise(function(resolve, reject) {
		var promises = [];
		var qrcodeUrls = {};

		for (var i = 0; i < strings.length; i++) {
			promises.push(new Promise(function(resolve2, reject2) {
				buildQrCodeUrl(strings[i], qrcodeUrls).then(function() {
					resolve2();

				}).catch(function(err) {
					reject2(err);
				});
			}));
		}

		Promise.all(promises).then(function(results) {
			resolve(qrcodeUrls);

		}).catch(function(err) {
			reject(err);
		});
	});
}

function buildQrCodeUrl(str, results) {
	return new Promise(function(resolve, reject) {
		qrcode.toDataURL(str, function(err, url) {
			if (err) {
				logError("2q3ur8fhudshfs", err, str);

				reject(err);

				return;
			}

			results[str] = url;

			resolve();
		});
	});
}

function outputTypeAbbreviation(outputType) {
	var map = {
		"pubkeyhash": "p2pkh",
		"scripttemplate": "p2st",
		"nonstandard": "nonstandard",
		"nulldata": "nulldata"
	};

	if (map[outputType]) {
		return map[outputType];
	} else {
		return "???";
	}
}

function prettyScript(inScript, indentChar) {
	var indenter=["OP_IF", "OP_ELSE"]
	var outdenter=["OP_ENDIF", "OP_ELSE"]

	s = inScript.split(" ");
	var shiftAmt=0;
	var i;
	var indenting = '';

	for (i = 0; i < s.length; i++) {
		var item=s[i];
		if (s[i].slice(0,2) == "OP")
		{
			s[i] = "<span class='opcode'>" + s[i] + "</span>";
		}
		if (outdenter.includes(item)) shiftAmt -= 1;
		if (shiftAmt < 0) shiftAmt = 0;
		indenting = Array(shiftAmt).join(indentChar);
		s[i] = "<div style='text-indent: " + indenting  + "em'>" + s[i] + "</div>";
		if (indenter.includes(item)) shiftAmt += 1;
	}
	return s.join("\n");
}

function outputTypeName(outputType) {
	var map = {
		"pubkeyhash": "Pay to Public Key Hash",
		"scripttemplate": "Pay to Script Template",
		"nonstandard": "Non-Standard",
		"nulldata": "Null Data"
	};

	if (map[outputType]) {
		return map[outputType];
	} else {
		return "???";
	}
}

function serviceBitsToName (services) {
	var serviceBits = [];
	if (services & 1) { serviceBits.push('NODE_NETWORK'); }
	if (services & 2) { serviceBits.push('NODE_GETUTXO'); }
	if (services & 4) { serviceBits.push('NODE_BLOOM'); }
	if (services & 8) { serviceBits.push('NODE_WITNESS'); }
	if (services & 16) { serviceBits.push('NODE_XTHIN'); }
	if (services & 32) { serviceBits.push('NODE_CASH'); }
	if (services & 64) { serviceBits.push('NODE_GRAPHENE'); }
	if (services & 128) { serviceBits.push('NODE_WEAKBLOCKS'); }
	if (services & 256) { serviceBits.push('NODE_CF'); }
	if (services & 1024) { serviceBits.push('NODE_NETWORK_LIMITED'); }
	return serviceBits;
}

function getTransactionDatetime(utcEpochTime) {
	var epoch = new Date(0);
	epoch.setUTCSeconds(utcEpochTime);
	var formatted_date = epoch.getFullYear() + "-" + (epoch.getMonth() + 1) + "-" + epoch.getDate() + " " + epoch.toUTCString();

	return formatted_date;
}

function readRichList () {
	let data = fs.readFileSync(path.resolve(config.richListPath), {encoding:'utf8', flag:'r'});
	let lines = data.split(/\r?\n/);
	lines.pop();
	let parsedLines = [];
	let parsedLine;
	let i = 0;
	let coinsDistr = [["Top 25",0,0],["Top 26-50",0,0],["Top 51-75",0,0],["Top 76-100",0,0],["Total",0,0]];
	lines.forEach(function(line) {
		let lineArray = line.split(',');
		let displayedAddress = "";
		if (lineArray[3].length > 54) {
			displayedAddress = lineArray[3].substring(0,21) + " ... " + lineArray[3].substring((lineArray[3].length - 21))
			console.log("Dispalyed address: " + displayedAddress);
			console.log("Dispalyed address: " + lineArray[3]);
		} else {
			displayedAddress = lineArray[3];
		}
		parsedLine = {
			rank: Number(lineArray[0]),
			balance: Number(lineArray[1]),
			height: Number(lineArray[2]),
			address: lineArray[3],
			formatAddress : displayedAddress,
			percent: Number(lineArray[4])
		};
		parsedLines.push(parsedLine);
		coinsDistr[4][1] += parsedLine.balance;
		coinsDistr[4][2] += parsedLine.percent;
		coinsDistr[Math.floor(i/25)][1] += parsedLine.balance;
		coinsDistr[Math.floor(i/25)][2] += parsedLine.percent;
		i++;
	});
	return [parsedLines, coinsDistr];
}


const obfuscateProperties = (obj, properties) => {
	if (process.env.BTCEXP_SKIP_LOG_OBFUSCATION) {
		return obj;
	}

	let objCopy = Object.assign({}, obj);

	properties.forEach(name => {
		objCopy[name] = "*****";
	});

	return objCopy;
}

// The following 2 functions are needed when using "json parse with source" tc39
// v8 modification available only while using nodejs >=20

// This will let us use an experimental version of v8 engine that
// fixes JSON BigInt parsing/stringifying problem.
//
// See the following links for more detail:
//
// - https://jsoneditoronline.org/indepth/parse/why-does-json-parse-corrupt-large-numbers/
// - https://github.com/tc39/proposal-json-parse-with-source
// - https://2ality.com/2022/11/json-parse-with-source.html
//
// The TC39 change proposal is called json parse with souirce and it has already been
// implemented in google v8 since version 10.9.1, see:
//
// https://chromium.googlesource.com/v8/v8/+/refs/heads/10.9.1/src/flags/flag-definitions.h#222

const bigIntToRawJSON = function(key, val) {
	if (typeof val === "bigint" ) {
		return JSON.rawJSON(String(val));
	} else {
		return val;
	}
}

const intToBigInt = function(key, val, unparsedVal) {
	// if val belongs to the number type, it is bigger than max safe integer,
	// and it's not a rational number, then convert it to BigInt starting from
	// the orginal unparsed value.
	if (typeof val === 'number' && (val > Number.MAX_SAFE_INTEGER || val < Number.MIN_SAFE_INTEGER) && val % 1 == 0) {
		// BigInt() can't parse string that ends wiht '.00' and e.g. 11.00 % 1
		// returns 0 so we need to take into account this special case.
		let regex = /^[0-9]+\.[0]{2}$/;
		let toParse = unparsedVal.source;
		if (regex.test(toParse)) {
			return BigInt(toParse.slice(0,-3));
		} else {
			return BigInt(unparsedVal.source);
		}
	} else {
		return val;
	}
}

module.exports = {
	readRichList: readRichList,
	reflectPromise: reflectPromise,
	redirectToConnectPageIfNeeded: redirectToConnectPageIfNeeded,
	hex2ascii: hex2ascii,
	hex2array: hex2array,
	hex2string: hex2string,
	splitArrayIntoChunks: splitArrayIntoChunks,
	splitArrayIntoChunksByChunkCount: splitArrayIntoChunksByChunkCount,
	getRandomString: getRandomString,
	getCurrencyFormatInfo: getCurrencyFormatInfo,
	formatCurrencyAmount: formatCurrencyAmount,
	formatCurrencyAmountWithForcedDecimalPlaces: formatCurrencyAmountWithForcedDecimalPlaces,
	formatExchangedCurrency: formatExchangedCurrency,
	formatValueInActiveCurrency: formatValueInActiveCurrency,
	satoshisPerUnitOfActiveCurrency: satoshisPerUnitOfActiveCurrency,
	addThousandsSeparators: addThousandsSeparators,
	formatCurrencyAmountInSmallestUnits: formatCurrencyAmountInSmallestUnits,
	seededRandom: seededRandom,
	seededRandomIntBetween: seededRandomIntBetween,
	logMemoryUsage: logMemoryUsage,
	getMinerFromCoinbaseTx: getMinerFromCoinbaseTx,
	getMinerCustomData: getMinerCustomData,
	getBlockTotalFeesFromCoinbaseTxAndBlockHeight: getBlockTotalFeesFromCoinbaseTxAndBlockHeight,
	getCoinsMinted: getCoinsMinted,
	getDifficulty: getDifficulty,
	refreshExchangeRates: refreshExchangeRates,
	parseExponentStringDouble: parseExponentStringDouble,
	findBestCommonExponentScaleIndex: findBestCommonExponentScaleIndex,
	formatLargeNumber: formatLargeNumber,
	geoLocateIpAddresses: geoLocateIpAddresses,
	getTxTotalInputOutputValues: getTxTotalInputOutputValues,
	rgbToHsl: rgbToHsl,
	colorHexToRgb: colorHexToRgb,
	colorHexToHsl: colorHexToHsl,
	logError: logError,
	buildQrCodeUrls: buildQrCodeUrls,
	ellipsize: ellipsize,
	shortenTimeDiff: shortenTimeDiff,
	prettyScript: prettyScript,
	outputTypeAbbreviation: outputTypeAbbreviation,
	outputTypeName: outputTypeName,
	serviceBitsToName: serviceBitsToName,
	perfMeasure: perfMeasure,
	getTransactionDatetime: getTransactionDatetime,
	obfuscateProperties: obfuscateProperties,
	bigIntToRawJSON: bigIntToRawJSON,
	intToBigInt: intToBigInt
};
